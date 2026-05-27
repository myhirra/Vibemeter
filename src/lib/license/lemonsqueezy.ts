/**
 * Lemon Squeezy license-key provider.
 *
 * The license-key endpoints (`/v1/licenses/activate|validate|deactivate`) are
 * the only LS API surface that does NOT require the merchant's secret API
 * key. They authenticate solely with the user-supplied license key + the
 * device's instance id, which makes them safe to call from a locally-running
 * Vibemeter daemon.
 *
 * We intentionally do not import the Lemon Squeezy SDK here — the SDK is
 * Node-only and pulls in a fair bit of code we don't need for three POST
 * calls. Plain `fetch` keeps the dependency surface zero.
 */

import {
  DEFAULT_GRACE_DAYS,
  EMPTY_STATE,
  lastFour,
  type ActivateResult,
  type DeactivateResult,
  type LicenseState,
  type PaymentProvider,
  type RemoteLicenseStatus,
  type ValidateResult,
} from './provider';

const LS_BASE = 'https://api.lemonsqueezy.com/v1/licenses';
const FETCH_TIMEOUT_MS = 10_000;

interface LsLicenseKey {
  id?: number;
  status?: string;
  key?: string;
  activation_limit?: number;
  activation_usage?: number;
  created_at?: string;
  expires_at?: string | null;
  test_mode?: boolean;
}

interface LsInstance {
  id?: string;
  name?: string;
  created_at?: string;
}

interface LsMeta {
  product_id?: number;
  product_name?: string;
  variant_id?: number;
  variant_name?: string;
  store_id?: number;
  customer_id?: number;
  customer_name?: string;
  customer_email?: string;
}

interface LsResponse {
  activated?: boolean;
  valid?: boolean;
  deactivated?: boolean;
  error?: string | null;
  license_key?: LsLicenseKey;
  instance?: LsInstance | null;
  meta?: LsMeta;
}

export interface LemonSqueezyConfig {
  /** Override for tests / staging. Defaults to the public endpoint. */
  baseUrl?: string;
  /** Optional checkout URL (`NEXT_PUBLIC_VIBEMETER_CHECKOUT_URL`). */
  checkoutUrl?: string | null;
  /** Per-call timeout (ms). Useful to keep tests fast. */
  fetchTimeoutMs?: number;
  /** Injectable fetch — leaves the global fetch alone in tests. */
  fetch?: typeof fetch;
}

export class LemonSqueezyProvider implements PaymentProvider {
  private readonly baseUrl: string;
  private readonly checkoutUrl: string | null;
  private readonly fetchTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LemonSqueezyConfig = {}) {
    this.baseUrl = (config.baseUrl ?? LS_BASE).replace(/\/+$/, '');
    this.checkoutUrl = config.checkoutUrl ?? null;
    this.fetchTimeoutMs = config.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
    this.fetchImpl = config.fetch ?? fetch;
  }

  getCheckoutUrl(plan: 'pro' | 'team'): string | null {
    if (plan === 'team') return null;
    return this.checkoutUrl;
  }

  async activateLicense(key: string, instanceName: string): Promise<ActivateResult> {
    const trimmed = key.trim();
    if (!trimmed) return { ok: false, errorKey: 'billing.error.empty' };

    const body = new URLSearchParams({
      license_key: trimmed,
      instance_name: instanceName,
    });
    const response = await this.post('/activate', body);
    if (!response.ok) {
      return { ok: false, errorKey: response.errorKey, errorDetail: response.errorDetail };
    }
    const payload = response.payload;
    if (!payload.activated || !payload.instance?.id) {
      return {
        ok: false,
        errorKey: mapLsError(payload),
        errorDetail: payload.error ?? undefined,
      };
    }

    const now = Date.now();
    const state: LicenseState = {
      ...EMPTY_STATE,
      provider: 'lemonsqueezy',
      plan: 'pro',
      status: mapStatus(payload.license_key?.status),
      licenseKeyLast4: lastFour(trimmed),
      instanceId: payload.instance.id,
      instanceName: payload.instance.name ?? instanceName,
      activatedAt: parseDate(payload.instance.created_at) ?? now,
      expiresAt: parseDate(payload.license_key?.expires_at ?? null),
      lastValidatedAt: now,
      validationGraceUntil: now + DEFAULT_GRACE_DAYS * 86_400_000,
      productName: payload.meta?.product_name ?? null,
      variantName: payload.meta?.variant_name ?? null,
    };
    return { ok: true, state };
  }

  async validateLicense(prev: LicenseState): Promise<ValidateResult> {
    if (!prev.instanceId || !prev.licenseKeyLast4) {
      return { ok: false, reached: false, errorKey: 'billing.error.missingInstance' };
    }
    const key = await readKeyFromStorage();
    if (!key) {
      // Key was wiped from storage but state still references an instance.
      // Treat as a clean Free state.
      return { ok: false, reached: false, errorKey: 'billing.error.keyMissing' };
    }

    const body = new URLSearchParams({
      license_key: key,
      instance_id: prev.instanceId,
    });
    const response = await this.post('/validate', body);
    if (!response.ok) {
      // Network / parse failures bubble up as `reached=false` so the service
      // can decide whether to extend grace or downgrade.
      return { ok: false, reached: response.reached, errorKey: response.errorKey, errorDetail: response.errorDetail };
    }
    const payload = response.payload;
    if (!payload.valid) {
      return {
        ok: false,
        reached: true,
        errorKey: mapLsError(payload),
        errorDetail: payload.error ?? undefined,
        state: {
          ...prev,
          plan: 'free',
          status: mapStatus(payload.license_key?.status, 'inactive'),
          lastValidatedAt: Date.now(),
        },
      };
    }

    const now = Date.now();
    const nextState: LicenseState = {
      ...prev,
      plan: 'pro',
      status: mapStatus(payload.license_key?.status, 'active'),
      lastValidatedAt: now,
      validationGraceUntil: now + DEFAULT_GRACE_DAYS * 86_400_000,
      expiresAt: parseDate(payload.license_key?.expires_at ?? null) ?? prev.expiresAt,
      productName: payload.meta?.product_name ?? prev.productName,
      variantName: payload.meta?.variant_name ?? prev.variantName,
    };
    return { ok: true, reached: true, state: nextState };
  }

  async deactivateLicense(state: LicenseState): Promise<DeactivateResult> {
    if (!state.instanceId) return { ok: false, errorKey: 'billing.error.missingInstance' };
    const key = await readKeyFromStorage();
    if (!key) return { ok: true }; // Nothing to revoke remotely.

    const body = new URLSearchParams({
      license_key: key,
      instance_id: state.instanceId,
    });
    const response = await this.post('/deactivate', body);
    if (!response.ok) {
      return { ok: false, errorKey: response.errorKey, errorDetail: response.errorDetail };
    }
    if (!response.payload.deactivated) {
      return { ok: false, errorKey: mapLsError(response.payload), errorDetail: response.payload.error ?? undefined };
    }
    return { ok: true };
  }

  // ───────────────────────────────────────────────────────────────────────

  private async post(
    pathSuffix: string,
    body: URLSearchParams,
  ): Promise<
    | { ok: true; reached: true; payload: LsResponse }
    | { ok: false; reached: boolean; errorKey: string; errorDetail?: string }
  > {
    const url = `${this.baseUrl}${pathSuffix}`;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.fetchTimeoutMs) : null;

    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: ctrl?.signal,
      });
      const text = await res.text();
      let payload: LsResponse | null = null;
      try { payload = text ? (JSON.parse(text) as LsResponse) : null; }
      catch { payload = null; }

      if (!res.ok) {
        // 4xx with a JSON body usually carries `error: "..."` from LS.
        return {
          ok: false,
          reached: true,
          errorKey: mapHttpError(res.status, payload),
          errorDetail: payload?.error ?? text.slice(0, 200),
        };
      }
      if (!payload) {
        return { ok: false, reached: true, errorKey: 'billing.error.badResponse' };
      }
      return { ok: true, reached: true, payload };
    } catch (err) {
      const aborted = (err as { name?: string } | null)?.name === 'AbortError';
      return {
        ok: false,
        reached: false,
        errorKey: aborted ? 'billing.error.timeout' : 'billing.error.network',
        errorDetail: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function mapStatus(raw: string | undefined, fallback: RemoteLicenseStatus = 'active'): RemoteLicenseStatus {
  if (raw === 'active' || raw === 'inactive' || raw === 'expired' || raw === 'disabled') return raw;
  return fallback;
}

function parseDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function mapLsError(payload: LsResponse | null): string {
  const error = (payload?.error ?? '').toLowerCase();
  if (!error) return 'billing.error.unknown';
  if (error.includes('expired')) return 'billing.error.expired';
  if (error.includes('disabled')) return 'billing.error.disabled';
  if (error.includes('activation') && error.includes('limit')) return 'billing.error.activationLimit';
  if (error.includes('reached the activation limit')) return 'billing.error.activationLimit';
  if (error.includes('does not exist') || error.includes('not found')) return 'billing.error.invalidKey';
  if (error.includes('inactive')) return 'billing.error.inactive';
  return 'billing.error.unknown';
}

function mapHttpError(status: number, payload: LsResponse | null): string {
  if (payload?.error) return mapLsError(payload);
  if (status === 404) return 'billing.error.invalidKey';
  if (status === 422) return 'billing.error.invalidKey';
  if (status === 401 || status === 403) return 'billing.error.unauthorized';
  if (status >= 500) return 'billing.error.serverDown';
  return 'billing.error.network';
}

/**
 * Module-level shim so the provider can fetch the key without taking a
 * dependency on storage at import time (avoids cycles in tests). The
 * service overrides this for unit tests via `setKeyReader`.
 */
let keyReader: () => Promise<string | null> = async () => null;
export function setKeyReader(fn: () => Promise<string | null>) { keyReader = fn; }
async function readKeyFromStorage(): Promise<string | null> { return keyReader(); }

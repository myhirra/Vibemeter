/**
 * Server-side orchestration around the license provider + storage.
 *
 * Why this lives in its own module:
 *   • The Next.js API routes are thin shims; the meat is here so it can be
 *     unit-tested with a `MockProvider`.
 *   • The CLI talks to the daemon over HTTP, not directly into this module —
 *     so we have a single code path for read/write side effects.
 *
 * Behaviour summary:
 *   - activate(key)       → POST to provider, persist key + state on success
 *   - validate()          → cached for 7d; otherwise refresh against provider.
 *                           Network failure within grace window keeps Pro.
 *                           Past grace, fall back to Free.
 *   - deactivate()        → POST to provider, clear storage on success
 *   - getCurrentState()   → reads storage, applies grace check
 *
 * No call here ever logs or sends usage/session data anywhere. The only
 * outbound HTTP is to the license provider's `/licenses/*` endpoints.
 */

import os from 'node:os';
import {
  DEFAULT_GRACE_DAYS,
  DEFAULT_VALIDATION_TTL_DAYS,
  EMPTY_STATE,
  type LicenseState,
  type PaymentProvider,
} from './provider';
import { LemonSqueezyProvider, setKeyReader } from './lemonsqueezy';
import { CHECKOUT_URL_PRO_FOUNDING } from '@/lib/pricing-config';
import { clearAll, readKey, readState, writeKey, writeState } from './storage';

// Single shared instance so the per-call key reader injected into the
// Lemon Squeezy provider doesn't flap. Tests override via `setProvider`.
let provider: PaymentProvider = new LemonSqueezyProvider({ checkoutUrl: CHECKOUT_URL_PRO_FOUNDING });
setKeyReader(async () => readKey());

export function setProvider(next: PaymentProvider) {
  provider = next;
}

export function getProvider(): PaymentProvider {
  return provider;
}

export interface ServiceResult {
  ok: boolean;
  state: LicenseState;
  errorKey?: string;
  errorDetail?: string;
}

export async function activate(key: string): Promise<ServiceResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, state: readState(), errorKey: 'billing.error.empty' };

  const instanceName = deriveInstanceName();
  const result = await provider.activateLicense(trimmed, instanceName);
  if (!result.ok || !result.state) {
    return { ok: false, state: readState(), errorKey: result.errorKey, errorDetail: result.errorDetail };
  }
  writeKey(trimmed);
  writeState(result.state);
  return { ok: true, state: result.state };
}

export async function validate(): Promise<ServiceResult> {
  const current = readState();
  if (current.status === 'none' || !current.instanceId) {
    // Nothing to validate. Pure Free.
    return { ok: true, state: current };
  }

  const ttlMs = DEFAULT_VALIDATION_TTL_DAYS * 86_400_000;
  if (current.lastValidatedAt && Date.now() - current.lastValidatedAt < ttlMs) {
    // Recent enough — trust the cache.
    return { ok: true, state: current };
  }

  const result = await provider.validateLicense(current);
  if (result.ok && result.state) {
    writeState(result.state);
    return { ok: true, state: result.state };
  }

  if (result.reached && result.state) {
    // Provider answered "no longer valid" — persist + downgrade.
    writeState(result.state);
    return { ok: false, state: result.state, errorKey: result.errorKey, errorDetail: result.errorDetail };
  }

  // Network failure: stay on Pro while inside the grace window, otherwise
  // downgrade to Free without clearing storage (so reconnection auto-heals).
  const now = Date.now();
  if (current.validationGraceUntil != null && now <= current.validationGraceUntil) {
    return { ok: true, state: current, errorKey: result.errorKey, errorDetail: result.errorDetail };
  }
  const downgraded: LicenseState = { ...current, plan: 'free', status: 'inactive' };
  writeState(downgraded);
  return { ok: false, state: downgraded, errorKey: result.errorKey ?? 'billing.error.graceExpired' };
}

export async function deactivate(): Promise<ServiceResult> {
  const current = readState();
  if (current.status === 'none') return { ok: true, state: current };
  const result = await provider.deactivateLicense(current);
  if (!result.ok) {
    return { ok: false, state: current, errorKey: result.errorKey, errorDetail: result.errorDetail };
  }
  clearAll();
  return { ok: true, state: EMPTY_STATE };
}

/**
 * Cheap, non-blocking read for UI. Applies the grace window: if the cached
 * validation expired and we're past the grace cutoff, surface Free without
 * touching the provider (the UI will trigger a background validate()).
 */
export function getCurrentState(): LicenseState {
  const current = readState();
  if (current.status === 'none') return current;
  const now = Date.now();
  if (
    current.validationGraceUntil != null &&
    now > current.validationGraceUntil &&
    current.plan !== 'free'
  ) {
    return { ...current, plan: 'free' };
  }
  return current;
}

/**
 * Friendly device label to register with the provider. Combines hostname +
 * username so the user can recognise it in the LS dashboard.
 */
function deriveInstanceName(): string {
  const host = (() => {
    try { return os.hostname(); } catch { return 'mac'; }
  })();
  const user = (() => {
    try { return os.userInfo().username; } catch { return ''; }
  })();
  const base = user ? `${user}@${host}` : host;
  return `vibemeter / ${base}`.slice(0, 80);
}

export const GRACE_DAYS = DEFAULT_GRACE_DAYS;

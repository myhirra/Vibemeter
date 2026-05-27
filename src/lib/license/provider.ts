/**
 * Vendor-agnostic license provider interface.
 *
 * Vibemeter integrates with Lemon Squeezy's license-key API today, but we
 * keep this contract narrow so that swapping providers (Paddle, Gumroad,
 * self-hosted, …) is a single-file change. The interface intentionally only
 * deals in license keys + instance ids — it never touches usage / project /
 * session data.
 */

export type LicensePlan = 'free' | 'pro' | 'team';

/**
 * The status reported by the upstream license service. We mirror Lemon
 * Squeezy's vocabulary because it's the dominant provider; if a future
 * provider uses different terms it can map onto this union.
 */
export type RemoteLicenseStatus = 'active' | 'inactive' | 'expired' | 'disabled';

/**
 * Snapshot of what we know about the local license. Persisted to
 * `<dataDir>/license-state.json` (everything except the raw key, which lives
 * in keychain).
 */
export interface LicenseState {
  provider: 'lemonsqueezy' | 'mock';
  plan: LicensePlan;
  /** Remote-reported license status; `none` means we don't have anything stored. */
  status: RemoteLicenseStatus | 'none';
  /** Last 4 chars of the active license key, for masked display. */
  licenseKeyLast4: string | null;
  /** LS instance id returned by /activate; required to call /validate + /deactivate. */
  instanceId: string | null;
  /** Friendly device name we registered with the upstream provider. */
  instanceName: string | null;
  /** Epoch ms when this device was first activated. */
  activatedAt: number | null;
  /** Epoch ms when the license itself expires (if any). */
  expiresAt: number | null;
  /** Epoch ms of the most recent successful validation against the provider. */
  lastValidatedAt: number | null;
  /**
   * Epoch ms past which an offline grace period elapses. While now <= this
   * value Pro features remain available even if validation can't reach the
   * server. Computed when a validation succeeds.
   */
  validationGraceUntil: number | null;
  /** Product name (best-effort, surfaced in settings). */
  productName: string | null;
  /** Variant name within the product (e.g. "Founding"). */
  variantName: string | null;
}

export interface ActivateResult {
  ok: boolean;
  /** Bilingual-friendly error message key — UI translates to zh/en. */
  errorKey?: string;
  errorDetail?: string;
  state?: LicenseState;
}

export interface ValidateResult {
  ok: boolean;
  /** True when the provider was reached at all (regardless of validity). */
  reached: boolean;
  errorKey?: string;
  errorDetail?: string;
  state?: LicenseState;
}

export interface DeactivateResult {
  ok: boolean;
  errorKey?: string;
  errorDetail?: string;
}

export interface PaymentProvider {
  activateLicense(key: string, instanceName: string): Promise<ActivateResult>;
  validateLicense(state: LicenseState): Promise<ValidateResult>;
  deactivateLicense(state: LicenseState): Promise<DeactivateResult>;
  /** Optional — only some providers expose a hosted checkout link. */
  getCheckoutUrl?(plan: 'pro' | 'team'): string | null;
}

/**
 * Default grace window the service applies after a successful validation.
 * If the user goes offline (laptop on a plane), Pro keeps working for this
 * many days before we fall back to Free.
 */
export const DEFAULT_GRACE_DAYS = 14;

/**
 * How long we trust a cached validation before reaching out to the provider
 * again. Lower than the grace window so we re-check before the cushion runs
 * out.
 */
export const DEFAULT_VALIDATION_TTL_DAYS = 7;

export function maskKey(key: string): string {
  if (!key) return '—';
  const cleaned = key.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (cleaned.length < 4) return '****-****-****';
  return `****-****-${cleaned.slice(-4)}`;
}

export function lastFour(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return cleaned.slice(-4);
}

export const EMPTY_STATE: LicenseState = {
  provider: 'lemonsqueezy',
  plan: 'free',
  status: 'none',
  licenseKeyLast4: null,
  instanceId: null,
  instanceName: null,
  activatedAt: null,
  expiresAt: null,
  lastValidatedAt: null,
  validationGraceUntil: null,
  productName: null,
  variantName: null,
};

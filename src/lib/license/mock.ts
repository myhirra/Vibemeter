/**
 * Test-only license provider. Lets a test specify the response shape per
 * call (success, activation-limit, network failure, etc.) without making a
 * real HTTP call to Lemon Squeezy.
 *
 * The mock keeps its own counters so tests can assert how many times each
 * method ran.
 */

import {
  DEFAULT_GRACE_DAYS,
  EMPTY_STATE,
  lastFour,
  type ActivateResult,
  type DeactivateResult,
  type LicenseState,
  type PaymentProvider,
  type ValidateResult,
} from './provider';

export interface MockProviderConfig {
  activate?: (key: string, instanceName: string) => Promise<ActivateResult>;
  validate?: (state: LicenseState) => Promise<ValidateResult>;
  deactivate?: (state: LicenseState) => Promise<DeactivateResult>;
  /** Sticky default behaviour when no per-method override is set. */
  defaultActivate?: 'success' | 'activationLimit' | 'invalidKey' | 'network';
  defaultValidate?: 'success' | 'invalid' | 'network';
  defaultDeactivate?: 'success' | 'network';
  checkoutUrl?: string | null;
}

export class MockProvider implements PaymentProvider {
  readonly calls = { activate: 0, validate: 0, deactivate: 0 };
  config: MockProviderConfig;

  constructor(config: MockProviderConfig = {}) {
    this.config = config;
  }

  getCheckoutUrl(plan: 'pro' | 'team'): string | null {
    if (plan === 'team') return null;
    return this.config.checkoutUrl ?? null;
  }

  async activateLicense(key: string, instanceName: string): Promise<ActivateResult> {
    this.calls.activate++;
    if (this.config.activate) return this.config.activate(key, instanceName);
    return defaultActivate(key, instanceName, this.config.defaultActivate ?? 'success');
  }

  async validateLicense(state: LicenseState): Promise<ValidateResult> {
    this.calls.validate++;
    if (this.config.validate) return this.config.validate(state);
    return defaultValidate(state, this.config.defaultValidate ?? 'success');
  }

  async deactivateLicense(state: LicenseState): Promise<DeactivateResult> {
    this.calls.deactivate++;
    if (this.config.deactivate) return this.config.deactivate(state);
    return defaultDeactivate(state, this.config.defaultDeactivate ?? 'success');
  }
}

async function defaultActivate(
  key: string,
  instanceName: string,
  mode: NonNullable<MockProviderConfig['defaultActivate']>,
): Promise<ActivateResult> {
  if (mode === 'activationLimit') return { ok: false, errorKey: 'billing.error.activationLimit' };
  if (mode === 'invalidKey') return { ok: false, errorKey: 'billing.error.invalidKey' };
  if (mode === 'network') return { ok: false, errorKey: 'billing.error.network' };
  const now = Date.now();
  return {
    ok: true,
    state: {
      ...EMPTY_STATE,
      provider: 'mock',
      plan: 'pro',
      status: 'active',
      licenseKeyLast4: lastFour(key),
      instanceId: `mock-instance-${Math.abs(hashCode(key))}`,
      instanceName,
      activatedAt: now,
      lastValidatedAt: now,
      validationGraceUntil: now + DEFAULT_GRACE_DAYS * 86_400_000,
      productName: 'Vibemeter Pro',
      variantName: 'Founding',
    },
  };
}

async function defaultValidate(
  prev: LicenseState,
  mode: NonNullable<MockProviderConfig['defaultValidate']>,
): Promise<ValidateResult> {
  if (mode === 'network') return { ok: false, reached: false, errorKey: 'billing.error.network' };
  if (mode === 'invalid') {
    return {
      ok: false,
      reached: true,
      errorKey: 'billing.error.invalidKey',
      state: { ...prev, plan: 'free', status: 'inactive', lastValidatedAt: Date.now() },
    };
  }
  const now = Date.now();
  return {
    ok: true,
    reached: true,
    state: {
      ...prev,
      plan: 'pro',
      status: 'active',
      lastValidatedAt: now,
      validationGraceUntil: now + DEFAULT_GRACE_DAYS * 86_400_000,
    },
  };
}

async function defaultDeactivate(
  _state: LicenseState,
  mode: NonNullable<MockProviderConfig['defaultDeactivate']>,
): Promise<DeactivateResult> {
  if (mode === 'network') return { ok: false, errorKey: 'billing.error.network' };
  return { ok: true };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

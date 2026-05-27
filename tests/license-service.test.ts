/**
 * Tests for `src/lib/license/service.ts`.
 *
 * The license service keeps module-level state (the active provider) and
 * persists license metadata to `<VIBEMETER_DATA_DIR>/license-state.json`. To
 * keep tests fully isolated we:
 *
 *   1. Register a tiny Node resolver hook (`tests/_resolve.mjs`) so the
 *      service's `@/` and extensionless TypeScript imports resolve without
 *      touching production code.
 *   2. Force the file-based key fallback (skip the macOS keychain) so tests
 *      never poke the user's real Keychain.
 *   3. Point `VIBEMETER_DATA_DIR` at a fresh temp directory per test and
 *      inject a fresh `MockProvider` via `setProvider`.
 */

import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.VIBEMETER_LICENSE_FORCE_FALLBACK = '1';

register('./_resolve.mjs', import.meta.url);

// Dynamic imports must come *after* register(); these are intentionally async
// so the loader hook is installed before the module graph is walked.
const { activate, validate, deactivate, getCurrentState, setProvider } = await import(
  '../src/lib/license/service.ts'
);
const { MockProvider } = await import('../src/lib/license/mock.ts');
const { readState, writeState, writeKey, readKey } = await import(
  '../src/lib/license/storage.ts'
);
const { DEFAULT_GRACE_DAYS, EMPTY_STATE } = await import(
  '../src/lib/license/provider.ts'
);

type MockProviderType = InstanceType<typeof MockProvider>;
type LicenseState = ReturnType<typeof readState>;

const DAY = 86_400_000;

function setupTestEnv(): { mock: MockProviderType; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibemeter-license-'));
  process.env.VIBEMETER_DATA_DIR = dir;
  const mock = new MockProvider();
  setProvider(mock);
  return { mock, dir };
}

function teardown(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  delete process.env.VIBEMETER_DATA_DIR;
}

function seedActiveState(overrides: Partial<LicenseState> = {}): LicenseState {
  const now = Date.now();
  const state: LicenseState = {
    ...EMPTY_STATE,
    provider: 'mock',
    plan: 'pro',
    status: 'active',
    licenseKeyLast4: 'AAAA',
    instanceId: 'mock-instance-1',
    instanceName: 'tester@laptop',
    activatedAt: now - 10 * DAY,
    lastValidatedAt: now - 1 * DAY,
    validationGraceUntil: now + DEFAULT_GRACE_DAYS * DAY,
    productName: 'Vibemeter Pro',
    variantName: 'Founding',
    ...overrides,
  };
  writeState(state);
  writeKey('AAAA-BBBB-CCCC-AAAA');
  return state;
}

test('activate writes state + key on a successful provider response', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    const res = await activate('SECRET-KEY-1234');
    assert.equal(res.ok, true);
    assert.equal(mock.calls.activate, 1);
    assert.equal(res.state.plan, 'pro');
    assert.equal(res.state.status, 'active');

    // Service should have persisted the new state to disk.
    const current = getCurrentState();
    assert.equal(current.plan, 'pro');
    assert.equal(current.status, 'active');
    assert.equal(current.licenseKeyLast4, '1234');
    assert.equal(readKey(), 'SECRET-KEY-1234');
  } finally {
    teardown(dir);
  }
});

test('activate surfaces an invalid-key error without mutating state', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.defaultActivate = 'invalidKey';
    const res = await activate('BAD-KEY');
    assert.equal(res.ok, false);
    assert.equal(res.errorKey, 'billing.error.invalidKey');
    assert.equal(res.state.plan, 'free');
    assert.equal(res.state.status, 'none');
    assert.equal(readKey(), null, 'no key should have been persisted');
  } finally {
    teardown(dir);
  }
});

test('activate surfaces the activation-limit error from the provider', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.defaultActivate = 'activationLimit';
    const res = await activate('LIMITED-KEY');
    assert.equal(res.ok, false);
    assert.equal(res.errorKey, 'billing.error.activationLimit');
    assert.equal(res.state.plan, 'free');
    assert.equal(readKey(), null);
  } finally {
    teardown(dir);
  }
});

test('validate returns cached state without hitting the provider within the 7d TTL', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    seedActiveState({ lastValidatedAt: Date.now() - 1 * DAY });
    const res = await validate();
    assert.equal(res.ok, true);
    assert.equal(res.state.plan, 'pro');
    assert.equal(mock.calls.validate, 0, 'validation should be cached');
  } finally {
    teardown(dir);
  }
});

test('validate hits the provider once the cached validation is older than 7d', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    const before = Date.now();
    seedActiveState({ lastValidatedAt: before - 8 * DAY });
    const res = await validate();
    assert.equal(res.ok, true);
    assert.equal(mock.calls.validate, 1);
    assert.ok(
      res.state.lastValidatedAt != null && res.state.lastValidatedAt >= before,
      'lastValidatedAt should be refreshed',
    );
  } finally {
    teardown(dir);
  }
});

test('validate keeps Pro within the grace window when the provider is unreachable', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.defaultValidate = 'network';
    const now = Date.now();
    seedActiveState({
      lastValidatedAt: now - 8 * DAY,
      validationGraceUntil: now + 2 * DAY,
    });
    const res = await validate();
    assert.equal(res.ok, true);
    assert.equal(res.state.plan, 'pro');
    assert.equal(res.errorKey, 'billing.error.network');
    // No downgrade should be written to disk either.
    assert.equal(readState().plan, 'pro');
  } finally {
    teardown(dir);
  }
});

test('validate downgrades to Free when the grace window has elapsed', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.defaultValidate = 'network';
    const now = Date.now();
    seedActiveState({
      lastValidatedAt: now - 30 * DAY,
      validationGraceUntil: now - 1 * DAY,
    });
    const res = await validate();
    assert.equal(res.ok, false);
    assert.equal(res.state.plan, 'free');
    assert.equal(res.state.status, 'inactive');
    // The service forwards the upstream error key when one is present and
    // only falls back to `graceExpired` when the provider was silent.
    assert.equal(res.errorKey, 'billing.error.network');
    assert.equal(readState().plan, 'free');
  } finally {
    teardown(dir);
  }
});

test('validate falls back to the graceExpired error when the provider was silent', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.validate = async () => ({ ok: false, reached: false });
    const now = Date.now();
    seedActiveState({
      lastValidatedAt: now - 30 * DAY,
      validationGraceUntil: now - 1 * DAY,
    });
    const res = await validate();
    assert.equal(res.ok, false);
    assert.equal(res.state.plan, 'free');
    assert.equal(res.errorKey, 'billing.error.graceExpired');
  } finally {
    teardown(dir);
  }
});

test('validate downgrades immediately when the provider reports the license disabled', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    const now = Date.now();
    mock.config.validate = async (state) => ({
      ok: true,
      reached: true,
      state: { ...state, plan: 'free', status: 'disabled', lastValidatedAt: now },
    });
    seedActiveState({ lastValidatedAt: now - 8 * DAY });
    const res = await validate();
    assert.equal(res.ok, true);
    assert.equal(res.state.plan, 'free');
    assert.equal(res.state.status, 'disabled');
    assert.equal(readState().plan, 'free');
  } finally {
    teardown(dir);
  }
});

test('deactivate clears storage when the provider acknowledges the request', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    seedActiveState();
    const res = await deactivate();
    assert.equal(res.ok, true);
    assert.equal(mock.calls.deactivate, 1);
    const after = getCurrentState();
    assert.equal(after.plan, 'free');
    assert.equal(after.status, 'none');
    assert.equal(readKey(), null);
  } finally {
    teardown(dir);
  }
});

test('deactivate leaves storage untouched when the provider fails', async () => {
  const { mock, dir } = setupTestEnv();
  try {
    mock.config.defaultDeactivate = 'network';
    seedActiveState();
    const res = await deactivate();
    assert.equal(res.ok, false);
    assert.equal(res.errorKey, 'billing.error.network');
    const after = getCurrentState();
    assert.equal(after.plan, 'pro');
    assert.equal(after.status, 'active');
    assert.equal(readKey(), 'AAAA-BBBB-CCCC-AAAA', 'key should still be on disk');
  } finally {
    teardown(dir);
  }
});

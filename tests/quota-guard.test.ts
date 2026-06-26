import assert from 'node:assert/strict';
import test from 'node:test';

import { decideQuotaGuard } from '../src/lib/quota-guard.ts';

function stats(remaining5h: number | null, remainingWeekly: number | null, pace5hExhaustMin: number | null = null) {
  return {
    generatedAt: 1,
    quotas: [{
      agent: 'codex' as const,
      label: 'Codex',
      accountLabel: null,
      remaining5h,
      used5h: remaining5h == null ? null : 100 - remaining5h,
      remainingWeekly,
      usedWeekly: remainingWeekly == null ? null : 100 - remainingWeekly,
      resetAt5h: null,
      resetAtWeekly: null,
      capturedAt: 1,
      stale: false,
      pace5hExhaustMin,
      pace5hPctPerMin: null,
    }],
  };
}

test('quota guard marks healthy quota as safe', () => {
  assert.equal(decideQuotaGuard(stats(82, 74)).status, 'safe');
});

test('quota guard warns before low quota becomes critical', () => {
  assert.equal(decideQuotaGuard(stats(42, 74)).status, 'watch');
  assert.equal(decideQuotaGuard(stats(22, 74)).status, 'risky');
  assert.equal(decideQuotaGuard(stats(8, 74)).status, 'wait');
});

test('quota guard uses burn-rate pace as a risk signal', () => {
  assert.equal(decideQuotaGuard(stats(80, 80, 90)).status, 'watch');
  assert.equal(decideQuotaGuard(stats(80, 80, 40)).status, 'risky');
  assert.equal(decideQuotaGuard(stats(80, 80, 10)).status, 'wait');
});


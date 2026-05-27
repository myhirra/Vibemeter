import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeQuotaWindow } from '../src/lib/quota-window.ts';

test('quota window keeps current usage before reset', () => {
  const resetAt = 10_000;
  const window = normalizeQuotaWindow(81, resetAt, 5_000, 9_000);

  assert.deepEqual(window, {
    used: 81,
    remaining: 19,
    resetAt,
    rolledOver: false,
  });
});

test('quota window rolls over immediately after reset', () => {
  const resetAt = 10_000;
  const window = normalizeQuotaWindow(81, resetAt, 5_000, 10_001);

  assert.deepEqual(window, {
    used: 0,
    remaining: 100,
    resetAt: 15_000,
    rolledOver: true,
  });
});

test('quota window rolls over multiple elapsed windows', () => {
  const resetAt = 10_000;
  const window = normalizeQuotaWindow(81, resetAt, 5_000, 22_000);

  assert.equal(window.used, 0);
  assert.equal(window.remaining, 100);
  assert.equal(window.resetAt, 25_000);
  assert.equal(window.rolledOver, true);
});

test('quota window does not infer rollover without reset time', () => {
  const window = normalizeQuotaWindow(81, null, 5_000, 22_000);

  assert.equal(window.used, 81);
  assert.equal(window.remaining, 19);
  assert.equal(window.resetAt, null);
  assert.equal(window.rolledOver, false);
});

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
    stale: false,
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
    stale: false,
  });
});

test('quota window rolls over multiple elapsed windows', () => {
  const resetAt = 10_000;
  const window = normalizeQuotaWindow(81, resetAt, 5_000, 22_000);

  assert.equal(window.used, 0);
  assert.equal(window.remaining, 100);
  assert.equal(window.resetAt, 25_000);
  assert.equal(window.rolledOver, true);
  assert.equal(window.stale, false);
});

test('quota window does not infer rollover without reset time', () => {
  const window = normalizeQuotaWindow(81, null, 5_000, 22_000);

  assert.equal(window.used, 81);
  assert.equal(window.remaining, 19);
  assert.equal(window.resetAt, null);
  assert.equal(window.rolledOver, false);
  assert.equal(window.stale, false);
});

test('quota window flags stale instead of fabricating rollover from old snapshot', () => {
  const resetAt = 10_000;
  // Snapshot captured 4 windows ago and reset is long past: the old code would
  // claim used=0 / 100% remaining with a fresh countdown. We must keep the
  // last-known reading and mark it stale.
  const window = normalizeQuotaWindow(10, resetAt, 5_000, 30_000, /* capturedAt */ 8_000);

  assert.equal(window.used, 10);
  assert.equal(window.remaining, 90);
  assert.equal(window.resetAt, resetAt, 'does not project a fresh reset time');
  assert.equal(window.rolledOver, false);
  assert.equal(window.stale, true);
});

test('quota window still rolls over when the snapshot is recent', () => {
  const resetAt = 10_000;
  // Reset just passed but the snapshot is only seconds old (within one window):
  // the window genuinely rolled, so 0% is honest, not fabricated.
  const window = normalizeQuotaWindow(81, resetAt, 5_000, 10_500, /* capturedAt */ 9_900);

  assert.equal(window.used, 0);
  assert.equal(window.rolledOver, true);
  assert.equal(window.stale, false);
});

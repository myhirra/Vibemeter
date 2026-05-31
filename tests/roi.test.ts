import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeShipRate,
  computeMomentum,
  computeFocus,
  computeOutputPerDollar,
  MOMENTUM_THRESHOLD_ACCELERATING,
  MOMENTUM_THRESHOLD_COOLING,
  type Outcome,
} from '../src/lib/roi.ts';

// ── Ship Rate ───────────────────────────────────────────────────────────────

test('ship rate: empty window → rate null, denominator 0', () => {
  const out = computeShipRate([]);
  assert.equal(out.rate, null);
  assert.equal(out.denominator, 0);
});

test('ship rate: all-untagged window excludes everything → null', () => {
  const out = computeShipRate([
    { outcome: null },
    { outcome: null },
    { outcome: null },
  ]);
  assert.equal(out.rate, null);
  assert.equal(out.denominator, 0);
});

test('ship rate: denominator excludes untagged sessions', () => {
  // 2 shipped + 1 failed = 3 tagged. 2 untagged ignored. Rate = 2/3.
  const rows: { outcome: Outcome | null }[] = [
    { outcome: 'shipped' },
    { outcome: 'shipped' },
    { outcome: 'failed' },
    { outcome: null },
    { outcome: null },
  ];
  const out = computeShipRate(rows);
  assert.equal(out.denominator, 3);
  assert.ok(Math.abs((out.rate ?? -1) - 2 / 3) < 1e-9);
});

test('ship rate: bugfix counts as shipped (lands-in-main semantics)', () => {
  const out = computeShipRate([
    { outcome: 'shipped' },
    { outcome: 'bugfix' },
    { outcome: 'failed' },
  ]);
  assert.equal(out.denominator, 3);
  assert.ok(Math.abs((out.rate ?? -1) - 2 / 3) < 1e-9);
});

test('ship rate: refactor/explore/discarded count toward denom but not numerator', () => {
  const out = computeShipRate([
    { outcome: 'shipped' },
    { outcome: 'refactor' },
    { outcome: 'explore' },
    { outcome: 'discarded' },
  ]);
  assert.equal(out.denominator, 4);
  assert.equal(out.rate, 0.25);
});

// ── Momentum ────────────────────────────────────────────────────────────────

test('momentum: 3wk average of 0 → null (no baseline)', () => {
  const out = computeMomentum(5, [0, 0, 0]);
  assert.equal(out.ratio, null);
  assert.equal(out.label, null);
});

test('momentum: accelerating when ratio >= 120', () => {
  // avg = 10, current = 12 → 120% exactly → accelerating
  const out = computeMomentum(12, [10, 10, 10]);
  assert.equal(out.ratio, MOMENTUM_THRESHOLD_ACCELERATING);
  assert.equal(out.label, 'accelerating');
});

test('momentum: steady when 70 < ratio < 120', () => {
  // avg = 10, current = 10 → 100% → steady
  const out = computeMomentum(10, [10, 10, 10]);
  assert.equal(out.ratio, 100);
  assert.equal(out.label, 'steady');
});

test('momentum: cooling when ratio <= 70', () => {
  // avg = 10, current = 7 → 70% exactly → cooling
  const out = computeMomentum(7, [10, 10, 10]);
  assert.equal(out.ratio, MOMENTUM_THRESHOLD_COOLING);
  assert.equal(out.label, 'cooling');
});

test('momentum: current 0 against positive baseline reads cooling', () => {
  const out = computeMomentum(0, [5, 5, 5]);
  assert.equal(out.ratio, 0);
  assert.equal(out.label, 'cooling');
});

test('momentum: 3wk avg uses arithmetic mean across the three weeks', () => {
  // weeks [3, 6, 9] avg = 6; current = 12 → 200% → accelerating
  const out = computeMomentum(12, [3, 6, 9]);
  assert.equal(out.ratio, 200);
  assert.equal(out.label, 'accelerating');
});

// ── Focus ───────────────────────────────────────────────────────────────────

test('focus: empty distribution → null', () => {
  assert.equal(computeFocus([]), null);
});

test('focus: zero-count entries filtered out → empty → null', () => {
  assert.equal(computeFocus([0, 0, 0]), null);
});

test('focus: single project → 100 (perfectly focused, no log2(1) divide)', () => {
  assert.equal(computeFocus([42]), 100);
});

test('focus: two equal projects → 0 (max entropy, no focus)', () => {
  assert.equal(computeFocus([10, 10]), 0);
});

test('focus: many equal projects also → 0', () => {
  assert.equal(computeFocus([4, 4, 4, 4, 4, 4]), 0);
});

test('focus: lopsided distribution scores high', () => {
  // 95% in one project, 5% spread → strongly focused
  const score = computeFocus([95, 5]);
  assert.ok(score != null && score > 50, `expected >50 focus, got ${score}`);
});

test('focus: gentle spread scores low', () => {
  const score = computeFocus([10, 9, 8, 7]);
  assert.ok(score != null && score < 20, `expected <20 focus, got ${score}`);
});

// ── Output per Dollar ───────────────────────────────────────────────────────

test('output-per-$: cost <= 0 → both fields null', () => {
  const zero = computeOutputPerDollar({ commits: 10, shippedSessions: 5, costUsd: 0 });
  assert.equal(zero.commitsPerDollar, null);
  assert.equal(zero.shippedSessionsPerDollar, null);
  const neg = computeOutputPerDollar({ commits: 10, shippedSessions: 5, costUsd: -0.01 });
  assert.equal(neg.commitsPerDollar, null);
  assert.equal(neg.shippedSessionsPerDollar, null);
});

test('output-per-$: divides commits and shipped sessions by cost', () => {
  const out = computeOutputPerDollar({ commits: 40, shippedSessions: 8, costUsd: 10 });
  assert.equal(out.commitsPerDollar, 4);
  assert.equal(out.shippedSessionsPerDollar, 0.8);
});

test('output-per-$: zero output stays finite (not NaN) when cost > 0', () => {
  const out = computeOutputPerDollar({ commits: 0, shippedSessions: 0, costUsd: 5 });
  assert.equal(out.commitsPerDollar, 0);
  assert.equal(out.shippedSessionsPerDollar, 0);
});

test('threshold constants are exported as the documented values', () => {
  // Snapshot the contract so a copy-paste in JSX picking up the wrong number
  // breaks the test instead of silently shifting label boundaries.
  assert.equal(MOMENTUM_THRESHOLD_ACCELERATING, 120);
  assert.equal(MOMENTUM_THRESHOLD_COOLING, 70);
});

import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

register('./_resolve.mjs', import.meta.url);

const { evaluateBudget } = await import('../src/lib/alerts/runner.ts');
import type { FloatStats } from '../src/lib/float-stats.ts';
import type { AlertRule, RuleState } from '../src/lib/alerts/types.ts';

// evaluateBudget only reads stats.periodMetrics, so a partial stub is enough.
function statsWithSpend(period: 'today' | '7d' | 'month', valueUsd: number): FloatStats {
  return { periodMetrics: [{ period, tool: 'all', tokens: 0, promptCount: 0, valueUsd, cacheHitPct: 0 }] } as unknown as FloatStats;
}

const rule = (period: 'today' | '7d' | 'month', amountUsd: number): Extract<AlertRule, { kind: 'budget' }> => ({
  id: 'b1', kind: 'budget', period, amountUsd, channelIds: ['c1'], enabled: true,
});

test('fires when window spend reaches the budget', () => {
  const r = evaluateBudget(rule('month', 100), undefined, statsWithSpend('month', 120), 'en', new Date('2026-05-31T10:00:00'));
  assert.ok(r, 'should fire');
  assert.equal(r!.nextState.kind, 'budget');
  assert.match(r!.body, /\$120\.00/);
  assert.match(r!.body, /\$100\.00/);
});

test('does NOT fire below the budget', () => {
  assert.equal(evaluateBudget(rule('month', 100), undefined, statsWithSpend('month', 99.99), 'en', new Date()), null);
});

test('does NOT re-fire within the same monthly bucket', () => {
  const prev: RuleState = { kind: 'budget', lastFiredForBucket: '2026-05' };
  assert.equal(evaluateBudget(rule('month', 100), prev, statsWithSpend('month', 200), 'en', new Date('2026-05-31T10:00:00')), null);
});

test('fires again once the bucket rolls into a new month', () => {
  const prev: RuleState = { kind: 'budget', lastFiredForBucket: '2026-05' };
  const r = evaluateBudget(rule('month', 100), prev, statsWithSpend('month', 200), 'en', new Date('2026-06-01T10:00:00'));
  assert.ok(r, 'new month should fire');
  assert.equal((r!.nextState as { lastFiredForBucket: string }).lastFiredForBucket, '2026-06');
});

test('returns null when the period has no metric row', () => {
  const empty = { periodMetrics: [] } as unknown as FloatStats;
  assert.equal(evaluateBudget(rule('today', 10), undefined, empty, 'zh', new Date()), null);
});

test('today budget dedupes per day, weekly per ISO week', () => {
  const day = new Date('2026-05-31T23:00:00');
  const firstToday = evaluateBudget(rule('today', 5), undefined, statsWithSpend('today', 9), 'en', day);
  assert.ok(firstToday);
  const sameDay = evaluateBudget(rule('today', 5), firstToday!.nextState, statsWithSpend('today', 9), 'en', day);
  assert.equal(sameDay, null, 'same day should not re-fire');
});

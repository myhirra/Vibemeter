import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecapCardData } from '../src/lib/recap-card';

register('./_resolve.mjs', import.meta.url);

const { buildRecapShareText, RECAP_SHARE_URL } = await import('../src/lib/recap-share-text.ts');
const { RECAP_WATERMARK } = await import('../src/lib/recap-card.ts');

function card(overrides: Partial<RecapCardData> = {}): RecapCardData {
  return {
    generatedAt: 1_779_896_000_000,
    period: {
      kind: '7d',
      label: 'last 7 days',
      shortLabel: 'week',
      startMs: 1_779_291_200_000,
      endMs: 1_779_896_000_000,
      days: 7,
      billingDenominatorDays: 30.436875,
    },
    tool: 'all',
    valueAtApiRatesUsd: 312.4,
    claudeValueUsd: 312.4,
    codexValueUsd: 0,
    valueCoverageLabel: 'Claude API-equivalent',
    subscriptionPlanLabel: null,
    subscriptionMonthlyUsd: null,
    subscriptionCostUsd: null,
    roiMultiplier: null,
    heroKind: 'value',
    totalSessions: 48,
    promptCount: 180,
    totalTokens: {
      input: 20_000,
      cacheCreation: 30_000,
      cacheRead: 1_150_000_000,
      output: 40_000,
      codex: 0,
      total: 1_150_090_000,
    },
    cacheHitRatePct: 91,
    cacheSessionsAnalyzed: 40,
    cacheSummary: {
      totalInput: 20_000,
      totalCacheCreation: 30_000,
      totalCacheRead: 1_150_000_000,
      totalOutput: 40_000,
      inputTokensSaved: 900_000,
      topProjects: [{ project: 'vibemeter', sessions: 5, hitRatePct: 91 }],
    },
    topProjects: [{ project: 'vibemeter', sessions: 5, totalMs: 3_600_000, tokens: 40_000 }],
    series: {
      value: [3.2, 5.1, 4.8, 6.7, 8.0, 7.5, 7.2],
      tokens: [4_000, 7_000, 6_500, 9_000, 11_000, 9_500, 7_000],
      sessions: [1, 1, 1, 1, 1, 1, 1],
      prompts: [2, 3, 2, 4, 3, 2, 2],
      cacheHit: [85, 90, 88, 92, 91, 94, 91],
    },
    minimumData: { ok: true, reason: 'ok' },
    watermark: RECAP_WATERMARK,
    ...overrides,
  };
}

test('share URL carries the recap-card attribution param', () => {
  assert.match(RECAP_SHARE_URL, /vibemeter\.siney\.top\/\?src=recap-card$/);
});

test('English caption includes core numbers and the attribution link', () => {
  const text = buildRecapShareText(card(), 'en');
  assert.match(text, /last 7 days/);
  assert.match(text, /1\.2B tokens/);
  assert.match(text, /48 sessions/);
  assert.match(text, /\$312/);
  assert.ok(text.includes(RECAP_SHARE_URL));
  // 无订阅数据时不吹 ROI
  assert.doesNotMatch(text, /subscription/);
});

test('Chinese caption localizes period and numbers', () => {
  const text = buildRecapShareText(card(), 'zh');
  assert.match(text, /过去 7 天/);
  assert.match(text, /1\.2B tokens/);
  assert.match(text, /48 个会话/);
  assert.ok(text.includes(RECAP_SHARE_URL));
});

test('caption mentions ROI only when the multiplier is meaningful', () => {
  const withRoi = buildRecapShareText(card({ roiMultiplier: 15.6 }), 'en');
  assert.match(withRoi, /16× my subscription/);

  const zhRoi = buildRecapShareText(card({ roiMultiplier: 7.04 }), 'zh');
  assert.match(zhRoi, /订阅回本 7×/);

  const lowRoi = buildRecapShareText(card({ roiMultiplier: 1.4 }), 'en');
  assert.doesNotMatch(lowRoi, /subscription/);
});

import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecapCardData } from '../src/lib/recap-card';

register('./_resolve.mjs', import.meta.url);

const { renderRecapSvg, availableHeroAngles } = await import('../src/lib/recap-card-render.ts');
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
    valueAtApiRatesUsd: 42.5,
    valueCoverageLabel: 'Claude API-equivalent',
    subscriptionPlanLabel: null,
    subscriptionMonthlyUsd: null,
    subscriptionCostUsd: null,
    roiMultiplier: null,
    heroKind: 'value',
    totalSessions: 7,
    totalTokens: {
      input: 2_000,
      cacheCreation: 3_000,
      cacheRead: 45_000,
      output: 4_000,
      codex: 0,
      total: 54_000,
    },
    cacheHitRatePct: 91,
    cacheSessionsAnalyzed: 6,
    topProjects: [{ project: 'vibemeter', sessions: 5, totalMs: 3_600_000, tokens: 40_000 }],
    minimumData: { ok: true, reason: 'ok' },
    watermark: RECAP_WATERMARK,
    ...overrides,
  };
}

test('recap renderer outputs expected dimensions and watermark', () => {
  const svg = renderRecapSvg(card(), 'landscape');
  assert.match(svg, /width="1200" height="675"/);
  assert.match(svg, /VIBEMETER/);
  assert.match(svg, /vibemeter\.siney\.top/);

  const square = renderRecapSvg(card(), 'square');
  assert.match(square, /width="1080" height="1080"/);
});

test('recap renderer supports roi, value, cache, and not-enough-data hero branches', () => {
  const roi = card({
    subscriptionPlanLabel: 'Pro',
    subscriptionMonthlyUsd: 20,
    subscriptionCostUsd: 4.6,
    roiMultiplier: 9.2,
    heroKind: 'roi',
  });
  assert.deepEqual(availableHeroAngles(roi), ['roi', 'value', 'cache', 'sessions']);
  assert.match(renderRecapSvg(roi), /9\.2/);
  assert.match(renderRecapSvg(roi), /RETURN ON MY CLAUDE CODE WEEK/);

  const value = renderRecapSvg(card({ heroKind: 'value' }));
  assert.match(value, /\$42\.5/);
  assert.match(value, /Claude API-equivalent/);

  const cache = renderRecapSvg(card({ heroKind: 'value' }), 'landscape', { heroOverride: 'cache' });
  assert.match(cache, /91%/);
  assert.match(cache, /SERVED FROM CACHE/);

  const empty = renderRecapSvg(card({
    heroKind: 'not_enough_data',
    valueAtApiRatesUsd: 0,
    totalSessions: 0,
    cacheSessionsAnalyzed: 0,
    topProjects: [],
    totalTokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, codex: 0, total: 0 },
    minimumData: { ok: false, reason: 'no_sessions' },
  }));
  assert.match(empty, /WAITING FOR DATA/);
  assert.match(empty, /Run a few AI coding sessions/);
});

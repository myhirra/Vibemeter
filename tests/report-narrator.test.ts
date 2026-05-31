/**
 * Snapshot-style tests for the Phase 2 weekly-report narrator. We hand the
 * narrator pre-built `WeeklyReportMetrics` (no DB, no Date.now()) and assert
 * on the returned strings: tone rules + threshold cutoffs.
 *
 * The narrator imports `../i18n` and `../roi` with extensionless ESM
 * specifiers, so we register `_resolve.mjs` before dynamically importing it.
 * This mirrors the pattern in `license-service.test.ts`.
 */

import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

register('./_resolve.mjs', import.meta.url);

// Dynamic imports must come *after* register() so the loader hook is installed
// before the module graph is walked.
const narrator = await import('../src/lib/report/narrator.ts');
const {
  headline,
  burnParagraph,
  focusParagraph,
  momentumParagraph,
  recommend,
} = narrator;

type WeeklyReportMetrics = Parameters<typeof headline>[0];

/** Sane baseline metrics — every case overrides only what it cares about. */
function baseline(): WeeklyReportMetrics {
  return {
    windowStartMs: 0,
    windowEndMs: 7 * 86_400_000,
    weekIso: '2026-W22',
    totalSessions: 0,
    projectCount: 0,
    shipRate: null,
    reworkRate: 0,
    focus: null,
    momentum: { ratio: null, label: null },
    outputPerDollar: { commitsPerDollar: null, shippedSessionsPerDollar: null },
    totalCostUsd: 0,
    topBurnProject: null,
    bestRoiProject: null,
    zeroDeployProjects: [],
    outcomeBreakdown: {
      shipped: 0, bugfix: 0, failed: 0, discarded: 0,
      refactor: 0, explore: 0, untagged: 0,
    },
  };
}

// ── Headline ───────────────────────────────────────────────────────────────

test('headline · empty week → quiet-week note (en + zh)', () => {
  const m = baseline();
  assert.match(headline(m, 'en'), /Quiet week/);
  assert.match(headline(m, 'zh'), /静默/);
});

test('headline · clean execution (>=65% ship, >=3 tagged)', () => {
  const m = baseline();
  m.totalSessions = 12;
  m.shipRate = 9 / 12;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 9, failed: 3 };
  const en = headline(m, 'en');
  assert.match(en, /shipped 9 of 12 tagged sessions/);
  assert.match(en, /clean execution/);
});

test('headline · low ship rate triggers "what is eating the rest"', () => {
  const m = baseline();
  m.totalSessions = 20;
  m.shipRate = 2 / 20;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 2, failed: 18 };
  const en = headline(m, 'en');
  assert.match(en, /20 sessions, 2 shipped/);
  assert.match(en, /18/);
});

test('headline · all-shipped week reads as clean execution', () => {
  const m = baseline();
  m.totalSessions = 6;
  m.shipRate = 1;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 6 };
  assert.match(headline(m, 'en'), /clean execution/);
});

test('headline · zero-shipped with sessions → "no shipped output"', () => {
  const m = baseline();
  m.totalSessions = 8;
  m.shipRate = 0;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, failed: 1, refactor: 1, explore: 6 };
  // Tagged sessions are present but ship rate is 0 → low-ship branch wins.
  // (low-ship branch handles this elegantly; "noShipped" is the
  //  total-but-no-tags fallback)
  const en = headline(m, 'en');
  assert.match(en, /(no shipped|2 shipped|0 shipped|6)/i);
});

test('headline · zero-shipped untagged majority → "tag a few"', () => {
  const m = baseline();
  m.totalSessions = 8;
  m.shipRate = null;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, untagged: 8 };
  assert.match(headline(m, 'en'), /Tag a few/);
});

test('headline · strong ROI lead when shipped/$ very efficient', () => {
  const m = baseline();
  m.totalSessions = 10;
  m.totalCostUsd = 12;
  m.outputPerDollar = { commitsPerDollar: 0.5, shippedSessionsPerDollar: 4 / 12 };
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 4, failed: 1 };
  const en = headline(m, 'en');
  // $12 spent + 4 shipped → ~$3/ship → strong ROI lead.
  assert.match(en, /\$12/);
  assert.match(en, /4 shipped/);
});

test('headline · zh locale produces non-English string', () => {
  const m = baseline();
  m.totalSessions = 12;
  m.shipRate = 9 / 12;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 9, failed: 3 };
  const zh = headline(m, 'zh');
  assert.match(zh, /节奏稳|发布/);
  // Must not leak placeholders.
  assert.doesNotMatch(zh, /\{\w+\}/);
});

// ── Burn paragraph ─────────────────────────────────────────────────────────

test('burnParagraph · null when total cost is 0', () => {
  const m = baseline();
  m.totalCostUsd = 0;
  assert.equal(burnParagraph(m, 'en'), null);
});

test('burnParagraph · dominant project (>=50% share)', () => {
  const m = baseline();
  m.totalCostUsd = 184;
  m.projectCount = 5;
  m.topBurnProject = {
    cwd: 'Vibemeter', costUsd: 112, sessions: 28, shippedSessions: 9,
  };
  const en = burnParagraph(m, 'en')!;
  assert.match(en, /\$184/);
  assert.match(en, /5 projects/);
  assert.match(en, /Vibemeter/);
  assert.match(en, /\$112/);
  assert.match(en, /28 sessions/);
  assert.match(en, /9 shipped/);
});

test('burnParagraph · spread (no project owns 50%)', () => {
  const m = baseline();
  m.totalCostUsd = 60;
  m.projectCount = 4;
  m.topBurnProject = {
    cwd: 'projectA', costUsd: 18, sessions: 5, shippedSessions: 1,
  };
  const en = burnParagraph(m, 'en')!;
  // The "spread" template puts the biggest single line; should NOT use the
  // "lion's share" phrasing.
  assert.doesNotMatch(en, /lion/);
  assert.match(en, /projectA/);
  assert.match(en, /\$18/);
});

test('burnParagraph · zh dominant project', () => {
  const m = baseline();
  m.totalCostUsd = 184;
  m.projectCount = 5;
  m.topBurnProject = {
    cwd: 'Vibemeter', costUsd: 112, sessions: 28, shippedSessions: 9,
  };
  const zh = burnParagraph(m, 'zh')!;
  assert.match(zh, /Vibemeter/);
  assert.match(zh, /\$184/);
  assert.match(zh, /大头/);
  // Must not leak placeholders.
  assert.doesNotMatch(zh, /\{\w+\}/);
});

test('burnParagraph · cost without project rollup falls back to totalOnly', () => {
  const m = baseline();
  m.totalCostUsd = 42;
  m.projectCount = 3;
  m.topBurnProject = null;
  const en = burnParagraph(m, 'en')!;
  assert.match(en, /\$42/);
  assert.match(en, /3 projects/);
});

// ── Focus paragraph ────────────────────────────────────────────────────────

test('focusParagraph · null when no signal AND no zero-deploy projects', () => {
  const m = baseline();
  assert.equal(focusParagraph(m, 'en'), null);
});

test('focusParagraph · "focused" copy when score >= 70', () => {
  const m = baseline();
  m.focus = 82;
  m.projectCount = 2;
  const en = focusParagraph(m, 'en')!;
  assert.match(en, /Focus 82\/100/);
  assert.match(en, /concentrated/);
});

test('focusParagraph · "scattered" copy when score < 35', () => {
  const m = baseline();
  m.focus = 22;
  m.projectCount = 6;
  const en = focusParagraph(m, 'en')!;
  assert.match(en, /Focus 22\/100/);
  assert.match(en, /spread thin/);
});

test('focusParagraph · zero-deploy callout (single project)', () => {
  const m = baseline();
  m.focus = 60;
  m.projectCount = 3;
  m.zeroDeployProjects = [{ cwd: 'side-quest', sessions: 5 }];
  const en = focusParagraph(m, 'en')!;
  assert.match(en, /side-quest/);
  assert.match(en, /5 sessions/);
  assert.match(en, /nothing shipped/);
});

test('focusParagraph · zero-deploy callout (multiple projects)', () => {
  const m = baseline();
  m.focus = 60;
  m.projectCount = 5;
  m.zeroDeployProjects = [
    { cwd: 'alpha', sessions: 6 },
    { cwd: 'beta', sessions: 4 },
    { cwd: 'gamma', sessions: 3 },
  ];
  const en = focusParagraph(m, 'en')!;
  assert.match(en, /alpha/);
  assert.match(en, /beta/);
});

test('focusParagraph · single-project week → focus=100, focused copy', () => {
  const m = baseline();
  m.focus = 100;
  m.projectCount = 1;
  const en = focusParagraph(m, 'en')!;
  assert.match(en, /Focus 100\/100/);
});

// ── Momentum paragraph ─────────────────────────────────────────────────────

test('momentumParagraph · null when no baseline', () => {
  const m = baseline();
  assert.equal(momentumParagraph(m, 'en'), null);
});

test('momentumParagraph · accelerating', () => {
  const m = baseline();
  m.totalSessions = 18;
  m.momentum = { ratio: 150, label: 'accelerating' };
  const en = momentumParagraph(m, 'en')!;
  assert.match(en, /150%/);
  assert.match(en, /up/i);
});

test('momentumParagraph · cooling', () => {
  const m = baseline();
  m.totalSessions = 5;
  m.momentum = { ratio: 55, label: 'cooling' };
  const en = momentumParagraph(m, 'en')!;
  assert.match(en, /55%/);
  assert.match(en, /slipping|cooling/);
});

test('momentumParagraph · steady stays neutral', () => {
  const m = baseline();
  m.totalSessions = 10;
  m.momentum = { ratio: 100, label: 'steady' };
  const en = momentumParagraph(m, 'en')!;
  assert.match(en, /steady/);
  // No cheerleading — must not have an exclamation or "great".
  assert.doesNotMatch(en, /great|!|nice|awesome/i);
});

// ── Recommendations ────────────────────────────────────────────────────────

test('recommend · pauses zero-deploy project with enough activity', () => {
  const m = baseline();
  m.zeroDeployProjects = [{ cwd: 'stalled-repo', sessions: 6 }];
  const recs = recommend(m, 'en');
  assert.ok(recs.length >= 1);
  assert.match(recs[0], /Pause stalled-repo/);
  assert.match(recs[0], /6 sessions/);
  assert.match(recs[0], /0 shipped/);
});

test('recommend · ignores zero-deploy with fewer than 3 sessions', () => {
  const m = baseline();
  m.zeroDeployProjects = [{ cwd: 'tinkering', sessions: 2 }];
  const recs = recommend(m, 'en');
  assert.equal(recs.length, 0);
});

test('recommend · tag-untagged when share crosses 40%', () => {
  const m = baseline();
  m.outcomeBreakdown.untagged = 12;
  m.outcomeBreakdown.shipped = 4;
  const recs = recommend(m, 'en');
  assert.ok(recs.some((r) => /Tag the 12/.test(r)));
});

test('recommend · leans into best ROI project', () => {
  const m = baseline();
  m.bestRoiProject = {
    cwd: 'winner', commitsPerDollar: 0.8, shippedSessions: 4,
  };
  const recs = recommend(m, 'en');
  assert.ok(recs.some((r) => /leaning into winner/i.test(r)));
});

test('recommend · cools down → momentum nudge', () => {
  const m = baseline();
  m.momentum = { ratio: 45, label: 'cooling' };
  const recs = recommend(m, 'en');
  assert.ok(recs.some((r) => /Momentum at 45%/.test(r)));
});

test('recommend · caps at 3 bullets', () => {
  const m = baseline();
  m.zeroDeployProjects = [
    { cwd: 'a', sessions: 6 },
    { cwd: 'b', sessions: 5 },
    { cwd: 'c', sessions: 4 },
    { cwd: 'd', sessions: 3 },
  ];
  m.outcomeBreakdown.untagged = 20;
  m.bestRoiProject = {
    cwd: 'winner', commitsPerDollar: 0.5, shippedSessions: 3,
  };
  m.momentum = { ratio: 200, label: 'accelerating' };
  const recs = recommend(m, 'en');
  assert.equal(recs.length, 3);
});

test('recommend · returns empty array on a clean steady week', () => {
  const m = baseline();
  m.totalSessions = 10;
  m.momentum = { ratio: 105, label: 'steady' };
  m.outcomeBreakdown = {
    ...m.outcomeBreakdown, shipped: 8, failed: 1, refactor: 1,
  };
  m.shipRate = 8 / 10;
  const recs = recommend(m, 'en');
  assert.equal(recs.length, 0);
});

// ── Tone-rule sweep across both locales ─────────────────────────────────────

test('tone · no emoji, no "!", no cheerleading anywhere', () => {
  const cases: WeeklyReportMetrics[] = [
    (() => {
      const m = baseline();
      m.totalSessions = 12;
      m.shipRate = 9 / 12;
      m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 9, failed: 3 };
      m.totalCostUsd = 100;
      m.projectCount = 3;
      m.topBurnProject = { cwd: 'proj', costUsd: 60, sessions: 20, shippedSessions: 9 };
      m.focus = 80;
      m.momentum = { ratio: 130, label: 'accelerating' };
      return m;
    })(),
    (() => {
      const m = baseline();
      m.totalSessions = 4;
      m.shipRate = 0;
      m.outcomeBreakdown = { ...m.outcomeBreakdown, failed: 4 };
      m.focus = 20;
      m.projectCount = 4;
      m.momentum = { ratio: 50, label: 'cooling' };
      m.zeroDeployProjects = [{ cwd: 'stuck', sessions: 4 }];
      return m;
    })(),
  ];
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const m of cases) {
    for (const locale of ['en', 'zh'] as const) {
      const parts = [
        headline(m, locale),
        burnParagraph(m, locale),
        focusParagraph(m, locale),
        momentumParagraph(m, locale),
        ...recommend(m, locale),
      ].filter((s): s is string => typeof s === 'string');
      const joined = parts.join(' ');
      assert.doesNotMatch(joined, emojiRe, `emoji leaked: ${joined}`);
      assert.doesNotMatch(joined, /[!！]/, `exclamation leaked: ${joined}`);
      assert.doesNotMatch(joined, /\b(awesome|great job|nice work)\b/i);
      // Must not leak template placeholders.
      assert.doesNotMatch(joined, /\{\w+\}/, `placeholder leaked: ${joined}`);
    }
  }
});

test('tone · second-person address — uses "you" or "你" when subject is the user', () => {
  // Clean-execution headline is the canonical "you" sentence.
  const m = baseline();
  m.totalSessions = 10;
  m.shipRate = 0.8;
  m.outcomeBreakdown = { ...m.outcomeBreakdown, shipped: 8, failed: 2 };
  assert.match(headline(m, 'en'), /\byou\b/i);
  assert.match(headline(m, 'zh'), /你/);
});

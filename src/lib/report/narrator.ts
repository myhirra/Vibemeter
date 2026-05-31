// Templater for the Phase 2 weekly report. Each section function returns a
// string in the requested locale by picking from 3-5 phrasings keyed off the
// metrics. Pure: no DB, no Date.now(), no IO. The Pro tier is what unlocks
// these paragraphs in the UI; the deterministic output keeps the headline
// pitch ("local-first, no telemetry") intact — no LLM call.
//
// Tone rules enforced here:
//   - Second person ("you" / "你"). Never third-person.
//   - No emoji, no cheerleading.
//   - Numbers + project names always. No "data unavailable".
//   - If a metric is null we *skip the line entirely* — never "N/A".
//   - All output goes through the i18n templater so the strings live in
//     messages.ts; this file owns key selection, not phrasing.

import { t as translate } from '../i18n/index';
import type { Locale } from '../i18n/types';
import {
  MOMENTUM_THRESHOLD_ACCELERATING,
  MOMENTUM_THRESHOLD_COOLING,
} from '../roi';
import type { WeeklyReportMetrics } from './weekly';

// ── Threshold constants ─────────────────────────────────────────────────────
// Exported so tests can pin behaviour without re-deriving the cutoffs.

/** Ship rate (over tagged sessions) at-or-above which we say "clean execution". */
export const SHIP_RATE_CLEAN_THRESHOLD = 0.65;
/** Ship rate at-or-below which we surface the "what ate the rest?" framing. */
export const SHIP_RATE_LOW_THRESHOLD = 0.2;
/** Below this many tagged sessions there isn't enough signal to lead with ship rate. */
export const MIN_TAGGED_FOR_HEADLINE = 3;

/** A project owns this share of the week's $ → labelled "dominant". */
export const DOMINANT_PROJECT_SHARE = 0.5;
/** Above this absolute spend → labelled "heavy" even if not dominant. */
export const HIGH_BURN_USD = 50;
/** Per-project sessions at-or-above which a 0-shipped streak is worth flagging. */
export const ZERO_DEPLOY_MIN_SESSIONS = 3;

/** Output-per-$ "strong" cutoff: >= 1 shipped session per $5. */
export const STRONG_ROI_USD_PER_SHIP = 5;

/** Untagged share at-or-above which we recommend the user tag sessions. */
export const HIGH_UNTAGGED_SHARE = 0.4;

// ── Helpers ────────────────────────────────────────────────────────────────

function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return translate(locale, key, vars);
}

function fmtUsd(value: number): string {
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 10) return `$${value.toFixed(0)}`;
  return `$${value.toFixed(2)}`;
}

function totalTaggedFromBreakdown(metrics: WeeklyReportMetrics): number {
  const b = metrics.outcomeBreakdown;
  return b.shipped + b.bugfix + b.failed + b.discarded + b.refactor + b.explore;
}

// ── Headline ───────────────────────────────────────────────────────────────
// One-line conclusion. Shown to FREE users too (everything else is gated).
//
// Decision tree (ordered): a metric earlier in the tree wins.
//   1. No sessions at all                          → "quiet week" note
//   2. Sessions but no tagged outcomes             → untagged-majority framing
//   3. Output-per-$ extremely strong               → "Strong ROI" lead
//   4. Ship rate clean (>=65%) & enough tagged     → "clean execution"
//   5. Ship rate very low (<=20%) & enough tagged  → "worth asking what's eating"
//   6. Zero shipped sessions, any data             → "nothing shipped this week"
//   7. Otherwise                                   → momentum-flavoured neutral

export function headline(metrics: WeeklyReportMetrics, locale: Locale): string {
  const shippedSessions = metrics.outcomeBreakdown.shipped + metrics.outcomeBreakdown.bugfix;
  const tagged = totalTaggedFromBreakdown(metrics);
  const opdShips = metrics.outputPerDollar.shippedSessionsPerDollar;
  // Output-per-$ "strong" = $5 or less per shipped session.
  const strongOpd =
    opdShips != null && opdShips > 0 && (1 / opdShips) <= STRONG_ROI_USD_PER_SHIP
      && shippedSessions >= 2 && metrics.totalCostUsd > 0;

  if (metrics.totalSessions === 0) {
    return t(locale, 'report.headline.quietWeek');
  }
  if (tagged === 0 && metrics.totalSessions > 0) {
    return t(locale, 'report.headline.untaggedMajority', {
      total: metrics.totalSessions,
    });
  }
  if (strongOpd) {
    return t(locale, 'report.headline.strongRoi', {
      usd: fmtUsd(metrics.totalCostUsd),
      shipped: shippedSessions,
    });
  }
  if (
    metrics.shipRate != null
    && metrics.shipRate >= SHIP_RATE_CLEAN_THRESHOLD
    && tagged >= MIN_TAGGED_FOR_HEADLINE
  ) {
    return t(locale, 'report.headline.cleanExecution', {
      shipped: shippedSessions,
      tagged,
    });
  }
  if (
    metrics.shipRate != null
    && metrics.shipRate <= SHIP_RATE_LOW_THRESHOLD
    && tagged >= MIN_TAGGED_FOR_HEADLINE
  ) {
    const others = tagged - shippedSessions;
    return t(locale, 'report.headline.lowShipRate', {
      total: metrics.totalSessions,
      shipped: shippedSessions,
      others,
    });
  }
  if (shippedSessions === 0 && metrics.totalSessions > 0) {
    return t(locale, 'report.headline.noShipped');
  }
  // Momentum-flavoured neutral fallback.
  if (metrics.momentum.label === 'accelerating') {
    return t(locale, 'report.headline.steadyAccelerating', {
      shipped: shippedSessions,
      total: metrics.totalSessions,
    });
  }
  if (metrics.momentum.label === 'cooling') {
    return t(locale, 'report.headline.steadyCooling', {
      shipped: shippedSessions,
      total: metrics.totalSessions,
    });
  }
  return t(locale, 'report.headline.steady', {
    shipped: shippedSessions,
    total: metrics.totalSessions,
  });
}

// ── Burn paragraph ─────────────────────────────────────────────────────────
// Talks $ + projects. Returns null when the week has no measured cost (signal
// would be misleading — better to skip the paragraph than to fabricate one).

export function burnParagraph(
  metrics: WeeklyReportMetrics,
  locale: Locale,
): string | null {
  if (metrics.totalCostUsd <= 0) return null;
  const top = metrics.topBurnProject;
  if (!top || top.costUsd <= 0) {
    // We have cost but no per-project rollup — fall back to a one-liner.
    return t(locale, 'report.burn.totalOnly', {
      usd: fmtUsd(metrics.totalCostUsd),
      projects: metrics.projectCount,
    });
  }
  const dominantShare = top.costUsd / metrics.totalCostUsd;
  if (
    dominantShare >= DOMINANT_PROJECT_SHARE
    || (metrics.totalCostUsd >= HIGH_BURN_USD && dominantShare >= 0.4)
  ) {
    return t(locale, 'report.burn.dominant', {
      usd: fmtUsd(metrics.totalCostUsd),
      projects: metrics.projectCount,
      topProject: top.cwd,
      topUsd: fmtUsd(top.costUsd),
      topSessions: top.sessions,
      topShipped: top.shippedSessions,
    });
  }
  return t(locale, 'report.burn.spread', {
    usd: fmtUsd(metrics.totalCostUsd),
    projects: metrics.projectCount,
    topProject: top.cwd,
    topUsd: fmtUsd(top.costUsd),
  });
}

// ── Focus paragraph ────────────────────────────────────────────────────────
// Focus score + zero-deploy callout. Returns null only when we have no focus
// signal AND no zero-deploy projects (otherwise we'd just be silent).

export function focusParagraph(
  metrics: WeeklyReportMetrics,
  locale: Locale,
): string | null {
  const focus = metrics.focus;
  const zeros = metrics.zeroDeployProjects;
  if (focus == null && zeros.length === 0) return null;

  const focusPart = focus != null
    ? focus >= 70
      ? t(locale, 'report.focus.focused', { score: focus })
      : focus >= 35
        ? t(locale, 'report.focus.balanced', { score: focus, projects: metrics.projectCount })
        : t(locale, 'report.focus.scattered', { score: focus, projects: metrics.projectCount })
    : null;

  if (zeros.length === 0) return focusPart;

  // Surface up to 2 zero-deploy projects so the line stays scannable. The
  // recommend() step still gets the full list to act on.
  const top = zeros.slice(0, 2);
  const zeroPart = top.length === 1
    ? t(locale, 'report.focus.zeroOne', {
      project: top[0].cwd,
      sessions: top[0].sessions,
    })
    : t(locale, 'report.focus.zeroMany', {
      project: top[0].cwd,
      sessions: top[0].sessions,
      other: top[1].cwd,
      count: zeros.length,
    });

  return focusPart ? `${focusPart} ${zeroPart}` : zeroPart;
}

// ── Momentum paragraph ────────────────────────────────────────────────────
// Week-over-week framing. Returns null when there's no prior baseline
// (computeMomentum returns label=null) — skipping is better than emitting
// "no momentum signal yet".

export function momentumParagraph(
  metrics: WeeklyReportMetrics,
  locale: Locale,
): string | null {
  if (metrics.momentum.label == null || metrics.momentum.ratio == null) return null;
  const ratio = Math.round(metrics.momentum.ratio);
  if (metrics.momentum.label === 'accelerating') {
    return t(locale, 'report.momentum.accelerating', {
      ratio,
      sessions: metrics.totalSessions,
    });
  }
  if (metrics.momentum.label === 'cooling') {
    return t(locale, 'report.momentum.cooling', {
      ratio,
      sessions: metrics.totalSessions,
    });
  }
  return t(locale, 'report.momentum.steady', {
    ratio,
    sessions: metrics.totalSessions,
  });
}

// ── Recommendations ───────────────────────────────────────────────────────
// 1-3 specific bullets. Order matters: cost-pause beats tag-untagged beats
// momentum-nudge. Empty array is fine — if nothing's worth saying, say nothing.

export function recommend(metrics: WeeklyReportMetrics, locale: Locale): string[] {
  const out: string[] = [];
  const tagged = totalTaggedFromBreakdown(metrics);
  const totalForUntagged = metrics.outcomeBreakdown.untagged + tagged;
  const untaggedShare = totalForUntagged > 0
    ? metrics.outcomeBreakdown.untagged / totalForUntagged
    : 0;

  // 1. Pause zero-deploy / dominant burn projects.
  for (const zero of metrics.zeroDeployProjects) {
    if (out.length >= 3) break;
    // Only flag when the project also burned meaningful $ — otherwise it might
    // just be an experimental side project the user doesn't intend to ship.
    if (zero.sessions < ZERO_DEPLOY_MIN_SESSIONS) continue;
    out.push(
      t(locale, 'report.rec.pauseZeroDeploy', {
        project: zero.cwd,
        sessions: zero.sessions,
      }),
    );
  }

  // 2. Tag-untagged nudge when the share is high enough that next week's
  //    report would actually get sharper from the user filling it in.
  if (
    out.length < 3
    && metrics.outcomeBreakdown.untagged >= 5
    && untaggedShare >= HIGH_UNTAGGED_SHARE
  ) {
    out.push(
      t(locale, 'report.rec.tagUntagged', {
        count: metrics.outcomeBreakdown.untagged,
      }),
    );
  }

  // 3. Best-ROI project shout-out — only when there *is* a best project and
  //    the data is meaningful (>= 2 shipped sessions). We use it to encourage
  //    leaning in, not to congratulate.
  if (
    out.length < 3
    && metrics.bestRoiProject
    && metrics.bestRoiProject.shippedSessions >= 2
    && metrics.bestRoiProject.commitsPerDollar != null
    && metrics.bestRoiProject.commitsPerDollar > 0
  ) {
    out.push(
      t(locale, 'report.rec.leanIntoBest', {
        project: metrics.bestRoiProject.cwd,
        shipped: metrics.bestRoiProject.shippedSessions,
      }),
    );
  }

  // 4. Momentum nudge — only if we still have room and the momentum signal
  //    is meaningful (label cooling/accelerating, not steady).
  if (
    out.length < 3
    && metrics.momentum.label === 'cooling'
    && metrics.momentum.ratio != null
    && metrics.momentum.ratio < MOMENTUM_THRESHOLD_COOLING
  ) {
    out.push(t(locale, 'report.rec.coolingNudge', {
      ratio: Math.round(metrics.momentum.ratio),
    }));
  } else if (
    out.length < 3
    && metrics.momentum.label === 'accelerating'
    && metrics.momentum.ratio != null
    && metrics.momentum.ratio >= MOMENTUM_THRESHOLD_ACCELERATING
  ) {
    out.push(t(locale, 'report.rec.acceleratingNudge', {
      ratio: Math.round(metrics.momentum.ratio),
    }));
  }

  return out.slice(0, 3);
}

// Phase 2 weekly report — assembles the metrics that the narrator templates
// over. We *reuse* the existing roi.ts + stats.ts + cost-attribution.ts plumbing
// rather than reinventing parallel SQL; the only new work here is rolling the
// per-project and zero-deploy lookups inside the ISO-week window.
//
// Privacy note: there's no LLM call anywhere in this pipeline. The headline
// pitch ("local-first, no telemetry") depends on the deterministic templater
// path — a future opt-in Pro narrator (Phase 5+) is the place for LLM polish.

import {
  outcomeBreakdown,
  projectSessionCountsForWindow,
  weeklySessionCounts,
  reworkRate,
  outcomeRowsForWindow,
  costByProject,
  type OutcomeBreakdown,
} from '../stats';
import {
  computeShipRate,
  computeMomentum,
  computeFocus,
  computeOutputPerDollar,
  type MomentumLabel,
} from '../roi';
import { getDb } from '../db';
import {
  burnParagraph,
  focusParagraph,
  headline,
  momentumParagraph,
  recommend,
  ZERO_DEPLOY_MIN_SESSIONS,
} from './narrator';
import {
  isoWeekFromDate,
  isoWeekWindow,
  resolveIsoWeek,
} from './iso-week';
import type { Locale } from '../i18n/types';

export interface WeeklyReportMetrics {
  windowStartMs: number;
  windowEndMs: number;
  /** e.g. "2026-W22". */
  weekIso: string;
  totalSessions: number;
  projectCount: number;
  /** Ship rate over *tagged* sessions in the window. `null` when no tags. */
  shipRate: number | null;
  /** Rework % (sessions restarted within 30min in same cwd). */
  reworkRate: number;
  focus: number | null;
  momentum: { ratio: number | null; label: MomentumLabel | null };
  outputPerDollar: {
    commitsPerDollar: number | null;
    shippedSessionsPerDollar: number | null;
  };
  totalCostUsd: number;
  topBurnProject: {
    cwd: string;
    costUsd: number;
    sessions: number;
    shippedSessions: number;
  } | null;
  bestRoiProject: {
    cwd: string;
    commitsPerDollar: number | null;
    shippedSessions: number;
  } | null;
  /** Projects with ≥ ZERO_DEPLOY_MIN_SESSIONS but no shipped sessions. */
  zeroDeployProjects: { cwd: string; sessions: number }[];
  outcomeBreakdown: OutcomeBreakdown;
}

export interface WeeklyReport {
  weekIso: string;
  metrics: WeeklyReportMetrics;
  /** One-line conclusion — FREE TIER. */
  headline: string;
  /** 3-5 short paragraphs — PRO ONLY. Null-skipping is done here. */
  paragraphs: string[];
  /** 1-3 specific action items — PRO ONLY. */
  recommendations: string[];
}

export interface BuildWeeklyReportOptions {
  /** Reference time. The ISO week containing it is the base; `weekOffset` shifts. */
  now: Date;
  /**
   * 0 = current week, negative = past weeks. Positive offsets are rejected
   * — we don't have data for the future, and a forward-looking report would
   * just be empty.
   */
  weekOffset: number;
  locale: Locale;
}

// ── Per-project rollup query ───────────────────────────────────────────────
// We need (cwd, sessions, shippedSessions) for the window so the narrator can
// pick the dominant burn project and the zero-deploy list. costByProject
// already returns spend per (basename) project; we join the two by basename
// here. The basename collision is real but rare — for the report's purposes,
// matching costByProject's view is the right tradeoff (it's the same view
// the user sees on the cost card).

interface ProjectRollupRow {
  cwd: string;
  basename: string;
  sessions: number;
  shippedSessions: number;
}

function projectRollup(startMs: number, endMs: number): ProjectRollupRow[] {
  const rows = getDb().prepare(`
    SELECT cwd,
           COUNT(*) AS sessions,
           SUM(CASE WHEN outcome IN ('shipped','bugfix') THEN 1 ELSE 0 END) AS shipped
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      AND cwd IS NOT NULL
    GROUP BY cwd
    ORDER BY sessions DESC
  `).all(startMs, endMs) as { cwd: string; sessions: number; shipped: number | null }[];

  return rows.map((r) => ({
    cwd: r.cwd,
    basename: r.cwd.split('/').filter(Boolean).pop() ?? r.cwd,
    sessions: r.sessions,
    shippedSessions: r.shipped ?? 0,
  }));
}

/**
 * Build the metrics + narrative for a single ISO week. Reuses stats.ts SQL
 * helpers + roi.ts pure math; no fresh divisions or thresholds invented here
 * (those live in `narrator.ts` constants so the cutoffs are testable).
 */
export function buildWeeklyReport(opts: BuildWeeklyReportOptions): WeeklyReport {
  if (opts.weekOffset > 0) {
    throw new Error('weekOffset must be 0 or negative');
  }
  const target = resolveIsoWeek(opts.now, opts.weekOffset);
  const window = isoWeekWindow(target.year, target.week);

  const metrics = computeWeeklyMetrics(window.startMs, window.endMs);
  const head = headline(metrics, opts.locale);
  const paragraphs = [
    burnParagraph(metrics, opts.locale),
    focusParagraph(metrics, opts.locale),
    momentumParagraph(metrics, opts.locale),
  ].filter((line): line is string => typeof line === 'string' && line.length > 0);
  const recommendations = recommend(metrics, opts.locale);

  return {
    weekIso: window.iso,
    metrics,
    headline: head,
    paragraphs,
    recommendations,
  };
}

/**
 * Aggregate all the per-window numbers the narrator needs. Exported so tests
 * can feed synthesized metrics into the narrator directly without standing up
 * a SQLite fixture.
 */
export function computeWeeklyMetrics(
  startMs: number,
  endMs: number,
): WeeklyReportMetrics {
  const breakdown = outcomeBreakdown(startMs, endMs);
  const outcomes = outcomeRowsForWindow(startMs, endMs);
  const shipRate = computeShipRate(outcomes);
  const distribution = projectSessionCountsForWindow(startMs, endMs);
  const totalSessions = [...distribution.values()].reduce((s, n) => s + n, 0);
  const focus = computeFocus([...distribution.values()]);

  // Momentum: weeklySessionCounts is rolling 7-day; for a *past* ISO week we
  // anchor it on the window's end so the 4-slot array maps to (w-3, w-2, w-1,
  // current=this ISO week). This matches the ROI card's behaviour exactly.
  const weekly = weeklySessionCounts(undefined, 3, endMs);
  const momentum = computeMomentum(weekly[3] ?? 0, [
    weekly[0] ?? 0,
    weekly[1] ?? 0,
    weekly[2] ?? 0,
  ]);

  const rework = reworkRate(startMs, endMs);
  const projects = projectRollup(startMs, endMs);
  const costRows = costByProject(startMs, endMs);
  const totalCostUsd = costRows.reduce((s, p) => s + p.totalUsd, 0);

  // Join basename → cost / sessions / shipped. We pick the project with the
  // highest USD as the "top burn"; ties broken by session count.
  const costByBasename = new Map(costRows.map((p) => [p.project, p]));

  let topBurnProject: WeeklyReportMetrics['topBurnProject'] = null;
  for (const p of projects) {
    const cost = costByBasename.get(p.basename);
    if (!cost) continue;
    if (!topBurnProject || cost.totalUsd > topBurnProject.costUsd) {
      topBurnProject = {
        cwd: p.basename,
        costUsd: cost.totalUsd,
        sessions: p.sessions,
        shippedSessions: p.shippedSessions,
      };
    }
  }

  // Best ROI = highest shipped-sessions-per-$ among projects with cost data.
  // We require >=2 shipped + cost >0 to filter noise.
  let bestRoiProject: WeeklyReportMetrics['bestRoiProject'] = null;
  let bestShipsPerUsd = 0;
  for (const p of projects) {
    if (p.shippedSessions < 2) continue;
    const cost = costByBasename.get(p.basename);
    if (!cost || cost.totalUsd <= 0) continue;
    const shipsPerUsd = p.shippedSessions / cost.totalUsd;
    if (shipsPerUsd > bestShipsPerUsd) {
      bestShipsPerUsd = shipsPerUsd;
      bestRoiProject = {
        cwd: p.basename,
        commitsPerDollar: null, // commits-per-$ requires per-project commits;
        // see comment in `computeOutputPerDollar` aggregate below.
        shippedSessions: p.shippedSessions,
      };
    }
  }
  // Backfill commits-per-$ for the best project. We do a single SQL count for
  // the chosen project rather than scanning everything up front — cheaper
  // than precomputing commits for every project.
  if (bestRoiProject) {
    const commits = commitsForProjectInWindow(startMs, endMs, bestRoiProject.cwd);
    const cost = costByBasename.get(bestRoiProject.cwd);
    if (cost && cost.totalUsd > 0) {
      bestRoiProject.commitsPerDollar = commits / cost.totalUsd;
    }
  }

  // Zero-deploy = enough activity that "we worked on it" is real, but the
  // outcome ledger has no shipped/bugfix for the project.
  const zeroDeployProjects = projects
    .filter((p) => p.sessions >= ZERO_DEPLOY_MIN_SESSIONS && p.shippedSessions === 0)
    .map((p) => ({ cwd: p.basename, sessions: p.sessions }))
    .slice(0, 5);

  // Output-per-dollar across the whole week (matches ProjectRoiCard math).
  const shippedSessionsTotal = breakdown.shipped + breakdown.bugfix;
  const totalCommitsInWindow = commitsForProjectInWindow(startMs, endMs);
  const outputPerDollar = computeOutputPerDollar({
    commits: totalCommitsInWindow,
    shippedSessions: shippedSessionsTotal,
    costUsd: totalCostUsd,
  });

  return {
    windowStartMs: startMs,
    windowEndMs: endMs,
    weekIso: isoWeekFromDate(new Date(startMs)).iso,
    totalSessions,
    projectCount: distribution.size,
    shipRate: shipRate.rate,
    reworkRate: rework.pct,
    focus,
    momentum,
    outputPerDollar,
    totalCostUsd,
    topBurnProject,
    bestRoiProject,
    zeroDeployProjects,
    outcomeBreakdown: breakdown,
  };
}

function commitsForProjectInWindow(startMs: number, endMs: number, cwdBasename?: string): number {
  const db = getDb();
  if (!cwdBasename) {
    return (db.prepare(`
      SELECT COUNT(*) AS n
      FROM session_commits
      WHERE committed_at >= ? AND committed_at < ?
    `).get(startMs, endMs) as { n: number }).n;
  }
  // basename match — we apply the same `... split('/').pop()` rule the rest
  // of the report uses so a project that lives in two cwds is counted once.
  // SQLite doesn't have a portable basename() so we do the trailing-segment
  // match in JS. The row count tends to be small (hundreds for a week) so
  // pulling the cwd column into memory is cheap.
  const rows = db.prepare(`
    SELECT s.cwd AS cwd
    FROM session_commits sc
    JOIN sessions s ON s.id = sc.session_id
    WHERE sc.committed_at >= ? AND sc.committed_at < ?
      AND s.cwd IS NOT NULL
  `).all(startMs, endMs) as { cwd: string }[];
  let n = 0;
  for (const r of rows) {
    const base = r.cwd.split('/').filter(Boolean).pop() ?? r.cwd;
    if (base === cwdBasename) n += 1;
  }
  return n;
}

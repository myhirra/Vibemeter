// Pure ROI math — no DB, no IO, no Date.now(). The SQL layer in stats.ts
// fetches rows and passes pre-aggregated numbers into these helpers so the
// tricky parts (entropy, divide-by-zero guards) are unit-testable in
// isolation under `node --test`.
//
// The five metrics:
//   • Ship Rate         — outcome-driven, untagged sessions excluded.
//   • Rework Rate       — heuristic for "didn't get it the first time"
//                          (sessions starting <30min after prior one in same cwd).
//                          Owned by stats.ts; this file does not duplicate it.
//   • Project Momentum  — this-week / prior-3wk-avg session count.
//   • Focus Drift       — normalized Shannon entropy over per-project counts,
//                          surfaced as a 0..100 "focus" score (higher = more focused).
//   • Output per Dollar — commits-per-$ and shipped-sessions-per-$ over the window.
//
// Pricing note (kept here so reviewers don't miss it): these numbers are NOT
// entitlement-gated. Hiding the metrics from free users would make the free
// dashboard feel broken; Phase 2 narrative + the history week-picker are what
// the Pro tier gates.

export type Outcome =
  | 'shipped'
  | 'bugfix'
  | 'failed'
  | 'discarded'
  | 'refactor'
  | 'explore';

/** Outcomes that count toward the Ship Rate numerator. Bugfix is "shipped" too —
 *  a fix that lands in main is still production output. */
export const SHIPPED_OUTCOMES: ReadonlySet<Outcome> = new Set<Outcome>(['shipped', 'bugfix']);

// ── Momentum thresholds ─────────────────────────────────────────────────────
// Exported so JSX can label cards without re-deriving the cutoffs. >=120 ratio
// reads as "accelerating" (20% more sessions than the 3-week baseline), <=70
// reads as "cooling" (30% fewer); in between is "steady". Tuned to match the
// noise floor of a typical solo-dev week; bump if the labels start firing too
// often on noise.
export const MOMENTUM_THRESHOLD_ACCELERATING = 120;
export const MOMENTUM_THRESHOLD_COOLING = 70;

export type MomentumLabel = 'accelerating' | 'steady' | 'cooling';

/**
 * Ship rate over a window, with **untagged sessions excluded** from both
 * numerator and denominator. The exclusion is load-bearing: a week dominated
 * by untagged sessions would otherwise crater the rate and trigger a false
 * "you're not shipping" signal. Returns `{ rate: null, denominator: 0 }` when
 * no session is tagged in the window (no signal).
 */
export function computeShipRate(rows: { outcome: Outcome | null }[]): {
  rate: number | null;
  denominator: number;
} {
  let denom = 0;
  let num = 0;
  for (const r of rows) {
    if (r.outcome == null) continue;
    denom += 1;
    if (SHIPPED_OUTCOMES.has(r.outcome)) num += 1;
  }
  if (denom === 0) return { rate: null, denominator: 0 };
  return { rate: num / denom, denominator: denom };
}

/**
 * Project momentum: how this week's session count compares to a 3-week
 * trailing average. `null` when the 3-week average is 0 — there's no baseline
 * to compare against, so a positive ratio would just amplify a single session
 * into "+∞%" of nothing. Caller must pass exactly 3 prior weeks; the typed
 * tuple makes that contract enforce-able at the type system.
 */
export function computeMomentum(
  currentWeekCount: number,
  prior3WeeksCounts: readonly [number, number, number],
): { ratio: number | null; label: MomentumLabel | null } {
  const avg = (prior3WeeksCounts[0] + prior3WeeksCounts[1] + prior3WeeksCounts[2]) / 3;
  if (avg === 0) return { ratio: null, label: null };
  const ratio = (currentWeekCount / avg) * 100;
  let label: MomentumLabel;
  if (ratio >= MOMENTUM_THRESHOLD_ACCELERATING) label = 'accelerating';
  else if (ratio <= MOMENTUM_THRESHOLD_COOLING) label = 'cooling';
  else label = 'steady';
  return { ratio, label };
}

/**
 * Focus score derived from normalized Shannon entropy over per-project
 * session counts in the window.
 *
 *   p_i    = sessions_in_project_i / total_sessions_in_window
 *   H      = -Σ p_i * log2(p_i)
 *   H_norm = H / log2(N_projects)
 *   Focus  = round((1 - H_norm) * 100)
 *
 * Higher Focus → fewer distinct projects taking the time. Edge cases:
 *  - `N_projects === 0` → `null` (no signal, no projects in the window).
 *  - `N_projects === 1` → `100` (perfectly focused; short-circuit avoids the
 *    `log2(1) = 0` divide-by-zero in the normalization).
 *  - All projects equal share → entropy is maximal → `Focus = 0`.
 *
 * Zero-count entries are filtered out before the entropy sum so the math
 * matches "distinct projects with ≥1 session", which is the same N used in
 * the denominator.
 */
export function computeFocus(projectSessionCounts: number[]): number | null {
  const counts = projectSessionCounts.filter((c) => c > 0);
  const n = counts.length;
  if (n === 0) return null;
  if (n === 1) return 100;
  const total = counts.reduce((sum, c) => sum + c, 0);
  if (total === 0) return null;
  let entropy = 0;
  for (const c of counts) {
    const p = c / total;
    entropy -= p * Math.log2(p);
  }
  const normalized = entropy / Math.log2(n);
  // Clamp to [0, 1] before flipping — floating-point noise on the all-equal
  // case can land slightly outside the interval.
  const clamped = Math.max(0, Math.min(1, normalized));
  return Math.round((1 - clamped) * 100);
}

/**
 * Output-per-dollar pair for the window. Both fields collapse to `null` when
 * the window's cost is non-positive — dividing by 0 (or worse, a negative
 * cost from a stale snapshot) yields a meaningless ratio that would just
 * confuse the card.
 */
export function computeOutputPerDollar(input: {
  commits: number;
  shippedSessions: number;
  costUsd: number;
}): { commitsPerDollar: number | null; shippedSessionsPerDollar: number | null } {
  if (input.costUsd <= 0) {
    return { commitsPerDollar: null, shippedSessionsPerDollar: null };
  }
  return {
    commitsPerDollar: input.commits / input.costUsd,
    shippedSessionsPerDollar: input.shippedSessions / input.costUsd,
  };
}

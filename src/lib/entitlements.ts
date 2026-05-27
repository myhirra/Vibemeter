/**
 * Central feature-gating module.
 *
 * Vibemeter is local-first and remains usable on the free tier; this module
 * exists so that Pro / Team-only UI can be hidden or shown via a single source
 * of truth. There is no remote license server wired in yet — the provider
 * defaults everyone to `free` and honors a dev-only env override so we can
 * preview gated UI during development.
 *
 * Anything new that's "Pro" should:
 *   1. Add a key to `Feature` below.
 *   2. Add the key to the appropriate plan(s) in `FEATURES`.
 *   3. Call `hasFeature(key, plan)` (server) or `useEntitlement(key)` (client).
 */
export type Plan = 'free' | 'pro' | 'team';

/**
 * Lifecycle of the license token on this machine. Most call sites should care
 * about the resolved `Plan` (computed from this status); the raw status is
 * useful for surfacing copy like "grace period: 5 days left" later.
 */
export type LicenseStatus =
  | 'none'      // no license file ever installed
  | 'active'    // valid + verified
  | 'grace'     // expired but inside the grace window (still functional)
  | 'expired'   // grace window over → fall back to free
  | 'disabled'  // explicit revocation
  | 'invalid'   // signature / payload mismatch
  | 'offline'   // can't reach the verifier but cached license still valid
  | 'dev';      // local override (NEXT_PUBLIC_VIBEMETER_DEV_PLAN)

/**
 * Stable feature keys. Add new ones as we ship gated UI; deleting one is a
 * breaking change because old license payloads may still mention it.
 */
export type Feature =
  // ── Floating bubble / popover ──────────────────────────────────────────
  | 'float.basic'              // collapsed bubble + popover (everyone)
  | 'float.contextWindow'      // live Claude Code context tracker
  | 'float.muteAlerts'         // Mute 30m button
  | 'float.deepLinkDashboard'  // popover → dashboard with current agent/project
  // ── Dashboard cards ────────────────────────────────────────────────────
  | 'dashboard.nowRunway'      // "Can I keep coding?" decision card
  | 'dashboard.cacheCard'      // cache hit rate breakdown
  | 'dashboard.apiEquivValue'  // API-equivalent value (renamed spending card)
  | 'dashboard.achievements'   // achievements grid
  | 'dashboard.heatmap'        // 84-day heatmap
  | 'dashboard.shareReport'    // share-report local export
  // ── Pro-tier additions (no UI yet, declared for forward-compat) ────────
  | 'dashboard.advancedExport' // CSV / JSON export with filters
  | 'dashboard.multiAccount'   // unified view across many Codex accounts
  | 'alerts.webhookPush'       // webhook push alerts (existing local feature kept free)
  | 'alerts.scheduledRules'    // multi-rule scheduling
  // ── Team-tier additions ────────────────────────────────────────────────
  | 'team.sharedDashboard'     // multi-seat shared aggregate
  | 'team.adminRoles';         // role-based access for shared dashboard

/**
 * Per-plan capability list. Pro inherits everything in free; team inherits pro.
 * We materialize the full set per plan (instead of doing union math at runtime)
 * so tests can pin behaviour and so a quick `Object.keys` gives the full UI
 * surface for that plan.
 */
const FREE: Feature[] = [
  'float.basic',
  'float.contextWindow',
  'float.muteAlerts',
  'float.deepLinkDashboard',
  'dashboard.nowRunway',
  'dashboard.cacheCard',
  'dashboard.apiEquivValue',
  'dashboard.achievements',
  'dashboard.heatmap',
  'dashboard.shareReport',
  'alerts.webhookPush',
];

const PRO: Feature[] = [
  ...FREE,
  'dashboard.advancedExport',
  'dashboard.multiAccount',
  'alerts.scheduledRules',
];

const TEAM: Feature[] = [
  ...PRO,
  'team.sharedDashboard',
  'team.adminRoles',
];

export const FEATURES: Record<Plan, readonly Feature[]> = {
  free: FREE,
  pro: PRO,
  team: TEAM,
};

/**
 * Pure predicate. Safe to call from server, client, or tests — no side effects.
 */
export function hasFeature(feature: Feature, plan: Plan): boolean {
  return FEATURES[plan]?.includes(feature) ?? false;
}

/**
 * Map a raw license lifecycle status to the effective plan a user gets.
 * Useful for the provider; kept exported so settings UI can show "you're on
 * Pro · grace" while still rendering Pro UI.
 */
export function planFromStatus(status: LicenseStatus, paidPlan: Plan): Plan {
  switch (status) {
    case 'active':
    case 'grace':
    case 'offline':
    case 'dev':
      return paidPlan;
    case 'none':
    case 'expired':
    case 'disabled':
    case 'invalid':
    default:
      return 'free';
  }
}

const VALID_PLANS = new Set<Plan>(['free', 'pro', 'team']);
export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && VALID_PLANS.has(value as Plan);
}

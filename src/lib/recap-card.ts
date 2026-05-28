import { getDb } from './db';
import { cacheStatsForRange, claudeApiEquivalentUsd, recapDailySeries } from './stats';
import { type RecapSettings, resolveRecapPlan } from './recap-settings';

export type RecapPeriod = 'today' | '7d' | 'month';
export type RecapVariant = 'landscape' | 'square';
export type RecapHeroKind = 'roi' | 'value' | 'cache' | 'sessions' | 'not_enough_data';
export type RecapStyle = 'hero' | 'grid';

export interface RecapPeriodInfo {
  kind: RecapPeriod;
  label: string;
  shortLabel: string;
  startMs: number;
  endMs: number;
  days: number;
  billingDenominatorDays: number;
}

export interface RecapProject {
  project: string;
  sessions: number;
  totalMs: number;
  tokens: number;
}

export interface RecapTokenTotals {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  codex: number;
  total: number;
}

export interface RecapMinimumData {
  ok: boolean;
  reason: 'ok' | 'no_sessions' | 'trivial_usage';
}

export interface RecapSeries {
  /** Per-day API-equivalent USD across the recap period (dense, in order). */
  value: number[];
  /** Per-day total tokens. */
  tokens: number[];
  /** Per-day session count. */
  sessions: number[];
  /** Per-day cache hit rate (0–100 integer). */
  cacheHit: number[];
}

export interface RecapCardData {
  generatedAt: number;
  period: RecapPeriodInfo;
  valueAtApiRatesUsd: number;
  valueCoverageLabel: string;
  subscriptionPlanLabel: string | null;
  subscriptionMonthlyUsd: number | null;
  subscriptionCostUsd: number | null;
  roiMultiplier: number | null;
  heroKind: RecapHeroKind;
  totalSessions: number;
  totalTokens: RecapTokenTotals;
  cacheHitRatePct: number;
  cacheSessionsAnalyzed: number;
  topProjects: RecapProject[];
  series: RecapSeries;
  minimumData: RecapMinimumData;
  watermark: string;
}

export interface RecapCardOptions {
  period?: RecapPeriod;
  now?: number;
  settings: RecapSettings;
}

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 365.2425 / 12;
export const RECAP_WATERMARK = 'made with Vibemeter · vibemeter.siney.top';

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function nextMonthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function recapPeriodInfo(period: RecapPeriod, now = Date.now()): RecapPeriodInfo {
  const endMs = now;
  if (period === 'today') {
    const nowDate = new Date(now);
    const dayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    const startMs = dayStart.getTime();
    return {
      kind: 'today',
      label: 'today',
      shortLabel: 'today',
      startMs,
      endMs,
      days: Math.max(0, (endMs - startMs) / DAY_MS),
      billingDenominatorDays: AVG_MONTH_DAYS,
    };
  }
  if (period === 'month') {
    const nowDate = new Date(now);
    const start = monthStart(nowDate);
    const next = nextMonthStart(nowDate);
    const startMs = start.getTime();
    const monthDays = (next.getTime() - startMs) / DAY_MS;
    return {
      kind: 'month',
      label: 'this month',
      shortLabel: 'month',
      startMs,
      endMs,
      days: Math.max(0, (endMs - startMs) / DAY_MS),
      billingDenominatorDays: monthDays,
    };
  }

  return {
    kind: '7d',
    label: 'last 7 days',
    shortLabel: 'week',
    startMs: endMs - 7 * DAY_MS,
    endMs,
    days: 7,
    billingDenominatorDays: AVG_MONTH_DAYS,
  };
}

export function proratedSubscriptionCost(monthlyUsd: number, period: RecapPeriodInfo): number {
  const denominator = period.billingDenominatorDays > 0 ? period.billingDenominatorDays : AVG_MONTH_DAYS;
  return Math.round((monthlyUsd * period.days / denominator) * 100) / 100;
}

function tokenTotals(startMs: number, endMs: number): { sessions: number; tokens: RecapTokenTotals } {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) AS sessions,
      COALESCE(SUM(COALESCE(input_tokens, 0)), 0) AS input,
      COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0) AS creation,
      COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0) AS read,
      COALESCE(SUM(COALESCE(output_tokens, 0)), 0) AS output,
      COALESCE(SUM(COALESCE(tokens_used, 0)), 0) AS codex
    FROM sessions
    WHERE started_at >= ?
      AND started_at < ?
  `).get(startMs, endMs) as {
    sessions: number;
    input: number;
    creation: number;
    read: number;
    output: number;
    codex: number;
  };
  const tokens = {
    input: row.input ?? 0,
    cacheCreation: row.creation ?? 0,
    cacheRead: row.read ?? 0,
    output: row.output ?? 0,
    codex: row.codex ?? 0,
    total: (row.input ?? 0) + (row.creation ?? 0) + (row.read ?? 0) + (row.output ?? 0) + (row.codex ?? 0),
  };
  return { sessions: row.sessions ?? 0, tokens };
}

function topProjects(startMs: number, endMs: number, limit = 3): RecapProject[] {
  const rows = getDb().prepare(`
    SELECT
      cwd,
      COUNT(*) AS sessions,
      SUM(COALESCE(ended_at, started_at) - started_at) AS total_ms,
      COALESCE(SUM(
        COALESCE(input_tokens, 0)
        + COALESCE(cache_creation_tokens, 0)
        + COALESCE(cache_read_tokens, 0)
        + COALESCE(output_tokens, 0)
        + COALESCE(tokens_used, 0)
      ), 0) AS tokens
    FROM sessions
    WHERE started_at >= ?
      AND started_at < ?
      AND cwd IS NOT NULL
    GROUP BY cwd
    ORDER BY total_ms DESC, tokens DESC
    LIMIT ?
  `).all(startMs, endMs, limit) as { cwd: string; sessions: number; total_ms: number | null; tokens: number }[];

  return rows.map((row) => ({
    project: row.cwd.split('/').filter(Boolean).pop() ?? 'unknown',
    sessions: row.sessions,
    totalMs: Math.max(0, row.total_ms ?? 0),
    tokens: row.tokens ?? 0,
  }));
}

function minimumData(totalSessions: number, totalTokens: number, valueUsd: number): RecapMinimumData {
  if (totalSessions <= 0) return { ok: false, reason: 'no_sessions' };
  if (totalTokens < 1_000 && valueUsd < 0.01) return { ok: false, reason: 'trivial_usage' };
  return { ok: true, reason: 'ok' };
}

export function buildRecapCard(options: RecapCardOptions): RecapCardData {
  const period = recapPeriodInfo(options.period ?? '7d', options.now);
  const plan = resolveRecapPlan(options.settings);
  const valueAtApiRatesUsd = claudeApiEquivalentUsd(period.startMs, period.endMs);
  const { sessions, tokens } = tokenTotals(period.startMs, period.endMs);
  const cache = cacheStatsForRange(period.startMs, period.endMs);
  const minimum = minimumData(sessions, tokens.total, valueAtApiRatesUsd);

  const subscriptionCostUsd = plan.kind === 'subscription' && plan.monthlyUsd != null
    ? proratedSubscriptionCost(plan.monthlyUsd, period)
    : null;
  const roiMultiplier = minimum.ok && subscriptionCostUsd != null && subscriptionCostUsd > 0
    ? Math.round((valueAtApiRatesUsd / subscriptionCostUsd) * 10) / 10
    : null;
  const heroKind = minimum.ok
    ? roiMultiplier != null ? 'roi' : 'value'
    : 'not_enough_data';

  const dailyPoints = recapDailySeries(period.startMs, period.endMs);
  const series: RecapSeries = {
    value: dailyPoints.map((p) => p.valueUsd),
    tokens: dailyPoints.map((p) => p.tokens),
    sessions: dailyPoints.map((p) => p.sessions),
    cacheHit: dailyPoints.map((p) => p.cacheHitPct),
  };

  return {
    generatedAt: options.now ?? Date.now(),
    period,
    valueAtApiRatesUsd,
    valueCoverageLabel: 'Claude API-equivalent',
    subscriptionPlanLabel: plan.kind === 'subscription' ? plan.label : null,
    subscriptionMonthlyUsd: plan.kind === 'subscription' ? plan.monthlyUsd : null,
    subscriptionCostUsd,
    roiMultiplier,
    heroKind,
    totalSessions: sessions,
    totalTokens: tokens,
    cacheHitRatePct: cache.hitRatePct,
    cacheSessionsAnalyzed: cache.sessionsAnalyzed,
    topProjects: topProjects(period.startMs, period.endMs, 3),
    series,
    minimumData: minimum,
    watermark: RECAP_WATERMARK,
  };
}

export function recapNudgeLine(card: RecapCardData): string | null {
  if (!card.minimumData.ok) return null;
  if (card.roiMultiplier != null) {
    return `${card.roiMultiplier}x return ${card.period.shortLabel} - run \`vibemeter card\` to make a shareable recap`;
  }
  if (card.valueAtApiRatesUsd > 0) {
    return `$${card.valueAtApiRatesUsd.toFixed(2)} API-equivalent value ${card.period.shortLabel} - run \`vibemeter card\` to make a shareable recap`;
  }
  return null;
}

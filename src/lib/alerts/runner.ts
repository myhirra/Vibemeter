// Periodic alert evaluator. Reads current quotas + rule state, decides which
// rules should fire, dispatches messages, and persists updated state.
//
// Hysteresis: a threshold rule fires once when value crosses below `below`
// and is rearmed only once it climbs back above `below + HYSTERESIS_PCT`,
// preventing flapping on a value oscillating around the boundary.

import { getFloatStats, type FloatQuota, type FloatStats } from '@/lib/float-stats';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { getDb } from '@/lib/db';
import { getRecentUsageSnapshots, type UsageSnapshotRecord, type UsageSource } from '@/lib/usage-snapshots';
import { dispatch } from './dispatch';
import { formatBudgetAlert, formatDailySummary, formatResetReminder, formatThresholdAlert, formatVendorEvent } from './format';
import { readAlertConfig, readAlertState, writeAlertState } from './storage';
import { evaluateRecapNudge } from '@/lib/recap-nudge';
import type {
  AlertChannel,
  AlertConfig,
  AlertMetric,
  AlertRule,
  AlertState,
  PushLocale,
  ResetMetric,
  RuleState,
} from './types';

const HYSTERESIS_PCT = 5;

function quotaFor(stats: FloatStats, agent: 'claude-code' | 'codex'): FloatQuota | null {
  return stats.quotas.find((q) => q.agent === agent) ?? null;
}

function metricValue(stats: FloatStats, metric: AlertMetric): number | null {
  const [agentToken, window] = (() => {
    if (metric.startsWith('claude_')) return ['claude-code' as const, metric.slice('claude_'.length)];
    return ['codex' as const, metric.slice('codex_'.length)];
  })();
  const q = quotaFor(stats, agentToken);
  if (!q) return null;
  if (window === '5h_remaining_pct') return q.remaining5h;
  if (window === 'weekly_remaining_pct') return q.remainingWeekly;
  return null;
}

function resetQuota(stats: FloatStats, metric: ResetMetric): FloatQuota | null {
  const agent = metric.startsWith('claude_') ? 'claude-code' : 'codex';
  return quotaFor(stats, agent);
}

function resetWindowFields(quota: FloatQuota, metric: ResetMetric): { remaining: number | null; resetAt: number | null } {
  if (metric.endsWith('_weekly')) return { remaining: quota.remainingWeekly, resetAt: quota.resetAtWeekly };
  return { remaining: quota.remaining5h, resetAt: quota.resetAt5h };
}

function todayKey(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function channelsByIds(config: AlertConfig, ids: string[]): AlertChannel[] {
  return ids.map((id) => config.channels.find((c) => c.id === id)).filter((c): c is AlertChannel => !!c);
}

interface PendingFire {
  rule: AlertRule;
  channels: AlertChannel[];
  title: string;
  body: string;
  nextState: RuleState;
}

function evaluateThreshold(
  rule: Extract<AlertRule, { kind: 'threshold' }>,
  prev: RuleState | undefined,
  stats: FloatStats,
  locale: PushLocale,
): PendingFire | RuleState | null {
  const value = metricValue(stats, rule.metric);
  if (value == null) return null;
  const prevArmed = prev?.kind === 'threshold' ? prev.armed : true;
  const prevLastFiredAt = prev?.kind === 'threshold' ? prev.lastFiredAt : null;

  // Rearm when comfortably above threshold.
  if (value >= rule.below + HYSTERESIS_PCT) {
    if (!prevArmed) return { kind: 'threshold', armed: true, lastFiredAt: prevLastFiredAt };
    return null;
  }
  // Fire when below threshold and still armed.
  if (value < rule.below && prevArmed) {
    const { title, body } = formatThresholdAlert(rule, value, stats, locale);
    return {
      rule,
      channels: [], // filled in by caller
      title,
      body,
      nextState: { kind: 'threshold', armed: false, lastFiredAt: Date.now() },
    };
  }
  return null;
}

function evaluateDaily(
  rule: Extract<AlertRule, { kind: 'daily' }>,
  prev: RuleState | undefined,
  stats: FloatStats,
  locale: PushLocale,
  now: Date,
): PendingFire | null {
  const day = todayKey(now);
  const prevDay = prev?.kind === 'daily' ? prev.lastFiredDay : null;
  if (prevDay === day) return null;
  if (now.getHours() < rule.hour) return null;
  if (now.getHours() === rule.hour && now.getMinutes() < rule.minute) return null;

  const { title, body } = formatDailySummary(stats, locale);
  return {
    rule,
    channels: [],
    title,
    body,
    nextState: { kind: 'daily', lastFiredDay: day },
  };
}

// ISO-8601 week key (YYYY-Www) so a `7d` budget fires at most once per week.
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function budgetBucketKey(period: 'today' | '7d' | 'month', now: Date): string {
  if (period === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (period === '7d') return isoWeekKey(now);
  return todayKey(now);
}

function windowSpendUsd(stats: FloatStats, period: 'today' | '7d' | 'month'): number | null {
  const row = stats.periodMetrics.find((m) => m.period === period && m.tool === 'all');
  return row ? row.valueUsd : null;
}

export function evaluateBudget(
  rule: Extract<AlertRule, { kind: 'budget' }>,
  prev: RuleState | undefined,
  stats: FloatStats,
  locale: PushLocale,
  now: Date,
): PendingFire | null {
  const bucket = budgetBucketKey(rule.period, now);
  // One alert per natural period — don't re-nudge until the bucket rolls over.
  if (prev?.kind === 'budget' && prev.lastFiredForBucket === bucket) return null;
  const spend = windowSpendUsd(stats, rule.period);
  if (spend == null || spend < rule.amountUsd) return null;
  const { title, body } = formatBudgetAlert(rule, spend, locale);
  return { rule, channels: [], title, body, nextState: { kind: 'budget', lastFiredForBucket: bucket } };
}

function snapshotResetAt(record: UsageSnapshotRecord, metric: ResetMetric): number | null {
  return metric.endsWith('_weekly') ? record.reset_at_weekly : record.reset_at_5h;
}

function snapshotUsedPct(record: UsageSnapshotRecord, metric: ResetMetric): number | null {
  return metric.endsWith('_weekly') ? record.window_weekly_used_pct : record.window_5h_used_pct;
}

export interface VendorEventDeps {
  db: ReturnType<typeof getDb>;
  codexAccountId: string | null;
}

// Exported for direct unit testing (see tests/vendor-event.test.ts).
export function evaluateVendorEvent(
  rule: Extract<AlertRule, { kind: 'vendor_event' }>,
  prev: RuleState | undefined,
  deps: VendorEventDeps,
  locale: PushLocale,
): PendingFire | null {
  const isCodex = rule.metric.startsWith('codex_');
  const source: UsageSource = isCodex ? 'codex' : 'statusline';
  const accountId = isCodex ? deps.codexAccountId : null;

  const recent = getRecentUsageSnapshots(deps.db, source, accountId, 5);
  if (recent.length < 2) return null;

  const newest = recent.find((r) => snapshotUsedPct(r, rule.metric) != null && snapshotResetAt(r, rule.metric) != null);
  if (!newest) return null;

  const older = recent.find((r) =>
    r.id !== newest.id
    && r.captured_at < newest.captured_at
    && snapshotUsedPct(r, rule.metric) != null
    && snapshotResetAt(r, rule.metric) != null,
  );
  if (!older) return null;

  const newPct = snapshotUsedPct(newest, rule.metric) as number;
  const oldPct = snapshotUsedPct(older, rule.metric) as number;
  const newReset = snapshotResetAt(newest, rule.metric) as number;
  const oldReset = snapshotResetAt(older, rule.metric) as number;

  if (oldPct < rule.minUsedPctBefore) return null;
  if (newPct > rule.maxUsedPctAfter) return null;
  if (newReset <= oldReset) return null;
  // KEY: the new observation happened BEFORE the previously scheduled reset.
  // Otherwise the rollover is the natural window expiring, not a vendor push.
  if (newest.captured_at >= oldReset) return null;

  const prevReset = prev?.kind === 'vendor_event' ? prev.lastFiredForResetAt : null;
  if (prevReset === newReset) return null;

  const { title, body } = formatVendorEvent(rule, oldPct, newReset, locale);
  return {
    rule,
    channels: [],
    title,
    body,
    nextState: { kind: 'vendor_event', lastFiredForResetAt: newReset },
  };
}

function evaluateResetReminder(
  rule: Extract<AlertRule, { kind: 'reset_reminder' }>,
  prev: RuleState | undefined,
  stats: FloatStats,
  locale: PushLocale,
  nowMs: number,
): PendingFire | null {
  const q = resetQuota(stats, rule.metric);
  if (!q) return null;
  const { remaining, resetAt } = resetWindowFields(q, rule.metric);
  if (resetAt == null) return null;
  const minutesAway = (resetAt - nowMs) / 60_000;
  if (minutesAway <= 0 || minutesAway > rule.minutesBefore) return null;
  // "Use it or lose it" — only nudge while there's still meaningful unused quota.
  if (remaining == null || remaining < rule.remainingPctAbove) return null;
  const prevReset = prev?.kind === 'reset_reminder' ? prev.lastFiredForResetAt : null;
  if (prevReset === resetAt) return null;

  const { title, body } = formatResetReminder(rule, q, remaining, resetAt, locale);
  return {
    rule,
    channels: [],
    title,
    body,
    nextState: { kind: 'reset_reminder', lastFiredForResetAt: resetAt },
  };
}

export interface RunReport {
  fired: Array<{ ruleId: string; channelId: string; success: boolean; message: string }>;
  evaluated: number;
}

export async function runAlertsOnce(now: Date = new Date()): Promise<RunReport> {
  const config = readAlertConfig();
  importUsageSnapshots();

  const state = readAlertState();
  const stats = await getFloatStats();
  evaluateRecapNudge(stats, { notify: true, now: now.getTime() });
  if (!config.rules.length) return { fired: [], evaluated: 0 };

  const pushLocale: PushLocale = config.pushLocale === 'en' ? 'en' : 'zh';
  const vendorDeps: VendorEventDeps = {
    db: getDb(),
    codexAccountId: stats.codexAccounts.find((a) => a.isCurrent)?.accountId ?? null,
  };

  const pending: PendingFire[] = [];
  const stateUpdates: Record<string, RuleState> = {};

  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    const prev = state.rules[rule.id];
    if (rule.kind === 'threshold') {
      const r = evaluateThreshold(rule, prev, stats, pushLocale);
      if (!r) continue;
      // Threshold evaluator can return a rearm-only RuleState (no fire).
      if ('rule' in r) {
        const channels = channelsByIds(config, rule.channelIds);
        if (channels.length) pending.push({ ...r, channels });
        stateUpdates[rule.id] = r.nextState;
      } else {
        stateUpdates[rule.id] = r;
      }
    } else if (rule.kind === 'daily') {
      const r = evaluateDaily(rule, prev, stats, pushLocale, now);
      if (!r) continue;
      const channels = channelsByIds(config, rule.channelIds);
      if (!channels.length) continue;
      pending.push({ ...r, channels });
      stateUpdates[rule.id] = r.nextState;
    } else if (rule.kind === 'reset_reminder') {
      const r = evaluateResetReminder(rule, prev, stats, pushLocale, now.getTime());
      if (!r) continue;
      const channels = channelsByIds(config, rule.channelIds);
      if (!channels.length) continue;
      pending.push({ ...r, channels });
      stateUpdates[rule.id] = r.nextState;
    } else if (rule.kind === 'vendor_event') {
      const r = evaluateVendorEvent(rule, prev, vendorDeps, pushLocale);
      if (!r) continue;
      const channels = channelsByIds(config, rule.channelIds);
      if (!channels.length) continue;
      pending.push({ ...r, channels });
      stateUpdates[rule.id] = r.nextState;
    } else if (rule.kind === 'budget') {
      const r = evaluateBudget(rule, prev, stats, pushLocale, now);
      if (!r) continue;
      const channels = channelsByIds(config, rule.channelIds);
      if (!channels.length) continue;
      pending.push({ ...r, channels });
      stateUpdates[rule.id] = r.nextState;
    }
  }

  const fired: RunReport['fired'] = [];
  for (const p of pending) {
    for (const ch of p.channels) {
      const res = await dispatch(ch, p.title, p.body);
      fired.push({ ruleId: p.rule.id, channelId: ch.id, success: res.success, message: res.message });
    }
  }

  if (Object.keys(stateUpdates).length) {
    const merged: AlertState = { rules: { ...state.rules, ...stateUpdates } };
    writeAlertState(merged);
  }

  return { fired, evaluated: config.rules.filter((r) => r.enabled).length };
}

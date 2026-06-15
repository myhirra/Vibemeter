import { getDb } from './db';
import { cacheStatsForRange, claudeApiEquivalentUsd, codexApiEquivalentUsd, recapDailySeries } from './stats';
import { type RecapSettings, resolveRecapPlan } from './recap-settings';

export type RecapPeriod = 'today' | '7d' | '30d' | 'month' | 'all';
export type RecapDateFilter = 'today' | '7d' | '30d' | 'all';
export type RecapToolFilter = 'all' | 'claude-code' | 'codex' | 'cursor';
export type RecapVariant = 'landscape' | 'square';
export type RecapHeroKind = 'roi' | 'value' | 'tokens' | 'cache' | 'sessions' | 'not_enough_data';
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
  /** Per-day observed user prompt count. */
  prompts: number[];
  /** Per-day cache hit rate (0–100 integer). */
  cacheHit: number[];
}

export interface RecapCacheSummary {
  totalInput: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalOutput: number;
  inputTokensSaved: number;
  topProjects: Array<{
    project: string;
    sessions: number;
    hitRatePct: number;
  }>;
}

export interface RecapCardData {
  generatedAt: number;
  period: RecapPeriodInfo;
  tool: RecapToolFilter;
  valueAtApiRatesUsd: number;
  /** Claude portion of valueAtApiRatesUsd — measured from real per-session $. */
  claudeValueUsd: number;
  /** Codex portion — blended estimate (see CODEX_BLENDED_USD_PER_MILLION). */
  codexValueUsd: number;
  valueCoverageLabel: string;
  subscriptionPlanLabel: string | null;
  subscriptionMonthlyUsd: number | null;
  subscriptionCostUsd: number | null;
  roiMultiplier: number | null;
  heroKind: RecapHeroKind;
  totalSessions: number;
  /** Count of user prompts/turns observed in local tool logs. Prompt text is never stored here. */
  promptCount: number;
  totalTokens: RecapTokenTotals;
  cacheHitRatePct: number;
  cacheSessionsAnalyzed: number;
  cacheSummary: RecapCacheSummary;
  topProjects: RecapProject[];
  series: RecapSeries;
  minimumData: RecapMinimumData;
  watermark: string;
}

export type RecapCardsByScope = Record<RecapToolFilter, Record<RecapDateFilter, RecapCardData>>;

export interface RecapCardOptions {
  period?: RecapPeriod;
  tool?: RecapToolFilter;
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
  if (period === '30d') {
    return {
      kind: '30d',
      label: 'last 30 days',
      shortLabel: '30d',
      startMs: endMs - 30 * DAY_MS,
      endMs,
      days: 30,
      billingDenominatorDays: AVG_MONTH_DAYS,
    };
  }
  if (period === 'all') {
    return {
      kind: 'all',
      label: 'all time',
      shortLabel: 'all',
      startMs: 0,
      endMs,
      days: 0,
      billingDenominatorDays: AVG_MONTH_DAYS,
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

function toolWhere(tool: RecapToolFilter, alias = ''): { sql: string; params: RecapToolFilter[] } {
  if (tool === 'all') return { sql: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  return { sql: ` AND ${prefix}tool = ?`, params: [tool] };
}

function allTimeStartMs(tool: RecapToolFilter, fallback: number): number {
  const filter = toolWhere(tool);
  const row = getDb().prepare(`
    SELECT MIN(started_at) AS start_ms
    FROM sessions
    WHERE 1 = 1
      ${filter.sql}
  `).get(...filter.params) as { start_ms: number | null };
  return row.start_ms ?? fallback;
}

function resolvePeriod(period: RecapPeriod, tool: RecapToolFilter, now = Date.now()): RecapPeriodInfo {
  const info = recapPeriodInfo(period, now);
  if (info.kind !== 'all') return info;
  const startMs = allTimeStartMs(tool, now);
  return {
    ...info,
    startMs,
    days: Math.max(0, (info.endMs - startMs) / DAY_MS),
  };
}

export function proratedSubscriptionCost(monthlyUsd: number, period: RecapPeriodInfo): number {
  const denominator = period.billingDenominatorDays > 0 ? period.billingDenominatorDays : AVG_MONTH_DAYS;
  return Math.round((monthlyUsd * period.days / denominator) * 100) / 100;
}

/** 本地该天 0 点 unix ms — 把滚动窗口的起点对齐到自然日，匹配 session_daily.day_ms。 */
function floorLocalDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Claude 的 token/prompt 按「消息实际发生日」(session_daily) 归集，解决跨天长会话把全部
// 用量算到 started_at 那天、导致"今天 token=0"的问题。codex/cursor/gemini 仍按 sessions
// 的 started_at（它们会话短、基本不跨天，影响可忽略）。
function tokenTotals(startMs: number, endMs: number, tool: RecapToolFilter): { sessions: number; tokens: RecapTokenTotals } {
  const db = getDb();
  const wantClaude = tool === 'all' || tool === 'claude-code';
  const wantCodex = tool === 'all' || tool === 'codex';
  const wantOther = tool === 'all'; // cursor/gemini/opencode/qoder 仅 all 计入（保持原 tool!=codex 行为）

  let input = 0, creation = 0, read = 0, output = 0, codex = 0;
  const sessionIds = new Set<string>();

  if (wantClaude) {
    const dayStart = floorLocalDayMs(startMs);
    const rows = db.prepare(`
      SELECT session_id, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens
      FROM session_daily WHERE day_ms >= ? AND day_ms < ?
    `).all(dayStart, endMs) as { session_id: string; input_tokens: number; cache_creation_tokens: number; cache_read_tokens: number; output_tokens: number }[];
    for (const r of rows) {
      input += r.input_tokens; creation += r.cache_creation_tokens;
      read += r.cache_read_tokens; output += r.output_tokens;
      sessionIds.add(r.session_id);
    }
  }

  const otherTools: string[] = [];
  if (wantCodex) otherTools.push('codex');
  if (wantOther) otherTools.push('cursor', 'gemini', 'opencode', 'qoder');
  if (otherTools.length > 0) {
    const placeholders = otherTools.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, tool,
        COALESCE(input_tokens, 0) AS inp, COALESCE(cache_creation_tokens, 0) AS cc,
        COALESCE(cache_read_tokens, 0) AS cr, COALESCE(output_tokens, 0) AS outp,
        COALESCE(tokens_used, 0) AS tu
      FROM sessions
      WHERE started_at >= ? AND started_at < ? AND tool IN (${placeholders})
    `).all(startMs, endMs, ...otherTools) as { id: string; tool: string; inp: number; cc: number; cr: number; outp: number; tu: number }[];
    for (const r of rows) {
      if (r.tool === 'codex') {
        codex += r.tu || (r.inp + r.cc + r.cr + r.outp);
      } else {
        input += r.inp; creation += r.cc; read += r.cr; output += r.outp;
      }
      sessionIds.add(r.id);
    }
  }

  const tokens = {
    input, cacheCreation: creation, cacheRead: read, output, codex,
    total: input + creation + read + output + codex,
  };
  return { sessions: sessionIds.size, tokens };
}

function promptCount(startMs: number, endMs: number, tool: RecapToolFilter): number {
  const db = getDb();
  const wantClaude = tool === 'all' || tool === 'claude-code';
  const wantCodex = tool === 'all' || tool === 'codex';
  const wantOther = tool === 'all';
  let prompts = 0;

  if (wantClaude) {
    const dayStart = floorLocalDayMs(startMs);
    const r = db.prepare(`
      SELECT COALESCE(SUM(prompt_count), 0) AS prompts
      FROM session_daily WHERE day_ms >= ? AND day_ms < ?
    `).get(dayStart, endMs) as { prompts: number };
    prompts += r.prompts ?? 0;
  }

  const otherTools: string[] = [];
  if (wantCodex) otherTools.push('codex');
  if (wantOther) otherTools.push('cursor', 'gemini', 'opencode', 'qoder');
  if (otherTools.length > 0) {
    const placeholders = otherTools.map(() => '?').join(',');
    const r = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(prompt_count, 0)), 0) AS prompts
      FROM sessions WHERE started_at >= ? AND started_at < ? AND tool IN (${placeholders})
    `).get(startMs, endMs, ...otherTools) as { prompts: number };
    prompts += r.prompts ?? 0;
  }

  return prompts;
}

function topProjects(startMs: number, endMs: number, tool: RecapToolFilter, limit = 3): RecapProject[] {
  const filter = toolWhere(tool);
  const rows = getDb().prepare(`
    SELECT
      cwd,
      COUNT(*) AS sessions,
      SUM(COALESCE(ended_at, started_at) - started_at) AS total_ms,
      COALESCE(SUM(
        CASE
          WHEN tool = 'codex' THEN
            COALESCE(
              tokens_used,
              COALESCE(input_tokens, 0)
              + COALESCE(cache_creation_tokens, 0)
              + COALESCE(cache_read_tokens, 0)
              + COALESCE(output_tokens, 0)
            )
          ELSE
            COALESCE(input_tokens, 0)
            + COALESCE(cache_creation_tokens, 0)
            + COALESCE(cache_read_tokens, 0)
            + COALESCE(output_tokens, 0)
        END
      ), 0) AS tokens
    FROM sessions
    WHERE started_at >= ?
      AND started_at < ?
      ${filter.sql}
      AND cwd IS NOT NULL
    GROUP BY cwd
    ORDER BY total_ms DESC, tokens DESC
    LIMIT ?
  `).all(startMs, endMs, ...filter.params, limit) as { cwd: string; sessions: number; total_ms: number | null; tokens: number }[];

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
  const tool = options.tool ?? 'all';
  const period = resolvePeriod(options.period ?? '7d', tool, options.now);
  const plan = resolveRecapPlan(options.settings);
  // Value now sums Claude + Codex API-equivalent. Cursor has no rate we trust,
  // so it stays at 0. Per-tool filter drops the irrelevant side.
  const claudeValue = tool === 'codex' || tool === 'cursor'
    ? 0
    : claudeApiEquivalentUsd(period.startMs, period.endMs);
  const codexValue = tool === 'claude-code' || tool === 'cursor'
    ? 0
    : codexApiEquivalentUsd(period.startMs, period.endMs);
  const valueAtApiRatesUsd = claudeValue + codexValue;
  const { sessions, tokens } = tokenTotals(period.startMs, period.endMs, tool);
  const prompts = promptCount(period.startMs, period.endMs, tool);
  const cache = cacheStatsForRange(period.startMs, period.endMs, tool);
  const minimum = minimumData(sessions, tokens.total, valueAtApiRatesUsd);

  const subscriptionCostUsd = period.kind !== 'all' && plan.kind === 'subscription' && plan.monthlyUsd != null
    ? proratedSubscriptionCost(plan.monthlyUsd, period)
    : null;
  // ROI compares Claude-only value against the Claude subscription cost — the
  // user paid Anthropic, not OpenAI, so Codex spend on API rates would inflate
  // the ratio with a number that has nothing to do with that subscription.
  const roiMultiplier = minimum.ok && subscriptionCostUsd != null && subscriptionCostUsd > 0
    ? Math.round((claudeValue / subscriptionCostUsd) * 10) / 10
    : null;
  let heroKind: RecapHeroKind = 'not_enough_data';
  if (minimum.ok) {
    if (roiMultiplier != null) heroKind = 'roi';
    else if (tool === 'codex' && tokens.total > 0) heroKind = 'tokens';
    else if (valueAtApiRatesUsd > 0) heroKind = 'value';
    else if (tokens.total > 0) heroKind = 'tokens';
    else if (cache.sessionsAnalyzed > 0) heroKind = 'cache';
    else heroKind = 'sessions';
  }

  const dailyPoints = recapDailySeries(period.startMs, period.endMs, tool);
  const series: RecapSeries = {
    value: dailyPoints.map((p) => p.valueUsd),
    tokens: dailyPoints.map((p) => p.tokens),
    sessions: dailyPoints.map((p) => p.sessions),
    prompts: dailyPoints.map((p) => p.prompts),
    cacheHit: dailyPoints.map((p) => p.cacheHitPct),
  };

  return {
    generatedAt: options.now ?? Date.now(),
    period,
    tool,
    valueAtApiRatesUsd,
    claudeValueUsd: claudeValue,
    codexValueUsd: codexValue,
    valueCoverageLabel: tool === 'codex'
      ? 'Codex API-equivalent'
      : tool === 'claude-code'
        ? 'Claude API-equivalent'
        : 'Claude + Codex API-equivalent',
    subscriptionPlanLabel: plan.kind === 'subscription' ? plan.label : null,
    subscriptionMonthlyUsd: plan.kind === 'subscription' ? plan.monthlyUsd : null,
    subscriptionCostUsd,
    roiMultiplier,
    heroKind,
    totalSessions: sessions,
    promptCount: prompts,
    totalTokens: tokens,
    cacheHitRatePct: cache.hitRatePct,
    cacheSessionsAnalyzed: cache.sessionsAnalyzed,
    cacheSummary: {
      totalInput: cache.totalInput,
      totalCacheCreation: cache.totalCacheCreation,
      totalCacheRead: cache.totalCacheRead,
      totalOutput: cache.totalOutput,
      inputTokensSaved: cache.inputTokensSaved,
      topProjects: cache.topProjects.map((project) => ({
        project: project.project,
        sessions: project.sessions,
        hitRatePct: project.hitRatePct,
      })),
    },
    topProjects: topProjects(period.startMs, period.endMs, tool, 3),
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

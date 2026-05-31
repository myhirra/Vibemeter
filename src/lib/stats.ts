import { getDb } from './db';
import { groupCostByProject, type ProjectCost, type ProjectCostContribution } from './cost-attribution';
import type { RecapToolFilter } from './recap-card';
import {
  computeShipRate,
  computeMomentum,
  computeFocus,
  computeOutputPerDollar,
} from './roi';
import type { Outcome, MomentumLabel } from './roi';

export {
  MOMENTUM_THRESHOLD_ACCELERATING,
  MOMENTUM_THRESHOLD_COOLING,
} from './roi';
export type { Outcome, MomentumLabel } from './roi';

export interface ToolSplit {
  tool: string;
  sessions: number;
  totalMs: number;
  pct: number;
}

export function toolSplit(): ToolSplit[] {
  const rows = getDb().prepare(`
    SELECT tool,
           COUNT(*) AS sessions,
           SUM(COALESCE(ended_at, started_at) - started_at) AS total_ms
    FROM sessions
    GROUP BY tool
    ORDER BY total_ms DESC
  `).all() as { tool: string; sessions: number; total_ms: number }[];

  const grand = rows.reduce((s, r) => s + (r.total_ms ?? 0), 0) || 1;
  return rows.map((r) => ({
    tool: r.tool,
    sessions: r.sessions,
    totalMs: r.total_ms ?? 0,
    pct: Math.round(((r.total_ms ?? 0) / grand) * 100),
  }));
}

export interface StreakInfo {
  current: number;   // consecutive days up to today
  longest: number;
  totalDays: number;
  heatmap: { date: string; count: number }[]; // last 84 days (12 weeks)
}

export function activityStreak(): StreakInfo {
  const rows = getDb().prepare(`
    SELECT DATE(started_at / 1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS n
    FROM sessions
    GROUP BY day
    ORDER BY day ASC
  `).all() as { day: string; n: number }[];

  const byDay = new Map(rows.map((r) => [r.day, r.n]));

  // Build last 84 days heatmap
  const heatmap: { date: string; count: number }[] = [];
  const now = new Date();
  for (let i = 83; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    heatmap.push({ date: key, count: byDay.get(key) ?? 0 });
  }

  // Current streak (backwards from today)
  let current = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (byDay.has(key)) { current++; } else { break; }
  }

  // Longest streak
  let longest = 0, run = 0;
  const allDays = rows.map((r) => r.day).sort();
  for (let i = 0; i < allDays.length; i++) {
    if (i === 0) { run = 1; continue; }
    const prev = new Date(allDays[i - 1]);
    const cur = new Date(allDays[i]);
    const diff = (cur.getTime() - prev.getTime()) / 86400000;
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  if (current > longest) longest = current;

  return { current, longest, totalDays: byDay.size, heatmap };
}

export interface BurndownPoint {
  ts: number;
  pct5h: number | null;
  pctWeekly: number | null;
}

export function burndownPoints(limitHours = 168, source?: string, accountId?: string | null): BurndownPoint[] {
  const since = Date.now() - limitHours * 3_600_000;
  const q = source && accountId != null
    ? `SELECT captured_at AS ts, window_5h_used_pct AS pct5h, window_weekly_used_pct AS pctWeekly
       FROM usage_snapshots WHERE captured_at > ? AND source = ? AND account_id = ? ORDER BY captured_at ASC`
    : source
    ? `SELECT captured_at AS ts, window_5h_used_pct AS pct5h, window_weekly_used_pct AS pctWeekly
       FROM usage_snapshots WHERE captured_at > ? AND source = ? ORDER BY captured_at ASC`
    : `SELECT captured_at AS ts, window_5h_used_pct AS pct5h, window_weekly_used_pct AS pctWeekly
       FROM usage_snapshots WHERE captured_at > ? ORDER BY captured_at ASC`;
  const args = source && accountId != null ? [since, source, accountId] : source ? [since, source] : [since];
  return (getDb().prepare(q).all(...args) as BurndownPoint[]);
}

export interface FileHotspot {
  path: string;
  changes: number;
  sessions: number;
}

export function fileHotspots(limit = 10): FileHotspot[] {
  return getDb().prepare(`
    SELECT path,
           COUNT(*) AS changes,
           COUNT(DISTINCT session_id) AS sessions
    FROM file_changes
    GROUP BY path
    ORDER BY changes DESC
    LIMIT ?
  `).all(limit) as FileHotspot[];
}

export interface CodexCategorySplit {
  category: string;
  count: number;
}

export function codexCategories(): CodexCategorySplit[] {
  return getDb().prepare(`
    SELECT COALESCE(codex_category, 'unclassified') AS category,
           COUNT(*) AS count
    FROM sessions
    WHERE tool = 'codex'
    GROUP BY category
    ORDER BY count DESC
  `).all() as CodexCategorySplit[];
}

export interface DailySpend {
  date: string;       // YYYY-MM-DD
  claudeUsd: number;
  codexTokens: number;
}

export interface SpendingStats {
  claudeTotalUsd: number;
  codexTotalTokens: number;
  daily: DailySpend[]; // last 14 days
}

export function claudeApiEquivalentUsd(startMs = 0, endMs = Number.MAX_SAFE_INTEGER): number {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(session_max), 0) AS total
    FROM (
      SELECT MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS session_max
      FROM usage_snapshots
      WHERE source = 'statusline'
        AND captured_at >= ?
        AND captured_at < ?
        AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
      GROUP BY json_extract(raw_output, '$.session_id')
    )
  `).get(startMs, endMs) as { total: number };
  return row.total ?? 0;
}

/**
 * Blended USD-per-1M-tokens for Codex sessions, applied to `tokens_used`.
 *
 * `tokens_used` from Codex's threads table is **cumulative across turns** —
 * every turn re-sends system+history, so in a multi-turn coding session the
 * dominant cost is cached input re-reads. Sampled rows show breakdown sums
 * orders of magnitude smaller than `tokens_used` (e.g. 211K vs 24M), which
 * matches that pattern.
 *
 * Mix assumes ~95% cached input, ~4% fresh input, ~1% output, applied to
 * gpt-5-codex pricing (cached $0.175/M · input $1.75/M · output $14/M, per
 * developers.openai.com/api/docs/pricing as of 2026-05-31):
 *   0.95 * 0.175 + 0.04 * 1.75 + 0.01 * 14 = 0.376 USD/M ≈ $0.38/M
 *
 * Tune this constant if the price sheet shifts or the cache-hit assumption
 * looks off. Keep it conservative: better to under-claim "value" on shared
 * cards than to over-claim with a number we can't defend.
 */
const CODEX_BLENDED_USD_PER_MILLION = 0.38;

export function codexApiEquivalentUsd(startMs = 0, endMs = Number.MAX_SAFE_INTEGER): number {
  // Fall back to the input+cache+output sum when `tokens_used` is null — keeps
  // pricing consistent with `tokenTotals` in recap-card, which uses the same
  // COALESCE pattern for codex token totals.
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(
      COALESCE(
        tokens_used,
        COALESCE(input_tokens, 0)
        + COALESCE(cache_creation_tokens, 0)
        + COALESCE(cache_read_tokens, 0)
        + COALESCE(output_tokens, 0)
      )
    ), 0) AS total
    FROM sessions
    WHERE tool = 'codex'
      AND started_at >= ?
      AND started_at < ?
  `).get(startMs, endMs) as { total: number };
  return (row.total ?? 0) * CODEX_BLENDED_USD_PER_MILLION / 1_000_000;
}

export function spendingStats(): SpendingStats {
  const db = getDb();

  // Claude Code: sum max cost per session from usage_snapshots JSON
  const claudeTotal = claudeApiEquivalentUsd();

  // Codex: sum tokens_used
  const codexTotal = (db.prepare(`
    SELECT COALESCE(SUM(tokens_used), 0) AS total
    FROM sessions WHERE tool = 'codex' AND tokens_used IS NOT NULL
  `).get() as { total: number }).total;

  // Daily Claude cost: per session per day (max cost snapshot that day)
  const since = Date.now() - 14 * 86_400_000;
  const claudeDaily = db.prepare(`
    SELECT DATE(captured_at/1000, 'unixepoch', 'localtime') AS day,
           json_extract(raw_output, '$.session_id') AS sid,
           MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS cost
    FROM usage_snapshots
    WHERE source = 'statusline'
      AND captured_at > ?
      AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
    GROUP BY day, sid
  `).all(since) as { day: string; sid: string; cost: number }[];

  const claudeByDay = new Map<string, number>();
  for (const r of claudeDaily) {
    claudeByDay.set(r.day, (claudeByDay.get(r.day) ?? 0) + (r.cost ?? 0));
  }

  // Daily Codex tokens
  const codexDaily = db.prepare(`
    SELECT DATE(started_at/1000, 'unixepoch', 'localtime') AS day,
           SUM(tokens_used) AS tokens
    FROM sessions
    WHERE tool = 'codex' AND tokens_used IS NOT NULL AND started_at > ?
    GROUP BY day
  `).all(since) as { day: string; tokens: number }[];

  const codexByDay = new Map(codexDaily.map((r) => [r.day, r.tokens]));

  // Build last 14 days
  const daily: DailySpend[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    daily.push({
      date: key,
      claudeUsd: claudeByDay.get(key) ?? 0,
      codexTokens: codexByDay.get(key) ?? 0,
    });
  }

  return { claudeTotalUsd: claudeTotal, codexTotalTokens: codexTotal, daily };
}

// ── per-project cost attribution ───────────────────────────────────────────
// The pure fold + types live in cost-attribution.ts (no DB) so they're
// directly unit-testable; this file owns only the DB query that feeds them.

export type { ProjectCost, ProjectCostContribution } from './cost-attribution';
export { groupCostByProject } from './cost-attribution';

function projectBasename(cwd: string | null): string {
  if (!cwd) return '—';
  return cwd.split('/').filter(Boolean).pop() ?? '—';
}

/**
 * Per-project API-equivalent spend over an optional window. Claude cost is the
 * per-session max `cost.total_cost_usd` from statusline snapshots; Codex cost is
 * tokens × the blended rate. One row per session feeds `groupCostByProject`.
 */
export function costByProject(startMs = 0, endMs = Number.MAX_SAFE_INTEGER): ProjectCost[] {
  const db = getDb();

  const claudeRows = db.prepare(`
    SELECT s.cwd AS cwd,
           (SELECT MAX(CAST(json_extract(us.raw_output, '$.cost.total_cost_usd') AS REAL))
              FROM usage_snapshots us
              WHERE us.source = 'statusline'
                AND json_extract(us.raw_output, '$.session_id') = s.id) AS cost_usd
    FROM sessions s
    WHERE s.tool = 'claude-code'
      AND s.cwd IS NOT NULL
      AND s.started_at >= ? AND s.started_at < ?
  `).all(startMs, endMs) as { cwd: string | null; cost_usd: number | null }[];

  const codexRows = db.prepare(`
    SELECT s.cwd AS cwd,
           COALESCE(
             s.tokens_used,
             COALESCE(s.input_tokens, 0)
             + COALESCE(s.cache_creation_tokens, 0)
             + COALESCE(s.cache_read_tokens, 0)
             + COALESCE(s.output_tokens, 0)
           ) AS tokens
    FROM sessions s
    WHERE s.tool = 'codex'
      AND s.cwd IS NOT NULL
      AND s.started_at >= ? AND s.started_at < ?
  `).all(startMs, endMs) as { cwd: string | null; tokens: number | null }[];

  const contributions: ProjectCostContribution[] = [];
  for (const r of claudeRows) {
    if (r.cost_usd == null || r.cost_usd <= 0) continue;
    contributions.push({ project: projectBasename(r.cwd), claudeUsd: r.cost_usd, codexUsd: 0 });
  }
  for (const r of codexRows) {
    const tokens = r.tokens ?? 0;
    if (tokens <= 0) continue;
    contributions.push({
      project: projectBasename(r.cwd),
      claudeUsd: 0,
      codexUsd: (tokens * CODEX_BLENDED_USD_PER_MILLION) / 1_000_000,
    });
  }
  return groupCostByProject(contributions);
}

export interface TimelineSession {
  id: string;
  tool: string;
  project: string;
  startMs: number;
  endMs: number;
  aiTitle: string | null;
}

export function dayTimeline(dayOffset = 0): { dateLabel: string; sessions: TimelineSession[] } {
  const target = new Date();
  target.setDate(target.getDate() + dayOffset);
  target.setHours(0, 0, 0, 0);
  const start = target.getTime();
  const end = start + 86_400_000;

  const rows = getDb().prepare(`
    SELECT id, tool, cwd, started_at, ended_at, ai_title
    FROM sessions
    WHERE started_at < ? AND COALESCE(ended_at, started_at + 60000) > ?
    ORDER BY started_at ASC
  `).all(end, start) as { id: string; tool: string; cwd: string | null; started_at: number; ended_at: number | null; ai_title: string | null }[];

  return {
    dateLabel: target.toISOString().slice(0, 10),
    sessions: rows.map((r) => ({
      id: r.id,
      tool: r.tool,
      project: r.cwd?.split('/').filter(Boolean).pop() ?? '—',
      startMs: r.started_at,
      endMs: r.ended_at ?? Math.min(Date.now(), end),
      aiTitle: r.ai_title,
    })),
  };
}

export interface RetryRate {
  totalSessions: number;
  retriedSessions: number;
  pct: number;
}

export interface ExpensiveSession {
  id: string;
  tool: string;
  cwd: string | null;
  project: string;
  aiTitle: string | null;
  startedAt: number;
  durationMs: number;
  costUsd: number | null;
  transcriptPath: string | null;
}

export interface SubscriptionValue {
  monthToDateUsd: number;
  plans: { name: string; priceUsd: number; multiplier: number }[];
}

export interface SessionInsight {
  retryRate7d: RetryRate;
  topExpensive: ExpensiveSession[];
  value: SubscriptionValue;
}

function transcriptPathFor(tool: string, cwd: string | null, id: string): string | null {
  if (tool !== 'claude-code' || !cwd) return null;
  const encoded = cwd.replace(/\//g, '-');
  const home = process.env.HOME ?? '';
  return `${home}/.claude/projects/${encoded}/${id}.jsonl`;
}

/**
 * "Rework rate" = sessions that started within 30 min of the previous session's
 * end in the same cwd. Heuristic for "didn't get what I wanted the first time".
 *
 * The window is [startMs, endMs); `cwd` optionally narrows to a single project
 * (basename match — we already store the full path so the equality is exact).
 * Untyped numeric inputs land back as 0% when the window is empty, matching the
 * legacy `retryRate7d` behaviour the old SessionInsight surface depended on.
 */
export function reworkRate(startMs: number, endMs: number, cwd?: string): RetryRate {
  const db = getDb();
  const params: (string | number)[] = [startMs, endMs];
  let cwdFilter = '';
  if (cwd) {
    cwdFilter = ' AND cwd = ?';
    params.push(cwd);
  }
  const rows = db.prepare(`
    SELECT id, tool, cwd, started_at, ended_at
    FROM sessions
    WHERE started_at >= ? AND started_at < ? AND cwd IS NOT NULL
      ${cwdFilter}
    ORDER BY cwd, started_at ASC
  `).all(...params) as { id: string; tool: string; cwd: string; started_at: number; ended_at: number | null }[];

  let total = 0;
  let retried = 0;
  let prev: { cwd: string; endedAt: number } | null = null;
  for (const r of rows) {
    total++;
    if (prev && prev.cwd === r.cwd && r.started_at - prev.endedAt < 30 * 60_000) {
      retried++;
    }
    prev = { cwd: r.cwd, endedAt: r.ended_at ?? r.started_at };
  }
  const pct = total === 0 ? 0 : Math.round((retried / total) * 100);
  return { totalSessions: total, retriedSessions: retried, pct };
}

/**
 * Legacy 7-day rework heuristic used by `sessionInsight()`. Kept as a thin
 * delegate so existing call sites don't break in this commit; new code should
 * call `reworkRate(startMs, endMs)` directly.
 */
export function retryRate7d(): RetryRate {
  return reworkRate(Date.now() - 7 * 86_400_000, Date.now());
}

export function sessionInsight(): SessionInsight {
  const db = getDb();
  const rework = retryRate7d();

  const expensiveRows = db.prepare(`
    SELECT s.id, s.tool, s.cwd, s.ai_title, s.started_at, s.ended_at,
           (SELECT MAX(CAST(json_extract(us.raw_output, '$.cost.total_cost_usd') AS REAL))
              FROM usage_snapshots us
              WHERE us.source = 'statusline'
                AND json_extract(us.raw_output, '$.session_id') = s.id) AS cost_usd
    FROM sessions s
    WHERE s.tool = 'claude-code'
    ORDER BY cost_usd IS NULL, cost_usd DESC
    LIMIT 5
  `).all() as { id: string; tool: string; cwd: string | null; ai_title: string | null; started_at: number; ended_at: number | null; cost_usd: number | null }[];

  const topExpensive: ExpensiveSession[] = expensiveRows
    .filter((r) => r.cost_usd != null && r.cost_usd > 0)
    .map((r) => ({
      id: r.id,
      tool: r.tool,
      cwd: r.cwd,
      project: r.cwd?.split('/').filter(Boolean).pop() ?? '—',
      aiTitle: r.ai_title,
      startedAt: r.started_at,
      durationMs: Math.max(0, (r.ended_at ?? r.started_at) - r.started_at),
      costUsd: r.cost_usd,
      transcriptPath: transcriptPathFor(r.tool, r.cwd, r.id),
    }));

  // Month-to-date Claude API-equivalent cost
  const monthStart = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const monthToDateUsd = claudeApiEquivalentUsd(monthStart);
  const plans = [
    { name: 'Pro $20', priceUsd: 20 },
    { name: 'Max $100', priceUsd: 100 },
    { name: 'Max $200', priceUsd: 200 },
  ].map((p) => ({
    name: p.name,
    priceUsd: p.priceUsd,
    multiplier: p.priceUsd > 0 ? Math.round((monthToDateUsd / p.priceUsd) * 10) / 10 : 0,
  }));

  return {
    retryRate7d: rework,
    topExpensive,
    value: { monthToDateUsd, plans },
  };
}

export interface CacheBreakdownRow {
  project: string;
  sessions: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** cache_read / (input + cache_creation + cache_read) — 0..100 */
  hitRatePct: number;
}

export interface CacheStats {
  /** Total across Claude Code sessions in the configured window. */
  totalInput: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  totalOutput: number;
  /** % of incoming tokens served from cache. */
  hitRatePct: number;
  /**
   * Money saved vs. fully uncached (1.0x) — cache_read costs 0.1x, so saved ≈ 0.9 * cache_read tokens.
   * Returned as a unit-less multiplier of "input tokens equivalent saved".
   */
  inputTokensSaved: number;
  sessionsAnalyzed: number;
  topProjects: CacheBreakdownRow[];
  worstSessions: Array<{
    id: string;
    project: string;
    aiTitle: string | null;
    startedAt: number;
    hitRatePct: number;
    inputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    transcriptPath: string | null;
  }>;
  /** One-sentence hint generated from the numbers; UI can show this verbatim. */
  hint: string;
}

function ratePct(read: number, input: number, creation: number): number {
  const denom = read + input + creation;
  if (denom <= 0) return 0;
  return Math.round((read / denom) * 100);
}

export function cacheStats(windowDays = 30): CacheStats {
  return cacheStatsForRange(Date.now() - windowDays * 86_400_000, Date.now());
}

export interface RecapDailyPoint {
  /** YYYY-MM-DD in local time, for stable ordering and debugging. */
  date: string;
  valueUsd: number;
  tokens: number;
  sessions: number;
  prompts: number;
  /** 0–100, integer; 0 on days with no eligible sessions. */
  cacheHitPct: number;
}

/**
 * Build a dense per-day series for the recap card sparklines. Empty days are
 * filled with zeros so the SVG renderer can rely on a fixed-length array. The
 * day grid is computed in local time to match the rest of stats.ts.
 */
function toolWhere(tool: RecapToolFilter, alias = ''): { sql: string; params: RecapToolFilter[] } {
  if (tool === 'all') return { sql: '', params: [] };
  const prefix = alias ? `${alias}.` : '';
  return { sql: ` AND ${prefix}tool = ?`, params: [tool] };
}

function meteredToolWhere(tool: RecapToolFilter): { sql: string; params: RecapToolFilter[] } {
  if (tool === 'all') return { sql: " AND tool IN ('claude-code', 'codex')", params: [] };
  return { sql: ' AND tool = ?', params: [tool] };
}

export function recapDailySeries(startMs: number, endMs = Date.now(), tool: RecapToolFilter = 'all'): RecapDailyPoint[] {
  const db = getDb();

  // Claude API-equivalent USD: max(cost_total) per (day, session) → sum to day.
  const claudeRows = tool === 'codex' || tool === 'cursor'
    ? []
    : db.prepare(`
      SELECT DATE(captured_at/1000, 'unixepoch', 'localtime') AS day,
             json_extract(raw_output, '$.session_id') AS sid,
             MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS cost
      FROM usage_snapshots
      WHERE source = 'statusline'
        AND captured_at >= ?
        AND captured_at < ?
        AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
      GROUP BY day, sid
    `).all(startMs, endMs) as { day: string; sid: string; cost: number }[];
  const valueByDay = new Map<string, number>();
  for (const row of claudeRows) {
    valueByDay.set(row.day, (valueByDay.get(row.day) ?? 0) + (row.cost ?? 0));
  }

  // Sessions + tokens + cache breakdown per day.
  const filter = toolWhere(tool);
  const sessionRows = db.prepare(`
    SELECT DATE(started_at/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS sessions,
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
           ), 0) AS tokens,
           COALESCE(SUM(COALESCE(prompt_count, 0)), 0)          AS prompts,
           COALESCE(SUM(COALESCE(input_tokens, 0)), 0)          AS input,
           COALESCE(SUM(COALESCE(cache_creation_tokens, 0)), 0) AS creation,
           COALESCE(SUM(COALESCE(cache_read_tokens, 0)), 0)     AS read_tokens
    FROM sessions
    WHERE started_at >= ?
      AND started_at < ?
      ${filter.sql}
    GROUP BY day
  `).all(startMs, endMs, ...filter.params) as {
    day: string;
    sessions: number;
    tokens: number;
    prompts: number;
    input: number;
    creation: number;
    read_tokens: number;
  }[];
  const sessionsByDay = new Map(sessionRows.map((r) => [r.day, r]));

  // Build the dense day grid covering [startMs, endMs]. We iterate local-time
  // calendar days so the keys match the SQL DATE(...) output.
  const start = new Date(startMs);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const end = new Date(endMs);
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  const out: RecapDailyPoint[] = [];
  for (let d = new Date(startDay); d <= endDay; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = sessionsByDay.get(key);
    const hitPct = row ? ratePct(row.read_tokens, row.input, row.creation) : 0;
    out.push({
      date: key,
      valueUsd: Math.round((valueByDay.get(key) ?? 0) * 100) / 100,
      tokens: row?.tokens ?? 0,
      sessions: row?.sessions ?? 0,
      prompts: row?.prompts ?? 0,
      cacheHitPct: hitPct,
    });
  }
  return out;
}

export function cacheStatsForRange(startMs: number, endMs = Date.now(), tool: RecapToolFilter = 'all'): CacheStats {
  const db = getDb();
  const filter = meteredToolWhere(tool);

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0)          AS input,
      COALESCE(SUM(cache_creation_tokens), 0) AS creation,
      COALESCE(SUM(cache_read_tokens), 0)     AS read,
      COALESCE(SUM(output_tokens), 0)         AS output,
      COUNT(*)                                AS sessions
    FROM sessions
    WHERE 1 = 1
      ${filter.sql}
      AND started_at > ?
      AND started_at < ?
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
  `).get(...filter.params, startMs, endMs) as { input: number; creation: number; read: number; output: number; sessions: number };

  const hitRatePct = ratePct(totals.read, totals.input, totals.creation);
  // cache_read costs 0.1x of normal input tokens → saved ≈ 0.9 * cache_read tokens worth of input
  const inputTokensSaved = Math.round(totals.read * 0.9);

  const projectRows = db.prepare(`
    SELECT cwd,
           COUNT(*) AS sessions,
           COALESCE(SUM(input_tokens), 0)          AS input,
           COALESCE(SUM(cache_creation_tokens), 0) AS creation,
           COALESCE(SUM(cache_read_tokens), 0)     AS read,
           COALESCE(SUM(output_tokens), 0)         AS output
    FROM sessions
    WHERE 1 = 1
      ${filter.sql}
      AND started_at > ?
      AND started_at < ?
      AND cwd IS NOT NULL
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
    GROUP BY cwd
    ORDER BY (input + creation + read) DESC
    LIMIT 8
  `).all(...filter.params, startMs, endMs) as { cwd: string; sessions: number; input: number; creation: number; read: number; output: number }[];

  const topProjects: CacheBreakdownRow[] = projectRows.map((r) => ({
    project: r.cwd.split('/').filter(Boolean).pop() ?? '—',
    sessions: r.sessions,
    inputTokens: r.input,
    cacheCreationTokens: r.creation,
    cacheReadTokens: r.read,
    outputTokens: r.output,
    hitRatePct: ratePct(r.read, r.input, r.creation),
  }));

  const worstRows = db.prepare(`
    SELECT id, tool, cwd, ai_title, started_at,
           COALESCE(input_tokens, 0)          AS input,
           COALESCE(cache_creation_tokens, 0) AS creation,
           COALESCE(cache_read_tokens, 0)     AS read
    FROM sessions
    WHERE 1 = 1
      ${filter.sql}
      AND started_at > ?
      AND started_at < ?
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
      AND (input_tokens + cache_creation_tokens + cache_read_tokens) > 50000
    ORDER BY (CAST(cache_read_tokens AS REAL) /
             NULLIF(input_tokens + cache_creation_tokens + cache_read_tokens, 0)) ASC,
             (input_tokens + cache_creation_tokens + cache_read_tokens) DESC
    LIMIT 5
  `).all(...filter.params, startMs, endMs) as { id: string; tool: string; cwd: string | null; ai_title: string | null; started_at: number; input: number; creation: number; read: number }[];

  const worstSessions = worstRows.map((r) => ({
    id: r.id,
    project: r.cwd?.split('/').filter(Boolean).pop() ?? '—',
    aiTitle: r.ai_title,
    startedAt: r.started_at,
    hitRatePct: ratePct(r.read, r.input, r.creation),
    inputTokens: r.input,
    cacheCreationTokens: r.creation,
    cacheReadTokens: r.read,
    transcriptPath: transcriptPathFor(r.tool, r.cwd, r.id),
  }));

  const hint = (() => {
    if (totals.sessions === 0) return '';
    if (hitRatePct >= 75) return 'cache-hint-strong';
    if (hitRatePct >= 50) return 'cache-hint-ok';
    if (hitRatePct >= 25) return 'cache-hint-low';
    return 'cache-hint-bad';
  })();

  return {
    totalInput: totals.input,
    totalCacheCreation: totals.creation,
    totalCacheRead: totals.read,
    totalOutput: totals.output,
    hitRatePct,
    inputTokensSaved,
    sessionsAnalyzed: totals.sessions,
    topProjects,
    worstSessions,
    hint,
  };
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  progress?: { current: number; target: number };
}

export function achievements(): Achievement[] {
  const db = getDb();
  const totalSessions = (db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number }).n;
  const longestStreak = activityStreak().longest;
  const sp = spendingStats();
  const longestMs = (db.prepare(`
    SELECT COALESCE(MAX(COALESCE(ended_at, started_at) - started_at), 0) AS ms FROM sessions
  `).get() as { ms: number }).ms;
  const projectCount = (db.prepare(`
    SELECT COUNT(DISTINCT cwd) AS n FROM sessions WHERE cwd IS NOT NULL
  `).get() as { n: number }).n;
  const lateNight = (db.prepare(`
    SELECT COUNT(*) AS n FROM sessions
    WHERE CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INT) >= 23
       OR CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INT) < 4
  `).get() as { n: number }).n;
  const earlyBird = (db.prepare(`
    SELECT COUNT(*) AS n FROM sessions
    WHERE CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INT) >= 4
      AND CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INT) < 7
  `).get() as { n: number }).n;
  const toolCount = (db.prepare(`SELECT COUNT(DISTINCT tool) AS n FROM sessions`).get() as { n: number }).n;

  const prog = (current: number, target: number) => ({ current: Math.min(current, target), target });

  return [
    { id: 'sessions-100',  title: '百战不殆',     description: '100 sessions logged',          unlocked: totalSessions >= 100,   progress: prog(totalSessions, 100) },
    { id: 'sessions-500',  title: '已成习惯',     description: '500 sessions logged',          unlocked: totalSessions >= 500,   progress: prog(totalSessions, 500) },
    { id: 'sessions-1000', title: '千锤百炼',     description: '1000 sessions logged',         unlocked: totalSessions >= 1000,  progress: prog(totalSessions, 1000) },
    { id: 'streak-7',      title: '一周连击',     description: '7-day coding streak',          unlocked: longestStreak >= 7,     progress: prog(longestStreak, 7) },
    { id: 'streak-30',     title: '月度坚持',     description: '30-day coding streak',         unlocked: longestStreak >= 30,    progress: prog(longestStreak, 30) },
    { id: 'spend-10',      title: '小试牛刀',     description: 'Claude spend $10+',            unlocked: sp.claudeTotalUsd >= 10,    progress: prog(sp.claudeTotalUsd, 10) },
    { id: 'spend-100',     title: '挥金如土',     description: 'Claude spend $100+',           unlocked: sp.claudeTotalUsd >= 100,   progress: prog(sp.claudeTotalUsd, 100) },
    { id: 'tokens-100m',   title: 'Token 富翁',   description: '100M Codex tokens',            unlocked: sp.codexTotalTokens >= 100_000_000, progress: prog(sp.codexTotalTokens, 100_000_000) },
    { id: 'tokens-1b',     title: 'Token 大户',   description: '1B Codex tokens',              unlocked: sp.codexTotalTokens >= 1_000_000_000, progress: prog(sp.codexTotalTokens, 1_000_000_000) },
    { id: 'marathon-4h',   title: '马拉松选手',   description: 'Single session 4h+',           unlocked: longestMs >= 4 * 3_600_000, progress: prog(longestMs, 4 * 3_600_000) },
    { id: 'marathon-8h',   title: '通宵达旦',     description: 'Single session 8h+',           unlocked: longestMs >= 8 * 3_600_000, progress: prog(longestMs, 8 * 3_600_000) },
    { id: 'projects-10',   title: '博学多才',     description: 'Worked on 10+ projects',       unlocked: projectCount >= 10,     progress: prog(projectCount, 10) },
    { id: 'projects-30',   title: '杂家',         description: 'Worked on 30+ projects',       unlocked: projectCount >= 30,     progress: prog(projectCount, 30) },
    { id: 'night-owl',     title: '夜猫子',       description: 'Past-midnight sessions 10+',   unlocked: lateNight >= 10,        progress: prog(lateNight, 10) },
    { id: 'early-bird',    title: '晨型人',       description: 'Pre-7am sessions 5+',          unlocked: earlyBird >= 5,         progress: prog(earlyBird, 5) },
    { id: 'multi-tool',    title: '多面手',       description: 'Used 3 different tools',       unlocked: toolCount >= 3,         progress: prog(toolCount, 3) },
  ];
}

// ── Phase 3: Project ROI metrics ────────────────────────────────────────────
//
// Five metrics surfaced on a per-project card. The pure math lives in roi.ts;
// this section owns the SQL that feeds it.

export interface OutcomeBreakdown {
  shipped: number;
  bugfix: number;
  failed: number;
  discarded: number;
  refactor: number;
  explore: number;
  untagged: number;
}

/**
 * Count sessions by outcome over [startMs, endMs); optional `cwd` narrows to a
 * single project. NULL outcomes land in `untagged` so callers can decide
 * whether to surface "% untagged" alongside the ratio.
 */
export function outcomeBreakdown(
  startMs: number,
  endMs: number,
  cwd?: string,
): OutcomeBreakdown {
  const db = getDb();
  const params: (string | number)[] = [startMs, endMs];
  let cwdFilter = '';
  if (cwd) { cwdFilter = ' AND cwd = ?'; params.push(cwd); }
  const rows = db.prepare(`
    SELECT outcome, COUNT(*) AS n
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      ${cwdFilter}
    GROUP BY outcome
  `).all(...params) as { outcome: string | null; n: number }[];
  const out: OutcomeBreakdown = {
    shipped: 0, bugfix: 0, failed: 0, discarded: 0, refactor: 0, explore: 0, untagged: 0,
  };
  for (const r of rows) {
    if (r.outcome == null) { out.untagged += r.n; continue; }
    if (r.outcome === 'shipped') out.shipped += r.n;
    else if (r.outcome === 'bugfix') out.bugfix += r.n;
    else if (r.outcome === 'failed') out.failed += r.n;
    else if (r.outcome === 'discarded') out.discarded += r.n;
    else if (r.outcome === 'refactor') out.refactor += r.n;
    else if (r.outcome === 'explore') out.explore += r.n;
    // Unknown future-outcome strings are ignored on purpose — better than
    // crashing or rolling them into "untagged" and corrupting the ratio.
  }
  return out;
}

/**
 * Fetch raw outcome values for [startMs, endMs) so `computeShipRate` can
 * compute on already-rowified data. We return `outcome | null` per row so the
 * pure function owns the "exclude untagged" decision.
 */
export function outcomeRowsForWindow(
  startMs: number,
  endMs: number,
  cwd?: string,
): { outcome: Outcome | null }[] {
  const db = getDb();
  const params: (string | number)[] = [startMs, endMs];
  let cwdFilter = '';
  if (cwd) { cwdFilter = ' AND cwd = ?'; params.push(cwd); }
  const rows = db.prepare(`
    SELECT outcome
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      ${cwdFilter}
  `).all(...params) as { outcome: string | null }[];
  return rows.map((r) => ({ outcome: (r.outcome ?? null) as Outcome | null }));
}

/**
 * Per-project session counts over [startMs, endMs). Projects with zero
 * sessions in the window are omitted (they'd dilute the entropy denominator).
 * The `cwd` here is the full path; `computeFocus` only cares about the count
 * distribution, not the labels.
 */
export function projectSessionCountsForWindow(
  startMs: number,
  endMs: number,
): Map<string, number> {
  const rows = getDb().prepare(`
    SELECT cwd, COUNT(*) AS n
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      AND cwd IS NOT NULL
    GROUP BY cwd
    HAVING COUNT(*) > 0
  `).all(startMs, endMs) as { cwd: string; n: number }[];
  return new Map(rows.map((r) => [r.cwd, r.n]));
}

/**
 * Returns weekly session counts in chronological order: index 0 is the oldest
 * week, index `weeksBack` is the current (in-progress) week. Length is
 * `weeksBack + 1`. Weeks are aligned to local midnight on the start day; the
 * "current week" anchor is `now` so the freshest data lands in the last slot.
 *
 * Caller for Momentum: pass `weeksBack = 3` → `[w-3, w-2, w-1, current]`. The
 * first three feed `prior3WeeksCounts`, the last is `currentWeekCount`.
 */
export function weeklySessionCounts(
  cwd: string | undefined,
  weeksBack: number,
  nowMs: number = Date.now(),
): number[] {
  const db = getDb();
  const weekMs = 7 * 86_400_000;
  // Anchor "current week" as the trailing 7d ending at `nowMs`; we don't try
  // to snap to ISO Monday because the metric is "rolling momentum" not
  // "calendar week" and a snap would flip labels at midnight on Sunday.
  const counts: number[] = [];
  // Each slot is [windowStart, windowEnd). Run one query per slot — small N
  // (typically 4) and cleaner than building a CASE-based bucket query.
  for (let i = weeksBack; i >= 0; i--) {
    const end = nowMs - i * weekMs;
    const start = end - weekMs;
    const cwdFilter = cwd ? ' AND cwd = ?' : '';
    const args: (string | number)[] = cwd ? [start, end, cwd] : [start, end];
    const row = db.prepare(`
      SELECT COUNT(*) AS n
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        ${cwdFilter}
    `).get(...args) as { n: number };
    counts.push(row.n);
  }
  return counts;
}

/**
 * Total `session_commits` rows whose `committed_at` lands in [startMs, endMs),
 * scoped to a project by joining through the session's `cwd`. Used for
 * Output-per-Dollar.
 */
export function commitsInWindow(
  startMs: number,
  endMs: number,
  cwd?: string,
): number {
  const db = getDb();
  if (cwd) {
    return (db.prepare(`
      SELECT COUNT(*) AS n
      FROM session_commits sc
      JOIN sessions s ON s.id = sc.session_id
      WHERE sc.committed_at >= ? AND sc.committed_at < ?
        AND s.cwd = ?
    `).get(startMs, endMs, cwd) as { n: number }).n;
  }
  return (db.prepare(`
    SELECT COUNT(*) AS n
    FROM session_commits
    WHERE committed_at >= ? AND committed_at < ?
  `).get(startMs, endMs) as { n: number }).n;
}

/**
 * Total API-equivalent USD over [startMs, endMs). Reuses the project-cost
 * fold so we have one source of truth for "total cost" instead of a parallel
 * SQL pass. When `cwd` is provided we filter the contributions to that
 * basename (`projectBasename` is how costByProject labels rows).
 */
export function costUsdInWindow(
  startMs: number,
  endMs: number,
  cwd?: string,
): number {
  const projects = costByProject(startMs, endMs);
  if (cwd) {
    const base = projectBasename(cwd);
    const hit = projects.find((p) => p.project === base);
    return hit ? hit.totalUsd : 0;
  }
  return projects.reduce((s, p) => s + p.totalUsd, 0);
}

export interface ProjectRoi {
  /** When undefined the metrics span all projects. */
  cwd: string | undefined;
  windowStartMs: number;
  windowEndMs: number;
  shipRate: { rate: number | null; denominator: number; untagged: number };
  reworkRate: RetryRate;
  momentum: { ratio: number | null; label: MomentumLabel | null };
  focus: number | null;
  outputPerDollar: { commitsPerDollar: number | null; shippedSessionsPerDollar: number | null };
  totalCostUsd: number;
  totalCommits: number;
}

/**
 * Roll up all five Phase 3 metrics for a window/project pair. The card calls
 * this once per (project, window) and pipes the result into the per-tile UI.
 *
 * Focus is intentionally *not* scoped by cwd — it's a property of "what was
 * the user doing this week", not "what was project X doing this week". The
 * card label makes the global scope explicit so the value doesn't look
 * inconsistent across project selections.
 */
export function projectRoi(
  startMs: number,
  endMs: number,
  cwd?: string,
  nowMs: number = Date.now(),
): ProjectRoi {
  const outcomes = outcomeRowsForWindow(startMs, endMs, cwd);
  const breakdown = outcomeBreakdown(startMs, endMs, cwd);
  const shipRate = computeShipRate(outcomes);
  const rework = reworkRate(startMs, endMs, cwd);
  const weekly = weeklySessionCounts(cwd, 3, nowMs);
  // weekly is length 4: [w-3, w-2, w-1, current]
  const momentum = computeMomentum(weekly[3] ?? 0, [
    weekly[0] ?? 0,
    weekly[1] ?? 0,
    weekly[2] ?? 0,
  ]);
  // Focus uses the global per-project distribution — it's a "what was the
  // window like overall" metric, not a per-project one.
  const distribution = [...projectSessionCountsForWindow(startMs, endMs).values()];
  const focus = computeFocus(distribution);
  const totalCommits = commitsInWindow(startMs, endMs, cwd);
  const totalCostUsd = costUsdInWindow(startMs, endMs, cwd);
  const shippedSessions = breakdown.shipped + breakdown.bugfix;
  const outputPerDollar = computeOutputPerDollar({
    commits: totalCommits,
    shippedSessions,
    costUsd: totalCostUsd,
  });
  return {
    cwd,
    windowStartMs: startMs,
    windowEndMs: endMs,
    shipRate: {
      rate: shipRate.rate,
      denominator: shipRate.denominator,
      untagged: breakdown.untagged,
    },
    reworkRate: rework,
    momentum,
    focus,
    outputPerDollar,
    totalCostUsd,
    totalCommits,
  };
}

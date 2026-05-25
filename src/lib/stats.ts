import { getDb } from './db';

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

export function spendingStats(): SpendingStats {
  const db = getDb();

  // Claude Code: sum max cost per session from usage_snapshots JSON
  const claudeTotal = (db.prepare(`
    SELECT COALESCE(SUM(session_max), 0) AS total
    FROM (
      SELECT MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS session_max
      FROM usage_snapshots
      WHERE source = 'statusline'
        AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
      GROUP BY json_extract(raw_output, '$.session_id')
    )
  `).get() as { total: number }).total;

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
 * "Retry rate" = sessions that started within 30 min of the previous session's
 * end in the same cwd. Heuristic for "didn't get what I wanted the first time".
 */
export function sessionInsight(): SessionInsight {
  const db = getDb();
  const since = Date.now() - 7 * 86_400_000;

  const rows = db.prepare(`
    SELECT id, tool, cwd, started_at, ended_at
    FROM sessions
    WHERE started_at > ? AND cwd IS NOT NULL
    ORDER BY cwd, started_at ASC
  `).all(since) as { id: string; tool: string; cwd: string; started_at: number; ended_at: number | null }[];

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
  const mtdRow = db.prepare(`
    SELECT COALESCE(SUM(session_max), 0) AS total
    FROM (
      SELECT MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS session_max
      FROM usage_snapshots
      WHERE source = 'statusline'
        AND captured_at >= ?
        AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
      GROUP BY json_extract(raw_output, '$.session_id')
    )
  `).get(monthStart) as { total: number };
  const monthToDateUsd = mtdRow.total ?? 0;
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
    retryRate7d: { totalSessions: total, retriedSessions: retried, pct },
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
  const db = getDb();
  const since = Date.now() - windowDays * 86_400_000;

  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0)          AS input,
      COALESCE(SUM(cache_creation_tokens), 0) AS creation,
      COALESCE(SUM(cache_read_tokens), 0)     AS read,
      COALESCE(SUM(output_tokens), 0)         AS output,
      COUNT(*)                                AS sessions
    FROM sessions
    WHERE tool = 'claude-code'
      AND started_at > ?
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
  `).get(since) as { input: number; creation: number; read: number; output: number; sessions: number };

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
    WHERE tool = 'claude-code'
      AND started_at > ?
      AND cwd IS NOT NULL
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
    GROUP BY cwd
    ORDER BY (input + creation + read) DESC
    LIMIT 8
  `).all(since) as { cwd: string; sessions: number; input: number; creation: number; read: number; output: number }[];

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
    SELECT id, cwd, ai_title, started_at,
           COALESCE(input_tokens, 0)          AS input,
           COALESCE(cache_creation_tokens, 0) AS creation,
           COALESCE(cache_read_tokens, 0)     AS read
    FROM sessions
    WHERE tool = 'claude-code'
      AND started_at > ?
      AND (input_tokens IS NOT NULL OR cache_read_tokens IS NOT NULL)
      AND (input_tokens + cache_creation_tokens + cache_read_tokens) > 50000
    ORDER BY (CAST(cache_read_tokens AS REAL) /
             NULLIF(input_tokens + cache_creation_tokens + cache_read_tokens, 0)) ASC,
             (input_tokens + cache_creation_tokens + cache_read_tokens) DESC
    LIMIT 5
  `).all(since) as { id: string; cwd: string | null; ai_title: string | null; started_at: number; input: number; creation: number; read: number }[];

  const worstSessions = worstRows.map((r) => ({
    id: r.id,
    project: r.cwd?.split('/').filter(Boolean).pop() ?? '—',
    aiTitle: r.ai_title,
    startedAt: r.started_at,
    hitRatePct: ratePct(r.read, r.input, r.creation),
    inputTokens: r.input,
    cacheCreationTokens: r.creation,
    cacheReadTokens: r.read,
    transcriptPath: transcriptPathFor('claude-code', r.cwd, r.id),
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

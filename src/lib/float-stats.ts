import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCodexAccounts } from './codex-auth';
import { dataDir } from './data-dir';
import { getDb } from './db';
import { readLiveContext } from './parsers/session-log';
import { getLatestQuotaSnapshot, getLatestUsageSnapshot, type UsageSnapshotRecord } from './usage-snapshots';
import { readWaitingSessions, type WaitingSession } from './attention';
import { normalizeQuotaWindow } from './quota-window';
import { buildRecapCard, type RecapPeriod } from './recap-card';
import { readRecapSettings } from './recap-settings';

/** Periods offered by the floater's metric switcher, in display order. */
const FLOAT_METRIC_PERIODS: RecapPeriod[] = ['today', '7d', '30d'];

/**
 * Claude conversation context window (tokens). Claude Sonnet 4.x / Opus 4.x
 * advertise 200k; values are deliberately conservative — we trip the
 * "compact soon" warning before the model hard-fails.
 */
const CLAUDE_CONTEXT_LIMIT = 200_000;
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60_000;
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;

export interface FloatQuota {
  agent: 'codex' | 'claude-code';
  label: string;
  accountLabel: string | null;
  remaining5h: number | null;
  used5h: number | null;
  remainingWeekly: number | null;
  usedWeekly: number | null;
  resetAt5h: number | null;
  resetAtWeekly: number | null;
  capturedAt: number | null;
  /** True when the underlying snapshot is older than a full quota window, so the
   * numbers are a last-known reading rather than a live one (e.g. Codex quota
   * with no recent session). The UI should de-emphasise the ring and show age
   * instead of a confident countdown. */
  stale: boolean;
  /** Predicted minutes until 5h window hits 100%, based on last 30 min slope. null if slope ≤ 0 or insufficient data. */
  pace5hExhaustMin: number | null;
  /** % per minute, rounded to 2 decimals. */
  pace5hPctPerMin: number | null;
}

export interface FloatContext {
  sessionId: string;
  project: string;
  tokens: number;
  limit: number;
  pct: number;
  capturedAt: number;
  /** true once we cross the soft "you should /compact" line. */
  warning: boolean;
  /** 综合建议（context 膨胀分级 + Opus 倍率提示），null = 健康无需提示 */
  advice: string | null;
  /** 浮窗 label 用的短建议（≤4 字），如「该清」「宜分流」「⚡Opus」 */
  adviceShort: string | null;
  /** 建议级别，用于浮窗染色 */
  adviceLevel: "watch" | "high" | "critical" | null;
  /** 当前会话最近一个 turn 的模型名 */
  model: string | null;
}

export interface FloatStats {
  generatedAt: number;
  primary: FloatQuota | null;
  quotas: FloatQuota[];
  /** Sessions blocked waiting for you (Claude needs input/permission). */
  waiting: WaitingSession[];
  liveByAgent: FloatAgentLive[];
  recentSessions: FloatRecentSession[];
  projectStats: FloatProjectStats[];
  todaySessions: number;
  totalSessions: number;
  sessionStatsByAgent: FloatSessionStats[];
  todayByTool: { tool: string; count: number }[];
  lastSession: {
    id: string;
    tool: string;
    project: string;
    cwd: string | null;
    title: string | null;
    startedAt: number;
    transcriptPath: string | null;
  } | null;
  /** Latest Claude Code turn's context window usage. null if no active session. */
  activeContext: FloatContext | null;
  pausedUntil: number | null;
  codexAccounts: { accountId: string; label: string; isCurrent: boolean }[];
  /**
   * Token / value / cache-hit aggregates per period (today, 7d, 30d) so the
   * floater can show the same headline numbers the dashboard does, with a
   * client-side period switcher. Combined across Claude + Codex (tool 'all')
   * via the dashboard's `buildRecapCard`, so the numbers line up exactly.
   */
  periodMetrics: FloatPeriodMetric[];
}

export interface FloatPeriodMetric {
  period: RecapPeriod;
  /**
   * Which agent this row covers: 'all' (combined), 'claude-code', or 'codex'.
   * The floater picks the row matching the agent toggle so the headline
   * numbers follow the Claude/Codex/both selection.
   */
  tool: 'all' | 'claude-code' | 'codex';
  /** Total tokens across metered tools in the window. */
  tokens: number;
  /** Count of observed user prompts in the window. */
  promptCount: number;
  /** Claude + Codex API-equivalent USD ("value") in the window. */
  valueUsd: number;
  /** cache_read / (input + cache_creation + cache_read), 0–100 integer. */
  cacheHitPct: number;
}

export interface FloatSessionStats {
  agent: string;
  todaySessions: number;
  totalSessions: number;
}

export interface FloatRecentSession {
  id: string;
  tool: string;
  project: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  tokens: number | null;
}

export interface FloatProjectStats {
  project: string;
  sessions: number;
  durationMs: number;
  tokens: number | null;
  tools: { tool: string; count: number }[];
}

export interface FloatLiveSession {
  id: string;
  tool: string;
  project: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
}

export interface FloatAgentLive {
  agent: 'codex' | 'claude-code';
  state: 'active' | 'recent' | 'idle';
  quotaLevel: 'ok' | 'warning' | 'critical' | 'unknown';
  activeSession: FloatLiveSession | null;
  recentSession: FloatLiveSession | null;
}

function predictPace(
  db: ReturnType<typeof getDb>,
  source: 'statusline' | 'codex',
  accountId: string | null,
  latest: UsageSnapshotRecord,
): { pace5hExhaustMin: number | null; pace5hPctPerMin: number | null } {
  if (latest.window_5h_used_pct == null) {
    return { pace5hExhaustMin: null, pace5hPctPerMin: null };
  }
  const windowMs = 30 * 60_000;
  const minAgo = latest.captured_at - windowMs;
  // Earliest snapshot in last 30 min with non-null 5h pct, same reset window (so we don't span resets)
  const row = accountId != null
    ? db.prepare(`
        SELECT captured_at, window_5h_used_pct, reset_at_5h
        FROM usage_snapshots
        WHERE source = ? AND account_id = ?
          AND captured_at >= ?
          AND captured_at < ?
          AND window_5h_used_pct IS NOT NULL
          AND reset_at_5h = ?
        ORDER BY captured_at ASC
        LIMIT 1
      `).get(source, accountId, minAgo, latest.captured_at, latest.reset_at_5h)
    : db.prepare(`
        SELECT captured_at, window_5h_used_pct, reset_at_5h
        FROM usage_snapshots
        WHERE source = ?
          AND captured_at >= ?
          AND captured_at < ?
          AND window_5h_used_pct IS NOT NULL
          AND reset_at_5h = ?
        ORDER BY captured_at ASC
        LIMIT 1
      `).get(source, minAgo, latest.captured_at, latest.reset_at_5h);
  if (!row) return { pace5hExhaustMin: null, pace5hPctPerMin: null };
  const earliest = row as { captured_at: number; window_5h_used_pct: number };
  const minutes = (latest.captured_at - earliest.captured_at) / 60_000;
  if (minutes < 2) return { pace5hExhaustMin: null, pace5hPctPerMin: null };
  const slope = (latest.window_5h_used_pct - earliest.window_5h_used_pct) / minutes;
  if (slope <= 0) return { pace5hExhaustMin: null, pace5hPctPerMin: Math.round(slope * 100) / 100 };
  const remaining = 100 - latest.window_5h_used_pct;
  return {
    pace5hExhaustMin: Math.max(0, Math.round(remaining / slope)),
    pace5hPctPerMin: Math.round(slope * 100) / 100,
  };
}

function quotaFromSnapshot(
  agent: FloatQuota['agent'],
  label: string,
  accountLabel: string | null,
  row: UsageSnapshotRecord | null,
  pace: { pace5hExhaustMin: number | null; pace5hPctPerMin: number | null },
): FloatQuota | null {
  if (!row) return null;
  const fiveHour = normalizeQuotaWindow(row.window_5h_used_pct, row.reset_at_5h, FIVE_HOUR_WINDOW_MS, Date.now(), row.captured_at);
  const weekly = normalizeQuotaWindow(row.window_weekly_used_pct, row.reset_at_weekly, WEEKLY_WINDOW_MS, Date.now(), row.captured_at);
  // Once the freshest (5h) reading has gone stale, the whole card is a
  // last-known snapshot — flag it so the UI stops projecting a live countdown.
  const stale = fiveHour.stale || weekly.stale;
  return {
    agent,
    label,
    accountLabel,
    remaining5h: fiveHour.remaining,
    used5h: fiveHour.used,
    remainingWeekly: weekly.remaining,
    usedWeekly: weekly.used,
    resetAt5h: fiveHour.resetAt,
    resetAtWeekly: weekly.resetAt,
    capturedAt: row.captured_at,
    stale,
    pace5hExhaustMin: fiveHour.rolledOver || stale ? null : pace.pace5hExhaustMin,
    pace5hPctPerMin: fiveHour.rolledOver || stale ? null : pace.pace5hPctPerMin,
  };
}

function quotaPressure(quota: FloatQuota): number {
  const candidates = [quota.remaining5h, quota.remainingWeekly].filter((value): value is number => value != null);
  if (candidates.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...candidates);
}

function projectName(cwd: string | null): string {
  return cwd?.split('/').filter(Boolean).pop() ?? 'unknown';
}

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

/** Resolve the active Claude Code session id from ~/.claude/sessions/*.json (most recent). */
function findActiveClaudeSessionId(): { sessionId: string; mtimeMs: number } | null {
  let files: string[];
  try { files = fs.readdirSync(CLAUDE_SESSIONS_DIR); } catch { return null; }
  let best: { sessionId: string; mtimeMs: number } | null = null;
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(CLAUDE_SESSIONS_DIR, f);
    try {
      const stat = fs.statSync(full);
      const raw = fs.readFileSync(full, 'utf8');
      const data = JSON.parse(raw) as { sessionId?: string };
      if (data.sessionId && (best == null || stat.mtimeMs > best.mtimeMs)) {
        best = { sessionId: data.sessionId, mtimeMs: stat.mtimeMs };
      }
    } catch { /* skip */ }
  }
  return best;
}

function findJsonlForSession(sessionId: string): string | null {
  let projects: string[];
  try { projects = fs.readdirSync(CLAUDE_PROJECTS_DIR); } catch { return null; }
  for (const dir of projects) {
    const candidate = path.join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// 把 context 占比 + 模型倍率合成一句可执行建议。context 膨胀优先（越满越该清/分流），
// context 还健康但在用 Opus 时给倍率提示。short 给浮窗窄 label 用，full 是完整文案。
function buildContextAdvice(
  pct: number,
  model: string | null,
): Pick<FloatContext, "advice" | "adviceShort" | "adviceLevel"> {
  const isOpus = !!model && /opus/i.test(model);
  if (pct >= 88) {
    return {
      advice: `上下文 ${pct}%，该 /clear 重开${isOpus ? "（还在用 Opus，倍率高）" : ""}`,
      adviceShort: "该清",
      adviceLevel: "critical",
    };
  }
  if (pct >= 75) {
    return {
      advice: `上下文 ${pct}%，独立任务宜开新窗口或丢给 subagent`,
      adviceShort: "宜分流",
      adviceLevel: "high",
    };
  }
  if (pct >= 60) {
    return { advice: `上下文 ${pct}%，渐满，留意`, adviceShort: "渐满", adviceLevel: "watch" };
  }
  if (isOpus) {
    return {
      advice: "正在用 Opus，倍率高，简单活可切 Sonnet 省额度",
      adviceShort: "⚡Opus",
      adviceLevel: "watch",
    };
  }
  return { advice: null, adviceShort: null, adviceLevel: null };
}

function getActiveContext(): FloatContext | null {
  const active = findActiveClaudeSessionId();
  if (!active) return null;
  const jsonl = findJsonlForSession(active.sessionId);
  if (!jsonl) return null;
  const live = readLiveContext(jsonl);
  if (!live) return null;
  const pct = Math.min(100, Math.round((live.tokens / CLAUDE_CONTEXT_LIMIT) * 100));
  return {
    sessionId: live.sessionId,
    project: projectName(live.cwd),
    tokens: live.tokens,
    limit: CLAUDE_CONTEXT_LIMIT,
    pct,
    capturedAt: live.capturedAt,
    warning: pct >= 80,
    model: live.model,
    ...buildContextAdvice(pct, live.model),
  };
}

function quotaLevel(quota: FloatQuota | null): FloatAgentLive['quotaLevel'] {
  if (!quota) return 'unknown';
  const values = [quota.remaining5h, quota.remainingWeekly].filter((value): value is number => value != null);
  if (values.length === 0) return 'unknown';
  const remaining = Math.min(...values);
  if (remaining < 20) return 'critical';
  if (remaining < 45) return 'warning';
  return 'ok';
}

function toLiveSession(row: {
  id: string;
  tool: string;
  cwd: string | null;
  ai_title: string | null;
  summary: string | null;
  started_at: number;
  ended_at: number | null;
}): FloatLiveSession {
  const end = row.ended_at ?? Date.now();
  return {
    id: row.id,
    tool: row.tool,
    project: projectName(row.cwd),
    title: row.ai_title ?? row.summary,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: Math.max(0, end - row.started_at),
  };
}

function sessionTokenTotal(row: {
  tokens_used?: number | null;
  input_tokens?: number | null;
  cache_creation_tokens?: number | null;
  cache_read_tokens?: number | null;
  output_tokens?: number | null;
}): number | null {
  if (row.tokens_used != null) return row.tokens_used;
  const total = (row.input_tokens ?? 0)
    + (row.cache_creation_tokens ?? 0)
    + (row.cache_read_tokens ?? 0)
    + (row.output_tokens ?? 0);
  return total > 0 ? total : null;
}

function getRecentSessions(db: ReturnType<typeof getDb>): FloatRecentSession[] {
  const now = Date.now();
  const rows = db.prepare(`
    SELECT id, tool, cwd, ai_title, summary, started_at, ended_at,
           tokens_used, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens
    FROM sessions
    ORDER BY COALESCE(ended_at, last_turn_at, started_at) DESC, started_at DESC
    LIMIT 6
  `).all() as {
    id: string;
    tool: string;
    cwd: string | null;
    ai_title: string | null;
    summary: string | null;
    started_at: number;
    ended_at: number | null;
    tokens_used: number | null;
    input_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    output_tokens: number | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    tool: row.tool,
    project: projectName(row.cwd),
    title: row.ai_title ?? row.summary,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: Math.max(0, (row.ended_at ?? now) - row.started_at),
    tokens: sessionTokenTotal(row),
  }));
}

function getProjectStats(db: ReturnType<typeof getDb>): FloatProjectStats[] {
  const now = Date.now();
  const since = now - 7 * 86_400_000;
  const rows = db.prepare(`
    SELECT tool, cwd, started_at, ended_at,
           tokens_used, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens
    FROM sessions
    WHERE started_at >= ?
    ORDER BY started_at DESC
    LIMIT 800
  `).all(since) as {
    tool: string;
    cwd: string | null;
    started_at: number;
    ended_at: number | null;
    tokens_used: number | null;
    input_tokens: number | null;
    cache_creation_tokens: number | null;
    cache_read_tokens: number | null;
    output_tokens: number | null;
  }[];

  const byProject = new Map<string, {
    project: string;
    sessions: number;
    durationMs: number;
    tokens: number;
    hasTokens: boolean;
    tools: Map<string, number>;
  }>();

  for (const row of rows) {
    const project = projectName(row.cwd);
    const current = byProject.get(project) ?? {
      project,
      sessions: 0,
      durationMs: 0,
      tokens: 0,
      hasTokens: false,
      tools: new Map<string, number>(),
    };
    current.sessions += 1;
    current.durationMs += Math.max(0, (row.ended_at ?? now) - row.started_at);
    const tokens = sessionTokenTotal(row);
    if (tokens != null) {
      current.tokens += tokens;
      current.hasTokens = true;
    }
    current.tools.set(row.tool, (current.tools.get(row.tool) ?? 0) + 1);
    byProject.set(project, current);
  }

  return [...byProject.values()]
    .sort((a, b) => b.sessions - a.sessions || b.durationMs - a.durationMs)
    .slice(0, 4)
    .map((row) => ({
      project: row.project,
      sessions: row.sessions,
      durationMs: row.durationMs,
      tokens: row.hasTokens ? row.tokens : null,
      tools: [...row.tools.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([tool, count]) => ({ tool, count })),
    }));
}

function getAgentLive(
  db: ReturnType<typeof getDb>,
  agent: FloatAgentLive['agent'],
  quota: FloatQuota | null,
): FloatAgentLive {
  const now = Date.now();
  const activeCutoff = now - 24 * 3_600_000;
  const codexRecentCutoff = now - 10 * 60_000;

  const active = db.prepare(`
    SELECT id, tool, cwd, ai_title, summary, started_at, ended_at
    FROM sessions
    WHERE tool = ?
      AND started_at > ?
      AND (
        ended_at IS NULL
        OR (? = 'codex' AND ended_at > ?)
      )
    ORDER BY COALESCE(ended_at, ?) DESC, started_at DESC
    LIMIT 1
  `).get(agent, activeCutoff, agent, codexRecentCutoff, now) as Parameters<typeof toLiveSession>[0] | undefined;

  const recent = db.prepare(`
    SELECT id, tool, cwd, ai_title, summary, started_at, ended_at
    FROM sessions
    WHERE tool = ?
      AND ended_at IS NOT NULL
    ORDER BY ended_at DESC
    LIMIT 1
  `).get(agent) as Parameters<typeof toLiveSession>[0] | undefined;

  const activeSession = active ? toLiveSession(active) : null;
  const recentSession = recent ? toLiveSession(recent) : null;
  return {
    agent,
    state: activeSession ? 'active' : recentSession && recentSession.endedAt && recentSession.endedAt > now - 5 * 60_000 ? 'recent' : 'idle',
    quotaLevel: quotaLevel(quota),
    activeSession,
    recentSession,
  };
}

export async function getFloatStats(): Promise<FloatStats> {
  const db = getDb();
  const codexAccounts = await getCodexAccounts();
  const currentCodex = codexAccounts.find((account) => account.isCurrent) ?? null;
  const codexRow = currentCodex
    ? getLatestUsageSnapshot(db, 'codex', currentCodex.accountId)
    : getLatestUsageSnapshot(db, 'codex');
  // Use the latest snapshot that actually has quota (5h/weekly) — a proxy
  // session has none, but the account quota from the last direct reading still
  // applies. Falls back to null (ring hidden) only if there's never been one.
  const claudeRow = getLatestQuotaSnapshot(db, 'statusline');

  const codexPace = codexRow ? predictPace(db, 'codex', currentCodex?.accountId ?? null, codexRow) : { pace5hExhaustMin: null, pace5hPctPerMin: null };
  const claudePace = claudeRow ? predictPace(db, 'statusline', null, claudeRow) : { pace5hExhaustMin: null, pace5hPctPerMin: null };

  const quotas = [
    quotaFromSnapshot('codex', 'Codex', currentCodex?.label ?? null, codexRow, codexPace),
    quotaFromSnapshot('claude-code', 'Claude', null, claudeRow, claudePace),
  ].filter((quota): quota is FloatQuota => quota != null);

  const primary = quotas.length > 0
    ? [...quotas].sort((a, b) => quotaPressure(a) - quotaPressure(b))[0]
    : null;
  const codexQuota = quotas.find((quota) => quota.agent === 'codex') ?? null;
  const claudeQuota = quotas.find((quota) => quota.agent === 'claude-code') ?? null;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayStart = dayStart.getTime();
  const todayEnd = todayStart + 86_400_000;

  const totalSessions = (db.prepare(`SELECT COUNT(*) AS count FROM sessions`).get() as { count: number }).count;
  const totalByTool = db.prepare(`
    SELECT tool, COUNT(*) AS count
    FROM sessions
    GROUP BY tool
    ORDER BY count DESC
  `).all() as { tool: string; count: number }[];
  const todaySessions = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM sessions
    WHERE started_at < ?
      AND COALESCE(ended_at, ?) >= ?
  `).get(todayEnd, Date.now(), todayStart) as { count: number }).count;
  const todayByTool = db.prepare(`
    SELECT tool, COUNT(*) AS count
    FROM sessions
    WHERE started_at < ?
      AND COALESCE(ended_at, ?) >= ?
    GROUP BY tool
    ORDER BY count DESC
  `).all(todayEnd, Date.now(), todayStart) as { tool: string; count: number }[];
  const totalByToolMap = new Map(totalByTool.map((row) => [row.tool, row.count]));
  const todayByToolMap = new Map(todayByTool.map((row) => [row.tool, row.count]));
  const sessionStatAgents = [...new Set(['claude-code', 'codex', ...totalByTool.map((row) => row.tool), ...todayByTool.map((row) => row.tool)])];
  const sessionStatsByAgent = sessionStatAgents.map((agent) => ({
    agent,
    todaySessions: todayByToolMap.get(agent) ?? 0,
    totalSessions: totalByToolMap.get(agent) ?? 0,
  }));
  const lastSession = db.prepare(`
    SELECT id, tool, cwd, ai_title, summary, started_at
    FROM sessions
    ORDER BY started_at DESC
    LIMIT 1
  `).get() as { id: string; tool: string; cwd: string | null; ai_title: string | null; summary: string | null; started_at: number } | undefined;

  const recapSettings = readRecapSettings();
  // Emit one row per (period × agent scope) so the floater can show numbers
  // for whichever agent the toggle is on ('all' when showing both).
  const metricTools: FloatPeriodMetric['tool'][] = ['all', 'claude-code', 'codex'];
  const periodMetrics: FloatPeriodMetric[] = FLOAT_METRIC_PERIODS.flatMap((period) =>
    metricTools.map((tool) => {
      const card = buildRecapCard({ period, tool, settings: recapSettings });
      return {
        period,
        tool,
        tokens: card.totalTokens.total,
        promptCount: card.promptCount,
        valueUsd: Math.round(card.valueAtApiRatesUsd * 100) / 100,
        cacheHitPct: card.cacheHitRatePct,
      };
    }),
  );

  const pausedUntilPath = path.join(dataDir(), 'pause-until');
  let pausedUntil: number | null = null;
  try {
    const raw = fs.readFileSync(pausedUntilPath, 'utf8').trim();
    const n = Number(raw);
    if (Number.isFinite(n) && n > Date.now()) pausedUntil = n;
  } catch { /* not paused */ }

  return {
    generatedAt: Date.now(),
    primary,
    quotas,
    waiting: readWaitingSessions(),
    liveByAgent: [
      getAgentLive(db, 'claude-code', claudeQuota),
      getAgentLive(db, 'codex', codexQuota),
    ],
    recentSessions: getRecentSessions(db),
    projectStats: getProjectStats(db),
    todaySessions,
    totalSessions,
    sessionStatsByAgent,
    todayByTool,
    lastSession: lastSession ? {
      id: lastSession.id,
      tool: lastSession.tool,
      project: lastSession.cwd?.split('/').filter(Boolean).pop() ?? 'unknown',
      cwd: lastSession.cwd,
      title: lastSession.ai_title ?? lastSession.summary,
      startedAt: lastSession.started_at,
      transcriptPath: lastSession.tool === 'claude-code' && lastSession.cwd
        ? path.join(process.env.HOME ?? '', '.claude', 'projects', lastSession.cwd.replace(/\//g, '-'), `${lastSession.id}.jsonl`)
        : null,
    } : null,
    pausedUntil,
    activeContext: getActiveContext(),
    codexAccounts: codexAccounts.map((a) => ({ accountId: a.accountId, label: a.label, isCurrent: a.isCurrent })),
    periodMetrics,
  };
}

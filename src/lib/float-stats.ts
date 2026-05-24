import { getCodexAccounts } from './codex-auth';
import { getDb } from './db';
import { getLatestUsageSnapshot, type UsageSnapshotRecord } from './usage-snapshots';

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
}

export interface FloatStats {
  generatedAt: number;
  primary: FloatQuota | null;
  quotas: FloatQuota[];
  liveByAgent: FloatAgentLive[];
  todaySessions: number;
  totalSessions: number;
  todayByTool: { tool: string; count: number }[];
  lastSession: {
    tool: string;
    project: string;
    title: string | null;
    startedAt: number;
  } | null;
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

function quotaFromSnapshot(
  agent: FloatQuota['agent'],
  label: string,
  accountLabel: string | null,
  row: UsageSnapshotRecord | null,
): FloatQuota | null {
  if (!row) return null;
  const used5h = row.window_5h_used_pct;
  const usedWeekly = row.window_weekly_used_pct;
  return {
    agent,
    label,
    accountLabel,
    remaining5h: used5h == null ? null : Math.max(0, 100 - used5h),
    used5h,
    remainingWeekly: usedWeekly == null ? null : Math.max(0, 100 - usedWeekly),
    usedWeekly,
    resetAt5h: row.reset_at_5h,
    resetAtWeekly: row.reset_at_weekly,
    capturedAt: row.captured_at,
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
  const claudeRow = getLatestUsageSnapshot(db, 'statusline');

  const quotas = [
    quotaFromSnapshot('codex', 'Codex', currentCodex?.label ?? null, codexRow),
    quotaFromSnapshot('claude-code', 'Claude', null, claudeRow),
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
  const lastSession = db.prepare(`
    SELECT tool, cwd, ai_title, summary, started_at
    FROM sessions
    ORDER BY started_at DESC
    LIMIT 1
  `).get() as { tool: string; cwd: string | null; ai_title: string | null; summary: string | null; started_at: number } | undefined;

  return {
    generatedAt: Date.now(),
    primary,
    quotas,
    liveByAgent: [
      getAgentLive(db, 'claude-code', claudeQuota),
      getAgentLive(db, 'codex', codexQuota),
    ],
    todaySessions,
    totalSessions,
    todayByTool,
    lastSession: lastSession ? {
      tool: lastSession.tool,
      project: lastSession.cwd?.split('/').filter(Boolean).pop() ?? 'unknown',
      title: lastSession.ai_title ?? lastSession.summary,
      startedAt: lastSession.started_at,
    } : null,
  };
}

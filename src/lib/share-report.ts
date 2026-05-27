import { getDb } from './db';
import { getFloatStats } from './float-stats';
import { decideQuotaGuard, type GuardDecision } from './quota-guard';
import { activityStreak, cacheStats, sessionInsight, spendingStats } from './stats';

const CLAUDE_MAX_MONTHLY_USD = 200;
const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;
const CLAUDE_MAX_WEEKLY_USD = (CLAUDE_MAX_MONTHLY_USD * MONTHS_PER_YEAR) / WEEKS_PER_YEAR;

export interface ShareReportProject {
  project: string;
  sessions: number;
  totalMs: number;
}

export interface ShareReport {
  generatedAt: number;
  guard: GuardDecision;
  todaySessions: number;
  totalSessions: number;
  currentStreak: number;
  claudeTotalUsd: number;
  codexTotalTokens: number;
  shareCard: ShareCardStats;
  topProjects: ShareReportProject[];
  markdown: string;
}

export interface ShareCardStats {
  eyebrow: string;
  weekLabel: string;
  multiplier: number;
  apiEquivalentUsd: number;
  planWeeklyUsd: number;
  planLabel: string;
  totalTokens: number;
  cacheHitPct: number;
  topProject: string;
}

function projectName(cwd: string | null): string {
  return cwd?.split('/').filter(Boolean).pop() ?? 'unknown';
}

function topProjects(limit = 5, since?: number): ShareReportProject[] {
  const rows = getDb().prepare(`
    SELECT cwd,
           COUNT(*) AS sessions,
           SUM(COALESCE(ended_at, started_at) - started_at) AS total_ms
    FROM sessions
    WHERE cwd IS NOT NULL
      ${since == null ? '' : 'AND started_at >= ?'}
    GROUP BY cwd
    ORDER BY total_ms DESC
    LIMIT ?
  `).all(...(since == null ? [limit] : [since, limit])) as { cwd: string | null; sessions: number; total_ms: number | null }[];

  return rows.map((row) => ({
    project: projectName(row.cwd),
    sessions: row.sessions,
    totalMs: row.total_ms ?? 0,
  }));
}

function pct(value: number | null): string {
  return value == null ? '--' : `${Math.max(0, Math.round(value))}%`;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000_000) return `${Math.round(value / 100_000_000) / 10}B`;
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(Math.round(value));
}

function duration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  if (hours <= 0) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function weekWindow(): { start: number; end: number; label: string } {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  const month = startDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const endMonth = endDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  const label = month === endMonth
    ? `WEEK OF ${month} ${startDay}–${endDay}`
    : `WEEK OF ${month} ${startDay}–${endMonth} ${endDay}`;
  return { start: startDate.getTime(), end: endDate.getTime(), label };
}

function claudeApiEquivalentUsdSince(since: number): number {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(session_max), 0) AS total
    FROM (
      SELECT MAX(CAST(json_extract(raw_output, '$.cost.total_cost_usd') AS REAL)) AS session_max
      FROM usage_snapshots
      WHERE source = 'statusline'
        AND captured_at >= ?
        AND json_extract(raw_output, '$.cost.total_cost_usd') IS NOT NULL
      GROUP BY json_extract(raw_output, '$.session_id')
    )
  `).get(since) as { total: number };
  return row.total ?? 0;
}

function buildShareCardStats(): ShareCardStats {
  const window = weekWindow();
  const cache = cacheStats(7);
  const apiEquivalentUsd = claudeApiEquivalentUsdSince(window.start);
  const multiplier = Math.max(0, Math.floor(apiEquivalentUsd / CLAUDE_MAX_WEEKLY_USD));
  const totalTokens = cache.totalInput + cache.totalCacheCreation + cache.totalCacheRead + cache.totalOutput;
  const fallbackProject = topProjects(1, window.start)[0]?.project ?? 'unknown';
  return {
    eyebrow: 'RETURN ON MY CLAUDE CODE WEEK',
    weekLabel: window.label,
    multiplier,
    apiEquivalentUsd,
    planWeeklyUsd: CLAUDE_MAX_WEEKLY_USD,
    planLabel: 'Max plan',
    totalTokens,
    cacheHitPct: cache.hitRatePct,
    topProject: cache.topProjects[0]?.project ?? fallbackProject,
  };
}

function guardPrefix(status: GuardDecision['status']): string {
  switch (status) {
    case 'safe': return 'OK';
    case 'watch': return 'WATCH';
    case 'risky': return 'RISKY';
    case 'wait': return 'WAIT';
    default: return 'UNKNOWN';
  }
}

function buildMarkdown(report: Omit<ShareReport, 'markdown'>): string {
  const lines = [
    '# Vibemeter report',
    '',
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    '',
    `## Quota guard: ${guardPrefix(report.guard.status)} - ${report.guard.headline}`,
    report.guard.detail,
    '',
  ];

  if (report.guard.quotas.length > 0) {
    for (const quota of report.guard.quotas) {
      const label = quota.accountLabel ? `${quota.label} (${quota.accountLabel})` : quota.label;
      const pace = quota.pace5hExhaustMin == null ? '' : `, pace exhausts 5h in ~${quota.pace5hExhaustMin}m`;
      lines.push(`- ${label}: 5h ${pct(quota.remaining5h)} left, weekly ${pct(quota.remainingWeekly)} left${pace}`);
    }
  } else {
    lines.push('- No quota snapshot yet');
  }

  lines.push(
    '',
    '## Activity',
    `- Today: ${report.todaySessions} sessions`,
    `- Total: ${report.totalSessions} sessions`,
    `- Current streak: ${report.currentStreak} days`,
    '',
    '## Spend / tokens',
    `- Claude API-equivalent: $${report.claudeTotalUsd.toFixed(2)}`,
    `- Codex tokens: ${compactNumber(report.codexTotalTokens)}`,
    '',
    '## Share card',
    `- ${report.shareCard.multiplier}x return this week: $${report.shareCard.apiEquivalentUsd.toFixed(2)} at API rates / $${report.shareCard.planWeeklyUsd.toFixed(0)}/wk ${report.shareCard.planLabel}`,
    `- ${compactNumber(report.shareCard.totalTokens)} Claude Code tokens, ${report.shareCard.cacheHitPct}% served from cache`,
  );

  if (report.topProjects.length > 0) {
    lines.push('', '## Top projects');
    for (const project of report.topProjects) {
      lines.push(`- ${project.project}: ${duration(project.totalMs)} across ${project.sessions} sessions`);
    }
  }

  lines.push('', '_Generated locally by Vibemeter. No data was uploaded._');
  return lines.join('\n');
}

export async function buildShareReport(): Promise<ShareReport> {
  const stats = await getFloatStats();
  const spend = spendingStats();
  const streak = activityStreak();
  // Touch sessionInsight so the report stays aligned with the dashboard's value
  // calculation path; top expensive details are intentionally not included.
  sessionInsight();

  const base: Omit<ShareReport, 'markdown'> = {
    generatedAt: Date.now(),
    guard: decideQuotaGuard(stats),
    todaySessions: stats.todaySessions,
    totalSessions: stats.totalSessions,
    currentStreak: streak.current,
    claudeTotalUsd: spend.claudeTotalUsd,
    codexTotalTokens: spend.codexTotalTokens,
    shareCard: buildShareCardStats(),
    topProjects: topProjects(5),
  };

  return { ...base, markdown: buildMarkdown(base) };
}

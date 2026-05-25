import { getDb } from './db';
import { getFloatStats } from './float-stats';
import { decideQuotaGuard, type GuardDecision } from './quota-guard';
import { activityStreak, sessionInsight, spendingStats } from './stats';

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
  topProjects: ShareReportProject[];
  markdown: string;
}

function projectName(cwd: string | null): string {
  return cwd?.split('/').filter(Boolean).pop() ?? 'unknown';
}

function topProjects(limit = 5): ShareReportProject[] {
  const rows = getDb().prepare(`
    SELECT cwd,
           COUNT(*) AS sessions,
           SUM(COALESCE(ended_at, started_at) - started_at) AS total_ms
    FROM sessions
    WHERE cwd IS NOT NULL
    GROUP BY cwd
    ORDER BY total_ms DESC
    LIMIT ?
  `).all(limit) as { cwd: string | null; sessions: number; total_ms: number | null }[];

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
    topProjects: topProjects(5),
  };

  return { ...base, markdown: buildMarkdown(base) };
}


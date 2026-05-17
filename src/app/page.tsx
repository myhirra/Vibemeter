export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { importSessions } from '@/lib/collectors/session-importer';
import { Dashboard } from '@/components/Dashboard';
import { activityStreak, burndownPoints, fileHotspots, spendingStats, dayTimeline, achievements } from '@/lib/stats';
import type { SessionRow, UsageSnapshotRow } from '@/lib/schema';

export default function DashboardPage() {
  importSessions();
  const db = getDb();

  const sessions = db.prepare(`
    SELECT id, tool, started_at, ended_at, cwd, confidence, summary, ai_title, tags
    FROM sessions
    ORDER BY started_at DESC
  `).all() as Pick<SessionRow, 'id' | 'tool' | 'started_at' | 'ended_at' | 'cwd' | 'confidence' | 'summary' | 'ai_title' | 'tags'>[];

  type UsageRow = Pick<UsageSnapshotRow, 'window_5h_used_pct' | 'window_weekly_used_pct' | 'reset_at_5h' | 'reset_at_weekly'>;
  const usageBySource = (source: string) => db.prepare(`
    SELECT window_5h_used_pct, window_weekly_used_pct, reset_at_5h, reset_at_weekly
    FROM usage_snapshots WHERE source = ? ORDER BY captured_at DESC LIMIT 1
  `).get(source) as UsageRow | undefined;

  const toUsageInfo = (row: UsageRow | undefined) => row ? {
    window_5h_used_pct: row.window_5h_used_pct,
    window_weekly_used_pct: row.window_weekly_used_pct,
    reset_at_5h: row.reset_at_5h,
    reset_at_weekly: row.reset_at_weekly,
  } : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            <span className="text-violet-400">Vibe</span>meter
          </h1>
          <p className="text-zinc-600 text-xs mt-1">measure your AI coding vibe · local-first · data never leaves this machine</p>
        </div>

        <Dashboard
          sessions={sessions}
          streak={activityStreak()}
          claudeBurndown={burndownPoints(168, 'statusline')}
          codexBurndown={burndownPoints(168, 'codex')}
          hotspots={fileHotspots(8)}
          spending={spendingStats()}
          timeline={dayTimeline(0)}
          achievements={achievements()}
          claudeUsage={toUsageInfo(usageBySource('statusline'))}
          codexUsage={toUsageInfo(usageBySource('codex'))}
        />
      </div>
    </div>
  );
}

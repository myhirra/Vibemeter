export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { importSessions } from '@/lib/collectors/session-importer';
import type { SessionRow, UsageSnapshotRow } from '@/lib/schema';

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatResetAt(ms: number | null): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return 'resetting…';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

function cwdBasename(cwd: string | null): string {
  if (!cwd) return '—';
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

function duration(startMs: number, endMs: number | null): string {
  if (!endMs) return 'active';
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function DashboardPage() {
  // Pull latest data on every page load
  importSessions();

  const db = getDb();

  const sessions = db
    .prepare(
      `SELECT id, tool, started_at, ended_at, cwd, confidence
       FROM sessions
       ORDER BY started_at DESC
       LIMIT 20`
    )
    .all() as Pick<SessionRow, 'id' | 'tool' | 'started_at' | 'ended_at' | 'cwd' | 'confidence'>[];

  const latestUsage = db
    .prepare(
      `SELECT window_5h_used_pct, window_weekly_used_pct, reset_at_5h, reset_at_weekly, captured_at
       FROM usage_snapshots
       ORDER BY captured_at DESC
       LIMIT 1`
    )
    .get() as Pick<UsageSnapshotRow, 'window_5h_used_pct' | 'window_weekly_used_pct' | 'reset_at_5h' | 'reset_at_weekly' | 'captured_at'> | undefined;

  const activeSessions = sessions.filter((s) => !s.ended_at).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            AI Coding Continuity Console
          </h1>
          <p className="text-zinc-500 text-sm mt-1">local-first · v1 · data never leaves this machine</p>
        </div>

        {/* Usage cards */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {/* 5h window */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">5h window</p>
            {latestUsage?.window_5h_used_pct != null ? (
              <>
                <p className="text-3xl font-bold text-zinc-100">
                  {(100 - latestUsage.window_5h_used_pct).toFixed(0)}%
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  remaining · {latestUsage.window_5h_used_pct.toFixed(0)}% used
                </p>
                {latestUsage.reset_at_5h && (
                  <p className="text-xs text-zinc-600 mt-1">
                    {formatResetAt(latestUsage.reset_at_5h)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-zinc-600 text-sm mt-1">no data yet</p>
            )}
          </div>
          {/* 7-day window */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">7-day budget</p>
            {latestUsage?.window_weekly_used_pct != null ? (
              <>
                <p className="text-3xl font-bold text-zinc-100">
                  {(100 - latestUsage.window_weekly_used_pct).toFixed(0)}%
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  remaining · {latestUsage.window_weekly_used_pct.toFixed(0)}% used
                </p>
                {latestUsage.reset_at_weekly && (
                  <p className="text-xs text-zinc-600 mt-1">
                    {formatResetAt(latestUsage.reset_at_weekly)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-zinc-600 text-sm mt-1">no data yet</p>
            )}
          </div>
        </div>

        {/* Sessions table */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-300">Recent Sessions</h2>
            <span className="text-xs text-zinc-500">
              {activeSessions} active · {sessions.length} shown
            </span>
          </div>

          {sessions.length === 0 ? (
            <p className="px-5 py-8 text-zinc-600 text-sm text-center">
              No sessions yet. Run <code className="text-zinc-400">npx tsx bin/cc-wrap.ts --version</code> to import.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                  <th className="px-5 py-2 text-left font-normal">started</th>
                  <th className="px-5 py-2 text-left font-normal">project</th>
                  <th className="px-5 py-2 text-left font-normal">duration</th>
                  <th className="px-5 py-2 text-left font-normal">status</th>
                  <th className="px-5 py-2 text-left font-normal">src</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const isActive = !s.ended_at;
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 text-zinc-400 tabular-nums">
                        {formatTime(s.started_at)}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-200">
                        {cwdBasename(s.cwd)}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-400 tabular-nums">
                        {duration(s.started_at, s.ended_at ?? null)}
                      </td>
                      <td className="px-5 py-2.5">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                            active
                          </span>
                        ) : (
                          <span className="text-zinc-600">done</span>
                        )}
                      </td>
                      <td className="px-5 py-2.5 text-zinc-600 text-xs">
                        {s.confidence}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-6 text-xs text-zinc-700 text-center">
          continuation prompt generation · coming Day 2
        </p>
      </div>
    </div>
  );
}

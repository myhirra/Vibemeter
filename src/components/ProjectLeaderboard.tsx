'use client';

import { useMemo } from 'react';
import type { SessionEntry } from './SessionsTable';

interface ProjectRow {
  project: string;
  cwd: string | null;
  sessions: number;
  totalMs: number;
  tools: Record<string, number>;
}

function fmtHours(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}

function cwdBasename(cwd: string | null): string {
  if (!cwd) return '—';
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

const TOOL_DOT: Record<string, string> = {
  'claude-code': 'bg-violet-500',
  codex: 'bg-emerald-500',
  cursor: 'bg-sky-500',
};

export function ProjectLeaderboard({ sessions, limit = 10 }: { sessions: SessionEntry[]; limit?: number }) {
  const rows = useMemo(() => {
    const map = new Map<string, ProjectRow>();
    for (const s of sessions) {
      const project = cwdBasename(s.cwd);
      if (project === '—') continue;
      const ms = (s.ended_at ?? s.started_at) - s.started_at;
      const cur = map.get(project) ?? { project, cwd: s.cwd, sessions: 0, totalMs: 0, tools: {} };
      cur.sessions += 1;
      cur.totalMs += ms;
      cur.tools[s.tool] = (cur.tools[s.tool] ?? 0) + 1;
      map.set(project, cur);
    }
    return [...map.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, limit);
  }, [sessions, limit]);

  const maxMs = Math.max(...rows.map((r) => r.totalMs), 1);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">project leaderboard</p>
        <p className="text-zinc-600 text-sm">no projects yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">project leaderboard</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={r.project} className="group">
            <div className="flex items-center gap-3 text-xs">
              <span className="w-5 text-right text-zinc-600 tabular-nums">{i + 1}</span>
              <span className="flex-1 text-zinc-200 truncate" title={r.cwd ?? r.project}>
                {r.project}
              </span>
              <div className="flex gap-0.5">
                {Object.entries(r.tools).map(([tool, count]) => (
                  <span key={tool} className={`w-1.5 h-1.5 rounded-full ${TOOL_DOT[tool] ?? 'bg-zinc-500'}`} title={`${tool}: ${count}`} />
                ))}
              </div>
              <span className="text-zinc-500 tabular-nums w-12 text-right">{r.sessions}×</span>
              <span className="text-zinc-400 tabular-nums w-14 text-right">{fmtHours(r.totalMs)}</span>
            </div>
            <div className="flex gap-px h-1 mt-0.5 ml-8">
              <div className="bg-violet-500/30 rounded-sm" style={{ width: `${(r.totalMs / maxMs) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

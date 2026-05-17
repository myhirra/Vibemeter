'use client';

import { useState, useMemo } from 'react';
import { SessionsTable } from './SessionsTable';
import { ToolSplitCard } from './ToolSplitCard';
import { BurndownChart } from './BurndownChart';
import { FileHotspots } from './FileHotspots';
import { SpendingCard } from './SpendingCard';
import { ActivityCard } from './ActivityCard';
import { ProjectLeaderboard } from './ProjectLeaderboard';
import { AchievementsCard } from './AchievementsCard';
import type { SessionEntry } from './SessionsTable';
import type { StreakInfo, BurndownPoint, FileHotspot, SpendingStats, TimelineSession, Achievement } from '@/lib/stats';

export interface UsageInfo {
  window_5h_used_pct: number | null;
  window_weekly_used_pct: number | null;
  reset_at_5h: number | null;
  reset_at_weekly: number | null;
}

interface Props {
  sessions: SessionEntry[];
  streak: StreakInfo;
  claudeBurndown: BurndownPoint[];
  codexBurndown: BurndownPoint[];
  hotspots: FileHotspot[];
  claudeUsage: UsageInfo | null;
  codexUsage: UsageInfo | null;
  spending: SpendingStats;
  timeline: { dateLabel: string; sessions: TimelineSession[] };
  achievements: Achievement[];
}

const TOOLS = ['all', 'claude-code', 'codex', 'cursor'] as const;
type ToolFilter = typeof TOOLS[number];
const TOOL_LABELS: Record<ToolFilter, string> = {
  all: 'All', 'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor',
};

const DATE_PRESETS = ['today', '7d', '30d', 'all'] as const;
type DatePreset = typeof DATE_PRESETS[number];
const DATE_LABELS: Record<DatePreset, string> = {
  today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All time',
};

function startOfPreset(preset: DatePreset): number {
  const now = new Date();
  if (preset === 'today') { now.setHours(0, 0, 0, 0); return now.getTime(); }
  if (preset === '7d') return Date.now() - 7 * 86_400_000;
  if (preset === '30d') return Date.now() - 30 * 86_400_000;
  return 0;
}

function formatResetAt(ms: number | null): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return 'resetting…';
  const d = new Date(ms);
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const isToday = new Date().toDateString() === d.toDateString();
  const dateStr = isToday ? time : `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${time}`;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const rel = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return `resets at ${dateStr} (in ${rel})`;
}

export function Dashboard({ sessions, streak, claudeBurndown, codexBurndown, hotspots, claudeUsage, codexUsage, spending, timeline, achievements }: Props) {
  const [toolFilter, setToolFilter] = useState<ToolFilter>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');

  const since = useMemo(() => startOfPreset(datePreset), [datePreset]);

  const toolCounts = useMemo(() => {
    const src = since > 0 ? sessions.filter((s) => s.started_at >= since) : sessions;
    const counts: Record<string, number> = { all: src.length };
    for (const s of src) counts[s.tool] = (counts[s.tool] ?? 0) + 1;
    return counts;
  }, [sessions, since]);

  const filteredSessions = useMemo(() => {
    let s = toolFilter === 'all' ? sessions : sessions.filter((s) => s.tool === toolFilter);
    if (since > 0) s = s.filter((s) => s.started_at >= since);
    return s;
  }, [sessions, toolFilter, since]);

  const filteredToolSplit = useMemo(() => {
    const byTool = new Map<string, { sessions: number; totalMs: number }>();
    for (const s of filteredSessions) {
      const ms = (s.ended_at ?? s.started_at) - s.started_at;
      const cur = byTool.get(s.tool) ?? { sessions: 0, totalMs: 0 };
      byTool.set(s.tool, { sessions: cur.sessions + 1, totalMs: cur.totalMs + ms });
    }
    const grandMs = Math.max([...byTool.values()].reduce((s, v) => s + v.totalMs, 0), 1);
    return [...byTool.entries()]
      .map(([tool, v]) => ({ tool, sessions: v.sessions, totalMs: v.totalMs, pct: Math.round(v.totalMs / grandMs * 100) }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [filteredSessions]);

  const filteredSpending = useMemo(() => {
    if (since === 0) return spending;
    const sinceDate = new Date(since).toISOString().slice(0, 10);
    return { ...spending, daily: spending.daily.filter((d) => d.date >= sinceDate) };
  }, [spending, since]);

  return (
    <>
      {/* Filters row */}
      <div className="flex items-center justify-between mb-4 gap-6">
        <div className="flex gap-2">
          {TOOLS
            .filter((t) => t === 'all' || (toolCounts[t] ?? 0) > 0)
            .sort((a, b) => {
              if (a === 'all') return -1;
              if (b === 'all') return 1;
              return (toolCounts[b] ?? 0) - (toolCounts[a] ?? 0);
            })
            .map((t) => (
            <button key={t} onClick={() => setToolFilter(t)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                toolFilter === t
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {TOOL_LABELS[t]}
              <span className="ml-1.5 text-zinc-600 tabular-nums">{toolCounts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {DATE_PRESETS.map((p) => (
            <button key={p} onClick={() => setDatePreset(p)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                datePreset === p
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {DATE_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Usage cards — source switches by tool filter */}
      {(() => {
        const usage = toolFilter === 'codex' ? codexUsage
          : toolFilter === 'claude-code' ? claudeUsage
          : (claudeUsage ?? codexUsage);
        const label = toolFilter === 'codex' ? 'codex' : 'claude code';
        return (
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">5h window · {label}</p>
              {usage?.window_5h_used_pct != null ? (
                <>
                  <p className="text-3xl font-bold text-zinc-100">
                    {(100 - usage.window_5h_used_pct).toFixed(0)}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">remaining · {usage.window_5h_used_pct.toFixed(0)}% used</p>
                  {usage.reset_at_5h && <p className="text-xs text-zinc-600 mt-1">{formatResetAt(usage.reset_at_5h)}</p>}
                </>
              ) : <p className="text-zinc-600 text-sm mt-1">no data yet</p>}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">7-day budget · {label}</p>
              {usage?.window_weekly_used_pct != null ? (
                <>
                  <p className="text-3xl font-bold text-zinc-100">
                    {(100 - usage.window_weekly_used_pct).toFixed(0)}%
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">remaining · {usage.window_weekly_used_pct.toFixed(0)}% used</p>
                  {usage.reset_at_weekly && <p className="text-xs text-zinc-600 mt-1">{formatResetAt(usage.reset_at_weekly)}</p>}
                </>
              ) : <p className="text-zinc-600 text-sm mt-1">no data yet</p>}
            </div>
          </div>
        );
      })()}

      {/* Spending + achievements */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <SpendingCard data={filteredSpending} toolFilter={toolFilter} />
        <AchievementsCard data={achievements} />
      </div>

      {/* Activity — pattern (heatmap) / today (timeline) */}
      <div className="mb-4">
        <ActivityCard sessions={filteredSessions} streak={streak} timeline={timeline} />
      </div>

      {/* Burndown chart */}
      <div className="mb-4">
        <BurndownChart
          data={toolFilter === 'codex' ? codexBurndown : claudeBurndown}
          label={toolFilter === 'codex' ? 'codex' : 'claude code'}
        />
      </div>

      {/* Tool split + Project leaderboard */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <ToolSplitCard data={filteredToolSplit} />
        <ProjectLeaderboard sessions={filteredSessions} />
      </div>

      {/* Sessions table */}
      <div className="mb-4">
        <SessionsTable sessions={filteredSessions.slice(0, 40)} />
      </div>

      {/* File hotspots */}
      {hotspots.length > 0 && (
        <FileHotspots data={hotspots} />
      )}
    </>
  );
}

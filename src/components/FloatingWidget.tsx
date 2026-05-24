'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FloatQuota, FloatStats } from '@/lib/float-stats';

function formatReset(ms: number | null) {
  if (!ms) return 'unknown reset';
  const diff = ms - Date.now();
  if (diff <= 0) return 'snapshot expired';
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatAge(ms: number | null) {
  if (!ms) return 'no snapshot';
  const diff = Math.max(0, Date.now() - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function toolLabel(tool: string) {
  if (tool === 'claude-code') return 'Claude';
  if (tool === 'codex') return 'Codex';
  if (tool === 'cursor') return 'Cursor';
  return tool;
}

function quotaColor(quota: FloatQuota | null) {
  const remaining = quota?.remaining5h ?? quota?.remainingWeekly ?? null;
  if (remaining == null) return '#71717a';
  if (remaining < 20) return '#f43f5e';
  if (remaining < 45) return '#f59e0b';
  return '#10b981';
}

export function FloatingWidget({ initialStats }: { initialStats: FloatStats }) {
  const [stats, setStats] = useState(initialStats);
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);

  const primary = stats.primary;
  const remaining = primary?.remaining5h ?? primary?.remainingWeekly ?? null;
  const used = primary?.used5h ?? primary?.usedWeekly ?? 0;
  const color = quotaColor(primary);
  const ring = useMemo(() => {
    const pct = Math.max(0, Math.min(100, used));
    return `conic-gradient(${color} 0 ${100 - pct}%, #27272a ${100 - pct}% 100%)`;
  }, [color, used]);

  async function loadStats() {
    const response = await fetch('/api/float', { cache: 'no-store' });
    if (response.ok) setStats(await response.json());
  }

  async function refresh() {
    setBusy(true);
    try {
      await fetch('/api/import-sessions', { method: 'POST' });
      await loadStats();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    window.resizeTo?.(260, expanded ? 380 : 220);
    const timer = window.setInterval(loadStats, 60_000);
    return () => window.clearInterval(timer);
  }, [expanded]);

  return (
    <main className="min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[280px] flex-col items-center justify-center gap-3 px-4 py-4 font-mono">
        <button
          type="button"
          aria-label="Toggle details"
          onClick={() => setExpanded((value) => !value)}
          className="relative grid size-40 place-items-center rounded-full border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 outline-none transition-transform hover:scale-[1.02]"
          style={{ background: ring }}
        >
          <span className="grid size-[8.75rem] place-items-center rounded-full border border-zinc-800 bg-zinc-950">
            <span className="text-center">
              <span className="block text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                {primary?.label ?? 'Vibemeter'}
              </span>
              <span className="mt-1 block text-4xl font-semibold text-zinc-50">
                {remaining == null ? '--' : `${remaining.toFixed(0)}%`}
              </span>
              <span className="mt-1 block text-[11px] text-zinc-500">
                {primary ? '5h remaining' : 'no quota'}
              </span>
            </span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {busy ? 'Refreshing' : 'Refresh'}
          </button>
          <a
            href="/"
            target="_blank"
            className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            Dashboard
          </a>
        </div>

        {expanded && (
          <section className="w-full rounded-lg border border-zinc-800 bg-zinc-900/90 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-500">
                  {primary?.accountLabel ?? 'current quota'}
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {primary ? `${primary.used5h?.toFixed(0) ?? '--'}% used` : 'No snapshot'}
                </p>
              </div>
              <div className="text-right text-xs text-zinc-500">
                <p>{formatReset(primary?.resetAt5h ?? null)}</p>
                <p className="mt-1">{formatAge(primary?.capturedAt ?? null)}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">today</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{stats.todaySessions}</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">total</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{stats.totalSessions}</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">weekly</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{primary?.remainingWeekly?.toFixed(0) ?? '--'}%</p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {stats.todayByTool.slice(0, 3).map((item) => (
                <div key={item.tool} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{toolLabel(item.tool)}</span>
                  <span className="text-zinc-300">{item.count}</span>
                </div>
              ))}
              {stats.todayByTool.length === 0 && (
                <p className="text-xs text-zinc-600">No sessions today</p>
              )}
            </div>

            {stats.lastSession && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">latest</p>
                <p className="mt-1 truncate text-xs text-zinc-300">
                  {toolLabel(stats.lastSession.tool)} · {stats.lastSession.project}
                </p>
                {stats.lastSession.title && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{stats.lastSession.title}</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

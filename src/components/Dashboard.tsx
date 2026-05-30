'use client';

import { startTransition, useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SessionsTable } from './SessionsTable';
import { ToolSplitCard } from './ToolSplitCard';
import { BurndownChart } from './BurndownChart';
import { FileHotspots } from './FileHotspots';
import { UsageTotalCard } from './UsageTotalCard';
import { ActivityCard } from './ActivityCard';
import { ProjectLeaderboard } from './ProjectLeaderboard';
import { AchievementsCard } from './AchievementsCard';
import { SetupDoctorCard } from './SetupDoctorCard';
import { NowRunwayCard } from './NowRunwayCard';
import type { SessionEntry } from './SessionsTable';
import type { StreakInfo, BurndownPoint, FileHotspot, TimelineSession, Achievement, SessionInsight } from '@/lib/stats';
import type { GuardDecision } from '@/lib/quota-guard';
import type { RecapCardsByScope, RecapToolFilter } from '@/lib/recap-card';
import { useT } from '@/lib/i18n/client';

export interface UsageInfo {
  window_5h_used_pct: number | null;
  window_weekly_used_pct: number | null;
  reset_at_5h: number | null;
  reset_at_weekly: number | null;
}

export interface CodexAccountOption {
  accountId: string;
  label: string;
  email: string | null;
  planType: string | null;
  isCurrent: boolean;
}

interface Props {
  sessions: SessionEntry[];
  streak: StreakInfo;
  allBurndown: BurndownPoint[];
  claudeBurndown: BurndownPoint[];
  codexBurndown: BurndownPoint[];
  hotspots: FileHotspot[];
  claudeUsage: UsageInfo | null;
  codexUsage: UsageInfo | null;
  codexAccounts: CodexAccountOption[];
  selectedCodexAccountId: string | null;
  initialToolFilter: ToolFilter;
  timeline: { dateLabel: string; sessions: TimelineSession[] };
  achievements: Achievement[];
  insight: SessionInsight;
  recapCards: RecapCardsByScope;
  runway: {
    guard: GuardDecision;
    contextPct: number | null;
    weeklyRemaining: number | null;
    window5h: { usedPct: number | null; resetAt: number | null; label?: string | null } | null;
    window5hByAgent?: Record<string, { usedPct: number | null; resetAt: number | null; label?: string | null }>;
    apiMode: { costToday: number; cost7d: number } | null;
  };
  /**
   * When the floater deep-links into the dashboard with `?project=foo`, we
   * pre-filter the sessions table to that cwd basename. Free-form string —
   * sessions whose cwd basename matches case-insensitively are kept.
   */
  initialProjectFilter: string | null;
  /**
   * `?focus=current` from the floater. When true we scroll the NowRunway card
   * into view after mount so the user lands on the conclusion line.
   */
  initialFocusCurrent: boolean;
  /**
   * Redact mode flag. When true the page renders a "redacted — data masked"
   * banner and downstream cards that surface transcript paths render their
   * open buttons disabled. The data itself has already been masked server-
   * side; this prop is for UI affordances only.
   */
  redact: boolean;
}

const TOOLS = ['all', 'claude-code', 'codex', 'cursor'] as const satisfies readonly RecapToolFilter[];
type ToolFilter = RecapToolFilter;
const TOOL_LABEL_KEYS: Record<ToolFilter, string> = {
  all: 'dashboard.toolAll',
  'claude-code': 'dashboard.toolClaude',
  codex: 'dashboard.toolCodex',
  cursor: 'dashboard.toolCursor',
};

const DATE_PRESETS = ['today', '7d', '30d', 'all'] as const;
type DatePreset = typeof DATE_PRESETS[number];
const DATE_LABEL_KEYS: Record<DatePreset, string> = {
  today: 'dashboard.dateToday2',
  '7d': 'dashboard.date7days',
  '30d': 'dashboard.date30days',
  all: 'dashboard.dateAlltime',
};

function isToolFilter(value: string | null): value is ToolFilter {
  return TOOLS.includes(value as ToolFilter);
}

function startOfPreset(preset: DatePreset): number {
  const now = new Date();
  if (preset === 'today') { now.setHours(0, 0, 0, 0); return now.getTime(); }
  if (preset === '7d') return Date.now() - 7 * 86_400_000;
  if (preset === '30d') return Date.now() - 30 * 86_400_000;
  return 0;
}

function formatResetAt(ms: number | null, t: (k: string, v?: Record<string, string | number>) => string): string {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return t('dashboard.resetting');
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const isToday = new Date().toDateString() === d.toDateString();
  const dateStr = isToday ? time : `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${time}`;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const rel = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return t('dashboard.resetsAt', { date: dateStr, rel });
}

function formatRemainingPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped >= 100 ? 100 : Math.floor(clamped)}%`;
}

function formatUsedPercent(value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped <= 0 ? 0 : Math.ceil(clamped)}%`;
}

function shortAccountId(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

export function Dashboard({
  sessions,
  streak,
  allBurndown,
  claudeBurndown,
  codexBurndown,
  hotspots,
  claudeUsage,
  codexUsage,
  codexAccounts,
  selectedCodexAccountId,
  initialToolFilter,
  timeline,
  achievements,
  insight,
  recapCards,
  runway,
  initialProjectFilter,
  initialFocusCurrent,
  redact,
}: Props) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryToolFilter = searchParams.get('agent');
  const resolvedToolFilter = isToolFilter(queryToolFilter) ? queryToolFilter : initialToolFilter;
  const [toolFilter, setToolFilter] = useState<ToolFilter>(resolvedToolFilter);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'done' | 'error'>('idle');
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const runwayRef = useRef<HTMLDivElement | null>(null);

  // Honor `?focus=current` from the floater deep-link: scroll the conclusion
  // line into view once after mount. Only fires once and uses smooth scroll
  // so it doesn't fight a manual scroll the user already initiated.
  useEffect(() => {
    if (!initialFocusCurrent) return;
    const id = window.setTimeout(() => {
      runwayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(id);
  }, [initialFocusCurrent]);

  useEffect(() => {
    startTransition(() => setToolFilter(resolvedToolFilter));
  }, [resolvedToolFilter]);

  const selectedCodexAccount = useMemo(
    () => codexAccounts.find((account) => account.accountId === selectedCodexAccountId) ?? null,
    [codexAccounts, selectedCodexAccountId],
  );
  const selectedCodexLabel = selectedCodexAccount
    ? `${t('dashboard.codexLabelPrefix')} · ${selectedCodexAccount.label}`
    : t('dashboard.codexLabel');
  const selectedCodexEmptyTitle = selectedCodexAccountId
    ? t('dashboard.noSnapshot')
    : t('dashboard.noData');
  const selectedCodexEmptyHint = selectedCodexAccountId
    ? selectedCodexAccount?.isCurrent
      ? t('dashboard.useCodexThenRefresh')
      : t('dashboard.switchAdminThenUse')
    : t('dashboard.noData');

  const since = useMemo(() => startOfPreset(datePreset), [datePreset]);

  const toolCounts = useMemo(() => {
    const src = since > 0 ? sessions.filter((s) => s.started_at >= since) : sessions;
    const counts: Record<string, number> = { all: src.length };
    for (const s of src) counts[s.tool] = (counts[s.tool] ?? 0) + 1;
    return counts;
  }, [sessions, since]);

  // When the floater deep-links with `?project=foo`, pre-filter sessions to
  // those whose cwd basename matches case-insensitively. This is a soft hint:
  // if no session matches we fall back to the unfiltered list so the dashboard
  // is still useful.
  const projectFilter = initialProjectFilter?.toLowerCase() ?? null;
  const filteredSessions = useMemo(() => {
    let s = toolFilter === 'all' ? sessions : sessions.filter((s) => s.tool === toolFilter);
    if (since > 0) s = s.filter((s) => s.started_at >= since);
    if (projectFilter) {
      const matched = s.filter((row) => {
        const base = row.cwd?.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
        return base.includes(projectFilter);
      });
      if (matched.length > 0) s = matched;
    }
    return s;
  }, [sessions, toolFilter, since, projectFilter]);

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

  async function refreshData() {
    setRefreshState('refreshing');
    setRefreshMessage(null);
    try {
      const response = await fetch('/api/import-sessions', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? t('dashboard.refreshFailed'));
      setRefreshState('done');
      setRefreshMessage(t('dashboard.scanned', { n: payload.scanned ?? 0, seconds: Math.round((payload.durationMs ?? 0) / 100) / 10 }));
      router.refresh();
    } catch (error) {
      setRefreshState('error');
      setRefreshMessage(error instanceof Error ? error.message : t('dashboard.refreshFailed'));
    }
  }

  function replaceQuery(nextTool: ToolFilter, accountId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextTool === 'all') {
      params.delete('agent');
      params.delete('codexAccount');
    } else {
      params.set('agent', nextTool);
      if (nextTool !== 'codex') {
        params.delete('codexAccount');
      }
    }

    if (nextTool === 'codex' && accountId) {
      params.set('codexAccount', accountId);
    } else {
      params.delete('codexAccount');
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeToolFilter(nextTool: ToolFilter) {
    setToolFilter(nextTool);
    replaceQuery(nextTool, nextTool === 'codex' ? selectedCodexAccountId : null);
  }

  function changeCodexAccount(accountId: string) {
    const nextAccountId = accountId || null;
    setToolFilter('codex');
    replaceQuery('codex', nextAccountId);
  }

  return (
    <>
      {/* Now / Runway — conclusion-first decision card at the very top so the
          user lands on "can I keep coding?" before any chart. */}
      <div ref={runwayRef}>
        <NowRunwayCard
          guard={runway.guard}
          contextPct={runway.contextPct}
          weeklyRemaining={runway.weeklyRemaining}
          window5h={
            // On a specific agent tab, show that agent's own 5h window so the
            // number matches the selected filter. "全部" keeps the
            // most-pressured `primary` window as the headline figure.
            toolFilter === 'all'
              ? runway.window5h
              : (runway.window5hByAgent?.[toolFilter] ?? null)
          }
          apiMode={runway.apiMode}
        />
      </div>

      {/* Project-filter hint when the floater deep-linked us with ?project=… */}
      {projectFilter && initialProjectFilter && (
        <p className="mb-3 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="rounded-full border border-violet-700/40 bg-violet-950/30 px-2 py-0.5 text-violet-200">
            project · {initialProjectFilter}
          </span>
        </p>
      )}

      {/* Redact mode banner — tells the user (and the screenshot viewer) that
          project names / titles / paths are masked. The toggle lives in
          settings; this banner is read-only so it doesn't clutter the
          dashboard with a second control. */}
      {redact && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <span aria-hidden className="font-mono text-amber-300">●</span>
          <span className="flex-1">{t('redact.active')}</span>
          <Link
            href="/settings#redact"
            className="rounded-full border border-amber-700/60 px-2 py-0.5 text-[10px] text-amber-100 transition-colors hover:border-amber-500 hover:text-amber-50"
          >
            {t('common.settings')}
          </Link>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:w-auto">
          {TOOLS
            .filter((tool) => tool === 'all' || (toolCounts[tool] ?? 0) > 0)
            .sort((a, b) => {
              if (a === 'all') return -1;
              if (b === 'all') return 1;
              return (toolCounts[b] ?? 0) - (toolCounts[a] ?? 0);
            })
            .map((tool) => (
            <button key={tool} onClick={() => changeToolFilter(tool)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                toolFilter === tool
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {t(TOOL_LABEL_KEYS[tool])}
              <span className="ml-1.5 text-zinc-600 tabular-nums">{toolCounts[tool] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-start lg:w-auto lg:justify-end">
          <div className="contents sm:flex sm:flex-wrap sm:justify-start sm:gap-1 lg:justify-end">
          {DATE_PRESETS.map((p) => (
            <button key={p} onClick={() => setDatePreset(p)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                datePreset === p
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {t(DATE_LABEL_KEYS[p])}
            </button>
          ))}
          </div>
          <button
            type="button"
            onClick={refreshData}
            disabled={refreshState === 'refreshing'}
            className="text-xs px-3 py-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-100 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {refreshState === 'refreshing' ? t('dashboard.refreshing') : t('dashboard.refreshData')}
          </button>
        </div>
      </div>
      {refreshMessage && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-xs ${
          refreshState === 'error'
            ? 'border-red-900/60 bg-red-950/40 text-red-200'
            : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'
        }`}>
          {refreshMessage}
        </div>
      )}

      {toolFilter === 'codex' && codexAccounts.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-zinc-500">{t('dashboard.codexAccount')}</p>
            <p className="mt-1 truncate text-xs text-zinc-600">
              {selectedCodexAccount
                ? selectedCodexAccount.isCurrent ? t('dashboard.codexCurrentOnly') : t('dashboard.codexSavedOnly')
                : t('dashboard.codexAllUsage')}
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <select
              value={selectedCodexAccountId ?? ''}
              onChange={(event) => changeCodexAccount(event.target.value)}
              className="max-w-72 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors hover:border-zinc-500 focus:border-violet-500"
            >
              <option value="">{t('dashboard.codexAccountAll')}</option>
              {codexAccounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.label} · {account.planType ?? t('common.unknown')}{account.isCurrent ? ' · current' : ''}
                </option>
              ))}
            </select>
            <span className="hidden shrink-0 text-xs text-zinc-600 sm:inline">
              {selectedCodexAccount ? shortAccountId(selectedCodexAccount.accountId) : t('dashboard.short')}
            </span>
          </div>
          {selectedCodexAccount && !selectedCodexAccount.isCurrent && (
            <Link
              href="/admin"
              className="basis-full text-xs text-violet-300 transition-colors hover:text-violet-100"
            >
              {t('dashboard.codexSwitchHint')}
            </Link>
          )}
        </div>
      )}

      {/* Usage cards — only meaningful for agents with quota windows */}
      {toolFilter !== 'all' && (() => {
        const usage = toolFilter === 'codex' ? codexUsage
          : toolFilter === 'claude-code' ? claudeUsage
          : null;
        const label = toolFilter === 'codex' ? selectedCodexLabel
          : toolFilter === 'claude-code' ? t('dashboard.claudeCodeLower')
          : t(TOOL_LABEL_KEYS[toolFilter]).toLowerCase();
        return (
          <>
            <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{t('dashboard.window5h')} · {label}</p>
                {usage?.window_5h_used_pct != null ? (
                  <>
                    <p className="text-3xl font-bold text-zinc-100">
                      {formatRemainingPercent(100 - usage.window_5h_used_pct)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{t('dashboard.remaining')} · {formatUsedPercent(usage.window_5h_used_pct)} {t('dashboard.used')}</p>
                    {usage.reset_at_5h && <p className="text-xs text-zinc-600 mt-1">{formatResetAt(usage.reset_at_5h, t)}</p>}
                  </>
                ) : (
                  <p className="text-zinc-600 text-sm mt-1">
                    {toolFilter === 'codex' ? selectedCodexEmptyTitle : t('dashboard.noData')}
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
                <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{t('dashboard.window7d')} · {label}</p>
                {usage?.window_weekly_used_pct != null ? (
                  <>
                    <p className="text-3xl font-bold text-zinc-100">
                      {formatRemainingPercent(100 - usage.window_weekly_used_pct)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{t('dashboard.remaining')} · {formatUsedPercent(usage.window_weekly_used_pct)} {t('dashboard.used')}</p>
                    {usage.reset_at_weekly && <p className="text-xs text-zinc-600 mt-1">{formatResetAt(usage.reset_at_weekly, t)}</p>}
                  </>
                ) : (
                  <p className="text-zinc-600 text-sm mt-1">
                    {toolFilter === 'codex' ? selectedCodexEmptyHint : t('dashboard.noData')}
                  </p>
                )}
              </div>
            </div>
          </>
        );
      })()}

      {/* Total — value, tokens, and cache are one story, so keep the summary
          together and put secondary detail into equal-height columns. */}
      <div className="mb-4">
        <UsageTotalCard
          insight={insight}
          recapCards={recapCards}
          period={datePreset}
          toolFilter={toolFilter}
          redact={redact}
        />
      </div>

      {/* Sessions table — clarifying span hint sits above so users know the
          duration column is wall-clock from start, not active typing time. */}
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px] text-zinc-500">
        <span className="uppercase tracking-wider">{t('card.session.spanLabel')}</span>
        <span className="text-zinc-600">{t('card.session.spanHint')}</span>
      </div>
      <div className="mb-4">
        <SessionsTable sessions={filteredSessions.slice(0, 40)} />
      </div>

      {/* Projects + tool split */}
      <div className="grid grid-cols-1 gap-4 mb-4 md:grid-cols-2">
        <ProjectLeaderboard sessions={filteredSessions} />
        <ToolSplitCard data={filteredToolSplit} />
      </div>

      {/* Lower-priority: achievements + heatmap come after the runway, ROI,
          cache, sessions, and projects. They're delight content, not decision
          content, so they sit below the fold. */}
      <div className="mb-4">
        <AchievementsCard data={achievements} />
      </div>

      <div className="grid grid-cols-1 gap-4 mb-4 lg:grid-cols-2">
        <BurndownChart
          data={toolFilter === 'codex' ? codexBurndown : toolFilter === 'claude-code' ? claudeBurndown : allBurndown}
          label={toolFilter === 'codex' ? selectedCodexLabel : toolFilter === 'claude-code' ? t('dashboard.claudeCodeLower') : t('dashboard.allAgents')}
        />
        <ActivityCard sessions={filteredSessions} streak={streak} timeline={timeline} />
      </div>

      {/* Setup doctor near the bottom — only matters when something's wrong */}
      <div className="mb-4">
        <SetupDoctorCard />
      </div>

      {/* File hotspots */}
      {hotspots.length > 0 && (
        <FileHotspots data={hotspots} />
      )}
    </>
  );
}

'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import type { FloatQuota, FloatStats } from '@/lib/float-stats';
import { decideQuotaGuard, type GuardDecision, type GuardStatus } from '@/lib/quota-guard';
import { useT } from '@/lib/i18n/client';
import { DEMO_TITLES, deterministicBucket, redactProject } from '@/lib/redact';

const REDACT_COOKIE = 'vibemeter:redact';

/**
 * Read the redact cookie on the client. The floater is a separate Next route
 * so it can't reach the server-side cookie helpers we use on the main
 * dashboard — this is fine because the data here is already aggregate; we
 * only need to mask the project name + title in the "Latest" / popover.
 */
function readRedactCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${REDACT_COOKIE}=1`));
}

function formatReset(ms: number | null, t: (k: string, v?: Record<string, string | number>) => string) {
  if (!ms) return t('float.unknownReset');
  const diff = ms - Date.now();
  if (diff <= 0) return t('float.snapshotExpired');
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatResetShort(ms: number | null): string {
  if (!ms) return '--';
  const diff = ms - Date.now();
  if (diff <= 0) return '0m';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

function contextColor(pct: number) {
  if (pct >= 90) return '#f43f5e';
  if (pct >= 80) return '#f59e0b';
  if (pct >= 60) return '#a78bfa';
  return '#10b981';
}

/**
 * Stamp a guard status onto a Tailwind palette + a 4-tier ring color. Kept
 * separate from the i18n keys so we can re-skin without touching translations.
 */
function statusPalette(status: GuardStatus) {
  switch (status) {
    case 'safe':
      return { ring: 'border-emerald-500/50 bg-emerald-950/40', text: 'text-emerald-200' };
    case 'watch':
      return { ring: 'border-amber-500/40 bg-amber-950/30', text: 'text-amber-200' };
    case 'risky':
      return { ring: 'border-orange-500/40 bg-orange-950/30', text: 'text-orange-200' };
    case 'wait':
      return { ring: 'border-rose-500/40 bg-rose-950/30', text: 'text-rose-200' };
    default:
      return { ring: 'border-zinc-700/60 bg-zinc-950', text: 'text-zinc-300' };
  }
}

function statusKey(status: GuardStatus): string {
  switch (status) {
    case 'safe': return 'float.statusSafe';
    case 'watch': return 'float.statusWatch';
    case 'risky': return 'float.statusRisky';
    case 'wait': return 'float.statusWait';
    default: return 'float.statusUnknown';
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatRemainingPercent(value: number | null | undefined) {
  if (value == null) return '--';
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped >= 100 ? 100 : Math.floor(clamped)}%`;
}

function formatUsedPercent(value: number | null | undefined) {
  if (value == null) return '--';
  const clamped = Math.max(0, Math.min(100, value));
  return `${clamped <= 0 ? 0 : Math.ceil(clamped)}%`;
}

/**
 * Deep-link target for the popover's title + arrow affordance. Carries the
 * primary agent + project so the dashboard can pre-filter or scroll to the
 * matching row. `/?…` is the dashboard root — Vibemeter does not have a
 * separate /dashboard route.
 */
function dashboardDeepLink(stats: FloatStats): string {
  const params = new URLSearchParams();
  const agent = stats.primary?.agent;
  if (agent === 'claude-code' || agent === 'codex') {
    params.set('agent', agent);
  }
  const project = stats.lastSession?.project;
  if (project && project !== 'unknown' && project !== '—') {
    params.set('project', project);
  }
  params.set('focus', 'current');
  return `/?${params.toString()}`;
}

export function FloatingWidget({ initialStats }: { initialStats: FloatStats }) {
  const t = useT();
  const [stats, setStats] = useState(initialStats);
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  // Read the redact cookie once on mount. The cookie is only written from
  // the dashboard's settings page, so it can't flip while this widget is
  // alive — no need for a listener.
  const [redact, setRedact] = useState(false);
  useEffect(() => {
    // Hydration sync — one-shot read of document.cookie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRedact(readRedactCookie());
  }, []);

  const primary = stats.primary;
  const remaining = primary?.remaining5h ?? primary?.remainingWeekly ?? null;
  const used = primary?.used5h ?? primary?.usedWeekly ?? 0;
  const color = quotaColor(primary);
  const ring = useMemo(() => {
    const pct = Math.max(0, Math.min(100, used));
    return `conic-gradient(${color} 0 ${100 - pct}%, #27272a ${100 - pct}% 100%)`;
  }, [color, used]);

  // Decision line — reuse the dashboard's quota-guard so the popover and the
  // upcoming NowRunwayCard speak the same language.
  const guard: GuardDecision = useMemo(
    () => decideQuotaGuard({ generatedAt: stats.generatedAt, quotas: stats.quotas }),
    [stats.generatedAt, stats.quotas],
  );
  const palette = statusPalette(guard.status);
  const dashboardHref = useMemo(() => dashboardDeepLink(stats), [stats]);

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

  const [now, setNow] = useState(0);
  useEffect(() => {
    startTransition(() => setNow(Date.now()));
    const tick = window.setInterval(() => startTransition(() => setNow(Date.now())), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    window.resizeTo?.(280, expanded ? 520 : 240);
    const timer = window.setInterval(loadStats, 60_000);
    return () => window.clearInterval(timer);
  }, [expanded]);

  const paused = stats.pausedUntil != null && now > 0 && stats.pausedUntil > now;
  const pausedMinLeft = paused ? Math.max(0, Math.round((stats.pausedUntil! - now) / 60_000)) : 0;

  async function togglePause() {
    if (paused) {
      await fetch('/api/pause', { method: 'DELETE' });
    } else {
      await fetch('/api/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes: 30 }) });
    }
    await loadStats();
  }

  async function openLastTranscript() {
    const tp = stats.lastSession?.transcriptPath;
    if (!tp) return;
    await fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: tp }) });
  }

  async function cycleCodexAccount() {
    const accounts = stats.codexAccounts;
    if (accounts.length < 2) return;
    const idx = Math.max(0, accounts.findIndex((a) => a.isCurrent));
    const next = accounts[(idx + 1) % accounts.length];
    await fetch('/api/codex-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', accountId: next.accountId }) });
    await loadStats();
  }

  // Side notes that go under the decision line. Only show when the signal is
  // strong enough to act on, so the popover stays scannable.
  const weeklyHigh = primary?.remainingWeekly != null && primary.remainingWeekly < 30;
  const contextHigh = stats.activeContext?.pct != null && stats.activeContext.pct >= 80;

  return (
    <main className="min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-[280px] flex-col items-stretch justify-start gap-3 px-4 py-4 font-mono">
        {/* Header: title links to dashboard with current context; × collapses. */}
        <header className="flex items-center justify-between">
          <a
            href={dashboardHref}
            target="_blank"
            rel="noreferrer"
            title={t('float.openDashboard')}
            className="group flex min-w-0 items-center gap-1.5 text-left outline-none"
          >
            <span className="text-sm font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter
            </span>
            <span aria-hidden className="text-xs text-zinc-500 transition-colors group-hover:text-violet-300">↗</span>
          </a>
          <button
            type="button"
            aria-label={t('float.collapse')}
            title={t('float.collapse')}
            onClick={() => setExpanded((value) => !value)}
            className="rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500 outline-none transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            ×
          </button>
        </header>

        {/* Conclusion line — answers "can I keep coding?" in two glances. */}
        <section className={`rounded-lg border px-3 py-3 ${palette.ring}`}>
          <p className={`text-sm font-semibold ${palette.text}`}>
            {t(statusKey(guard.status))}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-zinc-400">{guard.detail}</p>
        </section>

        {/* Ring + 5h percentage stays as the primary visual but smaller now. */}
        <button
          type="button"
          aria-label={t('float.openDashboard')}
          onClick={() => setExpanded((value) => !value)}
          className="relative mx-auto grid size-32 place-items-center rounded-full border border-zinc-800 bg-zinc-950 shadow-xl shadow-black/60 outline-none transition-transform hover:scale-[1.02]"
          style={{ background: ring }}
        >
          <span className="grid size-[7rem] place-items-center rounded-full border border-zinc-800 bg-zinc-950">
            <span className="text-center">
              <span className="block text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {primary?.label ?? 'Vibemeter'}
              </span>
              <span className="mt-1 block text-3xl font-semibold text-zinc-50">
                {formatRemainingPercent(remaining)}
              </span>
              <span className="mt-0.5 block text-[10px] text-zinc-500">
                {primary ? t('float.fiveHRemain') : t('float.noQuota')}
              </span>
            </span>
          </span>
        </button>

        {/* Side facts: reset countdown, pace, weekly, context. */}
        <section className="grid gap-1.5 text-[11px]">
          {primary?.resetAt5h != null && (
            <p className="text-zinc-400">
              {t('float.windowProgress', {
                used: formatUsedPercent(primary.used5h ?? 0),
                rel: formatResetShort(primary.resetAt5h),
              })}
            </p>
          )}
          {primary?.pace5hExhaustMin != null && (
            <p className="text-amber-300">{t('float.paceExhaust', { n: primary.pace5hExhaustMin })}</p>
          )}
          {primary && primary.pace5hExhaustMin == null && primary.pace5hPctPerMin != null && primary.pace5hPctPerMin <= 0 && (
            <p className="text-zinc-600">{t('float.paceFlat')}</p>
          )}
          {weeklyHigh && primary?.remainingWeekly != null && (
            <p className="text-rose-300">
              {t('float.weeklyProgress', { used: formatUsedPercent((primary.usedWeekly ?? (100 - primary.remainingWeekly))) })}
            </p>
          )}
          {contextHigh && stats.activeContext && (
            <p className="text-amber-300">
              {t('float.contextProgress', { pct: stats.activeContext.pct })}
            </p>
          )}
        </section>

        {/* Context bar — always show when we have data so the user can watch it
            climb mid-task even before it crosses the warning threshold. */}
        {stats.activeContext && (
          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
              <span>{t('float.context')}</span>
              <span className="tabular-nums" style={{ color: contextColor(stats.activeContext.pct) }}>
                {stats.activeContext.pct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full transition-all"
                style={{
                  width: `${stats.activeContext.pct}%`,
                  backgroundColor: contextColor(stats.activeContext.pct),
                }}
              />
            </div>
            <p className="mt-1 text-[10px] text-zinc-600 tabular-nums">
              {fmtTokens(stats.activeContext.tokens)} / {fmtTokens(stats.activeContext.limit)}
              {stats.activeContext.warning && (
                <span className="ml-2 text-amber-300">{t('float.contextWarn')}</span>
              )}
            </p>
          </div>
        )}

        {/* Action row: refresh + open dashboard */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {busy ? t('float.refreshing') : t('float.refresh')}
          </button>
          <a
            href={dashboardHref}
            target="_blank"
            rel="noreferrer"
            title={t('float.openDashboard')}
            className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            {t('float.openDashboardShort')}
          </a>
        </div>

        {/* Secondary actions (mute, transcript, switch). */}
        <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={togglePause}
            title={t('float.muteTooltip')}
            className={`rounded-full border px-2.5 py-1 text-[10px] transition-colors ${
              paused
                ? 'border-amber-400/50 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {paused ? t('float.paused', { n: pausedMinLeft }) : t('float.actionPause')}
          </button>
          {stats.lastSession?.transcriptPath && (
            redact ? (
              <button
                type="button"
                disabled
                title={t('redact.transcriptHidden')}
                className="cursor-not-allowed rounded-full border border-zinc-800 px-2.5 py-1 text-[10px] text-zinc-600"
              >
                {t('float.actionOpenTranscript')}
              </button>
            ) : (
              <button
                type="button"
                onClick={openLastTranscript}
                className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-300 transition-colors hover:border-zinc-500"
              >
                {t('float.actionOpenTranscript')}
              </button>
            )
          )}
          {stats.codexAccounts.length >= 2 && (
            <button
              type="button"
              onClick={cycleCodexAccount}
              className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-300 transition-colors hover:border-zinc-500"
            >
              {t('float.actionSwitch')}
            </button>
          )}
        </div>

        {expanded && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900/90 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs text-zinc-500">
                  {primary?.accountLabel ?? t('float.currentQuota')}
                </p>
                <p className="mt-1 text-sm font-medium text-zinc-100">
                  {primary ? t('float.usedPct', { pct: formatUsedPercent(primary.used5h) }) : t('float.usedNo')}
                </p>
              </div>
              <div className="text-right text-xs text-zinc-500">
                <p>{formatReset(primary?.resetAt5h ?? null, t)}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t('float.statToday')}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{stats.todaySessions}</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t('float.statTotal')}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{stats.totalSessions}</p>
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t('float.statWeekly')}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{formatRemainingPercent(primary?.remainingWeekly)}</p>
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
                <p className="text-xs text-zinc-600">{t('float.noToday')}</p>
              )}
            </div>

            {stats.lastSession && (() => {
              // Mask cosmetically when the user has redact mode on. We use a
              // local-only salt (sessionStorage isn't available here; the
              // floater is its own short-lived window) keyed on the session
              // id so the label stays stable for as long as this widget
              // instance lives. The dashboard's masked label may differ —
              // that's acceptable because the floater is a glance surface,
              // not a screenshot target.
              const projectDisplay = redact
                ? redactProject(stats.lastSession.project, 'float-local')
                : stats.lastSession.project;
              const titleDisplay = redact && stats.lastSession.title
                ? DEMO_TITLES[deterministicBucket(stats.lastSession.id, 'float-local') % DEMO_TITLES.length]
                : stats.lastSession.title;
              return (
                <div className="mt-3 border-t border-zinc-800 pt-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600">{t('float.latest')}</p>
                  <p className="mt-1 truncate text-xs text-zinc-300">
                    {toolLabel(stats.lastSession.tool)} · {projectDisplay}
                  </p>
                  {titleDisplay && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{titleDisplay}</p>
                  )}
                </div>
              );
            })()}
          </section>
        )}
      </div>
    </main>
  );
}

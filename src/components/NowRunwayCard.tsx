'use client';

import type { GuardDecision } from '@/lib/quota-guard';
import { useT } from '@/lib/i18n/client';

interface Props {
  guard: GuardDecision;
  /**
   * Optional Claude Code context pct (0..100). When >= 80 the card surfaces a
   * "context pressure high" line; below that it stays out of the way so a
   * green decision banner doesn't get drowned in side facts.
   */
  contextPct?: number | null;
  /** Lowest weekly remaining across agents; we warn when it dips below 30. */
  weeklyRemaining?: number | null;
  /**
   * Used pct + reset epoch ms for the dominant 5h window, plus the agent label
   * (e.g. "Codex" / "Claude") so the card discloses *which* agent the number
   * belongs to — `primary` flips to whichever quota is most pressured.
   */
  window5h?: { usedPct: number | null; resetAt: number | null; label?: string | null } | null;
  /**
   * Set when Claude is authenticated via API key (no 5h/weekly windows). In
   * that mode the card swaps from "quota runway" to "API spend so far" — the
   * reset / pace lines are meaningless without a billing window.
   */
  apiMode?: { costToday: number; cost7d: number } | null;
}

function statusKey(status: GuardDecision['status']): string {
  switch (status) {
    case 'safe': return 'card.runway.statusSafe';
    case 'watch': return 'card.runway.statusWatch';
    case 'risky': return 'card.runway.statusRisky';
    case 'wait': return 'card.runway.statusWait';
    default: return 'card.runway.statusUnknown';
  }
}

function recoKey(status: GuardDecision['status']): string {
  switch (status) {
    case 'safe': return 'card.runway.recoSafe';
    case 'watch': return 'card.runway.recoWatch';
    case 'risky': return 'card.runway.recoRisky';
    case 'wait': return 'card.runway.recoWait';
    default: return 'card.runway.recoUnknown';
  }
}

function statusPalette(status: GuardDecision['status']) {
  switch (status) {
    case 'safe':
      return { wrap: 'border-emerald-700/40 bg-emerald-950/30', text: 'text-emerald-200', accent: 'bg-emerald-500' };
    case 'watch':
      return { wrap: 'border-amber-700/40 bg-amber-950/25', text: 'text-amber-200', accent: 'bg-amber-500' };
    case 'risky':
      return { wrap: 'border-orange-700/40 bg-orange-950/25', text: 'text-orange-200', accent: 'bg-orange-500' };
    case 'wait':
      return { wrap: 'border-rose-700/40 bg-rose-950/25', text: 'text-rose-200', accent: 'bg-rose-500' };
    default:
      return { wrap: 'border-zinc-800 bg-zinc-900', text: 'text-zinc-300', accent: 'bg-zinc-500' };
  }
}

function formatRel(ms: number | null): string | null {
  if (!ms) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return '0m';
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatUsd(value: number): string {
  return value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

function formatMinutesHM(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export function NowRunwayCard({ guard, contextPct, weeklyRemaining, window5h, apiMode }: Props) {
  const t = useT();

  // API-mode branch: Claude API key, no rate windows, just cost tracking.
  if (apiMode) {
    const showContext = contextPct != null && contextPct >= 80;
    return (
      <div className="mb-4 rounded-lg border border-cyan-700/40 bg-cyan-950/25 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.runway.title')}</p>
          <span className="rounded-full border border-cyan-700 bg-cyan-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-200">
            {t('card.runway.apiBadge')}
          </span>
        </div>

        <p className="mt-2 text-lg font-semibold text-cyan-200">{t('card.runway.apiStatus')}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t('card.runway.apiDetail')}</p>

        <p className="mt-3 text-xs text-zinc-500">
          <span className="text-zinc-400">{t('card.runway.apiSpend')}</span>
          {' · '}
          <span className="tabular-nums text-zinc-300">{t('card.runway.apiToday', { n: formatUsd(apiMode.costToday) })}</span>
          {' · '}
          <span className="tabular-nums text-zinc-300">{t('card.runway.api7d', { n: formatUsd(apiMode.cost7d) })}</span>
        </p>

        {showContext && (
          <p className="mt-2 text-xs text-amber-300">{t('card.runway.contextHigh', { pct: contextPct! })}</p>
        )}

        <p className="mt-3 rounded-md border border-zinc-800/60 bg-zinc-950/60 px-3 py-2 text-xs leading-snug text-cyan-200">
          {t('card.runway.apiReco')}
        </p>
      </div>
    );
  }

  const palette = statusPalette(guard.status);
  const usedPct = window5h?.usedPct;
  const resetRel = formatRel(window5h?.resetAt ?? null);
  const showWeekly = weeklyRemaining != null && weeklyRemaining < 30;
  const showContext = contextPct != null && contextPct >= 80;
  const showPace = guard.pace5hExhaustMin != null && guard.pace5hExhaustMin > 0;

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${palette.wrap}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.runway.title')}</p>
          <p className={`mt-1.5 text-base font-semibold ${palette.text}`}>{t(statusKey(guard.status))}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {showPace && (
              <span className="text-amber-300">{t('card.runway.paceExhaust', { n: formatMinutesHM(guard.pace5hExhaustMin!) })}</span>
            )}
            {showWeekly && (
              <span className="text-rose-300">{t('card.runway.weeklyHigh')}</span>
            )}
            {showContext && (
              <span className="text-amber-300">{t('card.runway.contextHigh', { pct: contextPct! })}</span>
            )}
            <span className={palette.text}>{t(recoKey(guard.status))}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-3 lg:min-w-48 lg:justify-end">
          {(usedPct != null || resetRel) && (
            <div className="rounded-md border border-zinc-800/60 bg-zinc-950/40 px-3 py-1.5 text-right text-xs">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">
                {window5h?.label ? `${window5h.label} · ` : ''}{t('card.runway.window5h')}
              </p>
              <p className="mt-1 tabular-nums text-zinc-300">
                {usedPct != null ? `${Math.ceil(Math.max(0, Math.min(100, usedPct)))}%` : '--'}
              </p>
              {resetRel && (
                <p className="mt-0.5 text-[11px] text-zinc-500">{t('card.runway.resetIn', { rel: resetRel })}</p>
              )}
            </div>
          )}
          <span className={`mt-1 inline-block size-2 rounded-full ${palette.accent}`} aria-hidden />
        </div>
      </div>
    </div>
  );
}

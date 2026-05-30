'use client';

import { useState } from 'react';
import type { SpendingStats } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

type ToolFilter = 'all' | 'claude-code' | 'codex' | 'cursor';

function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
}

function sumWindow(daily: SpendingStats['daily'], days: number) {
  const todayKey = isoDay(0);
  const cutoff = isoDay(days - 1);
  let claudeUsd = 0;
  let codexTokens = 0;
  for (const d of daily) {
    if (d.date >= cutoff && d.date <= todayKey) {
      claudeUsd += d.claudeUsd;
      codexTokens += d.codexTokens;
    }
  }
  return { claudeUsd, codexTokens };
}

export function SpendingCard({ data, toolFilter }: { data: SpendingStats; toolFilter: ToolFilter }) {
  const t = useT();
  const canShowClaude = toolFilter === 'all' || toolFilter === 'claude-code';
  const canShowCodex  = toolFilter === 'all' || toolFilter === 'codex';
  const [hiddenSeries, setHiddenSeries] = useState({ claude: false, codex: false });
  const [activeDate, setActiveDate] = useState<string | null>(data.daily.at(-1)?.date ?? null);

  const showClaude = canShowClaude && !hiddenSeries.claude;
  const showCodex  = canShowCodex && !hiddenSeries.codex;
  const activeDay = data.daily.find((d) => d.date === activeDate) ?? data.daily.at(-1) ?? null;

  function toggleSeries(kind: 'claude' | 'codex') {
    setHiddenSeries((current) => {
      const next = { ...current, [kind]: !current[kind] };
      const nextShowsClaude = canShowClaude && !next.claude;
      const nextShowsCodex = canShowCodex && !next.codex;
      if (!nextShowsClaude && !nextShowsCodex) return current;
      return next;
    });
  }

  const maxClaude = showClaude ? Math.max(...data.daily.map((d) => d.claudeUsd), 0.01) : 0.01;
  const maxCodex  = showCodex  ? Math.max(...data.daily.map((d) => d.codexTokens), 1) : 1;

  // Trailing-window KPI cells fill the empty column space we used to have
  // below the chart, while making "what am I burning lately" answerable at a
  // glance without scanning the bars.
  const today = sumWindow(data.daily, 1);
  const last7d = sumWindow(data.daily, 7);
  const last30d = sumWindow(data.daily, 30);

  if (!canShowClaude && !canShowCodex) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.spending.title')}</p>
        <p className="text-zinc-600 text-sm">{t('card.spending.noCursor')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{t('card.spending.title')}</p>
      {/* Disclaimer sits directly under the (renamed) title so it can't be
          missed — this number is an estimate from public API pricing, not
          anyone's actual invoice. */}
      <p className="mb-3 mt-0.5 text-[11px] text-zinc-600">{t('card.spending.disclaimer')}</p>

      {/* Totals row */}
      <div className="flex gap-6 mb-4">
        {showClaude && (
          <div>
            <p className="text-xl font-bold text-violet-400">${data.claudeTotalUsd.toFixed(2)}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{t('card.spending.claudeCost')}</p>
          </div>
        )}
        {showCodex && (
          <div>
            <p className="text-xl font-bold text-emerald-400">{fmtTokens(data.codexTotalTokens)}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{t('card.spending.codexTokens')}</p>
          </div>
        )}
      </div>

      {/* Trailing-window KPIs — fills the column visually + actually answers
          "am I burning faster this week?" at a glance. */}
      <div className="mb-4 grid grid-cols-3 gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        {(['today', '7d', '30d'] as const).map((win) => {
          const stats = win === 'today' ? today : win === '7d' ? last7d : last30d;
          return (
            <div key={win}>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t(`card.spending.window.${win}`)}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {showClaude && (
                  <span className="text-sm font-semibold tabular-nums text-violet-300">${stats.claudeUsd.toFixed(2)}</span>
                )}
                {showCodex && (
                  <span className="text-xs tabular-nums text-emerald-300">{fmtTokens(stats.codexTokens)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 14-day bar chart — taller so it reads as a real trend, not a sparkline. */}
      <p className="text-xs text-zinc-600 mb-2">{t('card.spending.last14d')}</p>
      <div className="flex items-end gap-px h-56">
        {data.daily.map((d) => {
          const claudePct = showClaude ? (d.claudeUsd / maxClaude) * 100 : 0;
          const codexPct  = showCodex  ? (d.codexTokens / maxCodex) * 100 : 0;
          const label = d.date.slice(5);
          const active = activeDay?.date === d.date;
          const tip = [
            label,
            showClaude ? `Claude $${d.claudeUsd.toFixed(2)}` : '',
            showCodex  ? `Codex ${fmtTokens(d.codexTokens)} tokens` : '',
          ].filter(Boolean).join('\n');
          return (
            <button
              key={d.date}
              type="button"
              title={tip}
              aria-label={tip}
              onClick={() => setActiveDate(d.date)}
              onFocus={() => setActiveDate(d.date)}
              onMouseEnter={() => setActiveDate(d.date)}
              className={`group flex flex-1 flex-col items-center rounded-sm outline-none transition-colors ${
                active ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/25 focus:bg-zinc-800/25'
              }`}
            >
              <div className="w-full flex flex-col justify-end gap-px" style={{ height: '208px' }}>
                {showCodex && d.codexTokens > 0 && (
                  <div className={`w-full rounded-sm ${active ? 'bg-emerald-400/80' : 'bg-emerald-600/60'}`} style={{ height: `${Math.max(codexPct * 2.08, 1)}px` }} />
                )}
                {showClaude && d.claudeUsd > 0 && (
                  <div className={`w-full rounded-sm ${active ? 'bg-violet-300/90' : 'bg-violet-500/70'}`} style={{ height: `${Math.max(claudePct * 2.08, 1)}px` }} />
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-zinc-700 text-xs">{data.daily[0]?.date.slice(5)}</span>
        <span className="text-zinc-700 text-xs">{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
      </div>

      {activeDay && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs">
          <span className="font-medium text-zinc-300">{activeDay.date.slice(5)}</span>
          {canShowClaude && (
            <span className={showClaude ? 'text-violet-300' : 'text-zinc-700'}>
              {t('card.spending.legendClaude')} ${activeDay.claudeUsd.toFixed(2)}
            </span>
          )}
          {canShowCodex && (
            <span className={showCodex ? 'text-emerald-300' : 'text-zinc-700'}>
              {t('card.spending.legendCodex')} {fmtTokens(activeDay.codexTokens)}
            </span>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex gap-4 mt-2">
        {canShowClaude && (
          <button
            type="button"
            onClick={() => toggleSeries('claude')}
            aria-pressed={showClaude}
            className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
              showClaude ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-700 hover:text-zinc-500'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-sm ${showClaude ? 'bg-violet-500/70' : 'bg-zinc-700'}`} /> {t('card.spending.legendClaude')}
          </button>
        )}
        {canShowCodex && (
          <button
            type="button"
            onClick={() => toggleSeries('codex')}
            aria-pressed={showCodex}
            className={`flex items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors ${
              showCodex ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-700 hover:text-zinc-500'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-sm ${showCodex ? 'bg-emerald-600/60' : 'bg-zinc-700'}`} /> {t('card.spending.legendCodex')}
          </button>
        )}
      </div>
    </div>
  );
}

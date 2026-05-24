'use client';

import type { SpendingStats } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

type ToolFilter = 'all' | 'claude-code' | 'codex' | 'cursor';

export function SpendingCard({ data, toolFilter }: { data: SpendingStats; toolFilter: ToolFilter }) {
  const t = useT();
  const showClaude = toolFilter === 'all' || toolFilter === 'claude-code';
  const showCodex  = toolFilter === 'all' || toolFilter === 'codex';

  const maxClaude = showClaude ? Math.max(...data.daily.map((d) => d.claudeUsd), 0.01) : 0.01;
  const maxCodex  = showCodex  ? Math.max(...data.daily.map((d) => d.codexTokens), 1) : 1;

  if (!showClaude && !showCodex) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.spending.title')}</p>
        <p className="text-zinc-600 text-sm">{t('card.spending.noCursor')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.spending.title')}</p>

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

      {/* 14-day bar chart */}
      <p className="text-xs text-zinc-600 mb-2">{t('card.spending.last14d')}</p>
      <div className="flex items-end gap-px h-16">
        {data.daily.map((d) => {
          const claudePct = showClaude ? (d.claudeUsd / maxClaude) * 100 : 0;
          const codexPct  = showCodex  ? (d.codexTokens / maxCodex) * 100 : 0;
          const label = d.date.slice(5);
          const tip = [
            label,
            showClaude ? `Claude $${d.claudeUsd.toFixed(2)}` : '',
            showCodex  ? `Codex ${fmtTokens(d.codexTokens)} tokens` : '',
          ].filter(Boolean).join('\n');
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center" title={tip}>
              <div className="w-full flex flex-col justify-end gap-px" style={{ height: '56px' }}>
                {showCodex && d.codexTokens > 0 && (
                  <div className="w-full bg-emerald-600/60 rounded-sm" style={{ height: `${Math.max(codexPct * 0.56, 1)}px` }} />
                )}
                {showClaude && d.claudeUsd > 0 && (
                  <div className="w-full bg-violet-500/70 rounded-sm" style={{ height: `${Math.max(claudePct * 0.56, 1)}px` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-zinc-700 text-xs">{data.daily[0]?.date.slice(5)}</span>
        <span className="text-zinc-700 text-xs">{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-2">
        {showClaude && (
          <span className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="w-2 h-2 rounded-sm bg-violet-500/70 inline-block" /> {t('card.spending.legendClaude')}
          </span>
        )}
        {showCodex && (
          <span className="flex items-center gap-1 text-xs text-zinc-600">
            <span className="w-2 h-2 rounded-sm bg-emerald-600/60 inline-block" /> {t('card.spending.legendCodex')}
          </span>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { Achievement } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtProgress(a: Achievement): string {
  if (!a.progress) return '';
  const { current, target } = a.progress;
  if (target >= 1_000_000) return `${(current / 1_000_000).toFixed(0)}M / ${(target / 1_000_000).toFixed(0)}M`;
  if (target >= 1000) return `${current.toLocaleString()} / ${target.toLocaleString()}`;
  if (target >= 100 && Number.isFinite(current) && current < 100 && current % 1 !== 0) {
    return `${current.toFixed(1)} / ${target}`;
  }
  return `${Math.floor(current)} / ${target}`;
}

export function AchievementsCard({ data }: { data: Achievement[] }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const tt = (id: string, fallback: string) => {
    const out = t(`achv.${id}.title`);
    return out === `achv.${id}.title` ? fallback : out;
  };
  const td = (id: string, fallback: string) => {
    const out = t(`achv.${id}.desc`);
    return out === `achv.${id}.desc` ? fallback : out;
  };
  const unlocked = data.filter((a) => a.unlocked);
  const locked = data.filter((a) => !a.unlocked).sort((a, b) => {
    const pa = a.progress ? a.progress.current / a.progress.target : 0;
    const pb = b.progress ? b.progress.current / b.progress.target : 0;
    return pb - pa;
  });

  const display = showAll
    ? [...unlocked, ...locked]
    : [...unlocked.slice(0, 4), ...locked.slice(0, Math.max(0, 6 - Math.min(unlocked.length, 4)))];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">{t('card.achievements.title')}</p>
        <p className="text-xs text-zinc-600">{t('card.achievements.unlocked', { n: unlocked.length, total: data.length })}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {display.map((a) => {
          const pct = a.progress ? Math.min(100, (a.progress.current / a.progress.target) * 100) : (a.unlocked ? 100 : 0);
          return (
            <div key={a.id}
              className={`rounded border px-2.5 py-2 ${
                a.unlocked
                  ? 'border-amber-700/50 bg-amber-950/30'
                  : 'border-zinc-800 bg-zinc-950/30'
              }`}
              title={a.description}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-medium ${a.unlocked ? 'text-amber-300' : 'text-zinc-500'}`}>
                  {a.unlocked ? '★' : '☆'} {tt(a.id, a.title)}
                </span>
                <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                  {fmtProgress(a)}
                </span>
              </div>
              <div className="h-0.5 bg-zinc-800 rounded mt-1.5 overflow-hidden">
                <div className={`h-full ${a.unlocked ? 'bg-amber-500' : 'bg-zinc-600'}`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1 truncate">{td(a.id, a.description)}</p>
            </div>
          );
        })}
      </div>

      {data.length > 6 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-3 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded py-1"
        >
          {showAll ? t('card.achievements.showLess') : t('card.achievements.showAll', { n: data.length })}
        </button>
      )}
    </div>
  );
}

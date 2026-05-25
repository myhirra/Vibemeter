'use client';

import type { CacheStats } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function rateColor(pct: number): string {
  if (pct >= 75) return 'text-emerald-300';
  if (pct >= 50) return 'text-violet-200';
  if (pct >= 25) return 'text-amber-300';
  return 'text-rose-300';
}

async function openTranscript(path: string) {
  try {
    await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (e) {
    console.error('open failed', e);
  }
}

export function CacheCard({ data }: { data: CacheStats }) {
  const t = useT();

  if (data.sessionsAnalyzed === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{t('card.cache.title')}</p>
        <p className="text-xs text-zinc-600">{t('card.cache.empty')}</p>
      </div>
    );
  }

  const incoming = data.totalInput + data.totalCacheCreation + data.totalCacheRead;
  const readPct = incoming > 0 ? Math.round((data.totalCacheRead / incoming) * 100) : 0;
  const creationPct = incoming > 0 ? Math.round((data.totalCacheCreation / incoming) * 100) : 0;
  const inputPct = Math.max(0, 100 - readPct - creationPct);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.cache.title')}</p>
        <p className="text-[10px] text-zinc-600">{t('card.cache.window30d', { n: data.sessionsAnalyzed })}</p>
      </div>

      <div className="mb-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">{t('card.cache.hitRate')}</span>
          <span className={`text-3xl font-bold ${rateColor(data.hitRatePct)}`}>{data.hitRatePct}%</span>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-900">
          <div className="flex h-full">
            <div className="bg-emerald-500/80" style={{ width: `${readPct}%` }} title={t('card.cache.legendRead')} />
            <div className="bg-amber-500/70" style={{ width: `${creationPct}%` }} title={t('card.cache.legendCreate')} />
            <div className="bg-zinc-600" style={{ width: `${inputPct}%` }} title={t('card.cache.legendInput')} />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          <span><span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500/80" />{t('card.cache.legendRead')} {fmtTokens(data.totalCacheRead)}</span>
          <span><span className="mr-1 inline-block size-2 rounded-sm bg-amber-500/70" />{t('card.cache.legendCreate')} {fmtTokens(data.totalCacheCreation)}</span>
          <span><span className="mr-1 inline-block size-2 rounded-sm bg-zinc-600" />{t('card.cache.legendInput')} {fmtTokens(data.totalInput)}</span>
        </div>

        <p className="mt-3 text-[11px] text-emerald-300/90">
          {t('card.cache.saved', { tokens: fmtTokens(data.inputTokensSaved) })}
        </p>
        {data.hint && (
          <p className="mt-1 text-[11px] text-zinc-400">{t(`card.cache.${data.hint}`)}</p>
        )}
      </div>

      {data.topProjects.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs text-zinc-500">{t('card.cache.byProject')}</p>
          <ul className="space-y-1.5">
            {data.topProjects.slice(0, 5).map((p) => (
              <li key={p.project} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-zinc-300">{p.project}</span>
                <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">{p.sessions}×</span>
                <span className={`shrink-0 w-12 text-right tabular-nums ${rateColor(p.hitRatePct)}`}>
                  {p.hitRatePct}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.worstSessions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-zinc-500">{t('card.cache.worstSessions')}</p>
          <ul className="space-y-1.5">
            {data.worstSessions.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-300">{s.aiTitle ?? s.project}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-600">
                    {s.project} · {new Date(s.startedAt).toLocaleDateString()} · {fmtTokens(s.inputTokens + s.cacheCreationTokens + s.cacheReadTokens)} tok
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`text-sm font-semibold tabular-nums ${rateColor(s.hitRatePct)}`}>{s.hitRatePct}%</span>
                  {s.transcriptPath && (
                    <button
                      type="button"
                      onClick={() => openTranscript(s.transcriptPath!)}
                      className="text-[10px] text-violet-300 hover:text-violet-200"
                    >
                      {t('card.cache.openTranscript')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

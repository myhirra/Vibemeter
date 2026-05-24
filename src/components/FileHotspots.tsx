'use client';

import type { FileHotspot } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

export function FileHotspots({ data }: { data: FileHotspot[] }) {
  const t = useT();
  if (data.length === 0) return null;

  const max = data[0].changes;
  const basename = (p: string) => p.split('/').pop() ?? p;
  const dirpart = (p: string) => {
    const parts = p.split('/');
    return parts.length > 1 ? parts.slice(-2, -1)[0] : '';
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.hotspots.title')}</p>
      <div className="space-y-2">
        {data.map((f) => (
          <div key={f.path}>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="text-zinc-300 truncate max-w-xs" title={f.path}>
                <span className="text-zinc-600">{dirpart(f.path)}/</span>
                {basename(f.path)}
              </span>
              <span className="text-zinc-500 tabular-nums ml-2 shrink-0">
                {f.changes}× · {f.sessions} {t('card.hotspots.sessions')}
              </span>
            </div>
            <div className="h-1 bg-zinc-800 rounded">
              <div
                className="h-1 bg-amber-500/60 rounded"
                style={{ width: `${(f.changes / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

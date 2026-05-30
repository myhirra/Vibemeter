'use client';

import type { ProjectCost } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * "Where did my cost go" — projects ranked by API-equivalent spend. Distinct
 * from ProjectLeaderboard (which ranks by time); this one answers the cost
 * audit question. Cost is server-computed over all history; the split bar
 * shows Claude vs Codex contribution per project.
 */
export function ProjectCostCard({ projects, limit = 10 }: { projects: ProjectCost[]; limit?: number }) {
  const t = useT();
  const rows = projects.slice(0, limit);
  const maxUsd = Math.max(...rows.map((r) => r.totalUsd), 0.01);
  const grandTotal = projects.reduce((acc, p) => acc + p.totalUsd, 0);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="mb-3 text-xs uppercase tracking-wider text-zinc-500">{t('card.projectCost.title')}</p>
        <p className="text-sm text-zinc-600">{t('card.projectCost.empty')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.projectCost.title')}</p>
        <p className="text-[11px] tabular-nums text-zinc-500">
          {t('card.projectCost.total', { usd: fmtUsd(grandTotal) })}
        </p>
      </div>
      <p className="mb-3 text-[11px] text-zinc-600">{t('card.projectCost.subtitle')}</p>

      <div className="space-y-1.5">
        {rows.map((r, i) => {
          const claudeFrac = r.totalUsd > 0 ? (r.claudeUsd / r.totalUsd) * 100 : 0;
          const codexFrac = r.totalUsd > 0 ? (r.codexUsd / r.totalUsd) * 100 : 0;
          const barWidth = (r.totalUsd / maxUsd) * 100;
          return (
            <div key={r.project} className="group">
              <div className="flex items-center gap-3 text-xs">
                <span className="w-5 text-right tabular-nums text-zinc-600">{i + 1}</span>
                <span className="flex-1 truncate text-zinc-200" title={r.project}>
                  {r.project}
                </span>
                <span className="w-12 text-right tabular-nums text-zinc-500">{r.sessions}×</span>
                <span className="w-16 text-right font-semibold tabular-nums text-zinc-200">{fmtUsd(r.totalUsd)}</span>
              </div>
              {/* Split bar: violet = Claude, emerald = Codex, scaled to the
                  most expensive project so relative spend reads at a glance. */}
              <div className="ml-8 mt-0.5 h-1.5 overflow-hidden rounded-sm bg-zinc-800" style={{ width: `${Math.max(barWidth, 2)}%` }}>
                <div className="flex h-full">
                  <div className="bg-violet-500" style={{ width: `${claudeFrac}%` }} title={`Claude ${fmtUsd(r.claudeUsd)}`} />
                  <div className="bg-emerald-500" style={{ width: `${codexFrac}%` }} title={`Codex ${fmtUsd(r.codexUsd)}`} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-violet-500" />Claude</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-500" />Codex</span>
        <span className="ml-auto">{t('card.projectCost.estimate')}</span>
      </div>
    </div>
  );
}

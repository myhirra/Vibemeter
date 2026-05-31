'use client';

import type { ToolSplit } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

function fmtHours(ms: number) {
  const h = ms / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`;
}

const TOOL_COLOR: Record<string, string> = {
  'claude-code': 'bg-violet-500',
  codex: 'bg-emerald-500',
  cursor: 'bg-sky-500',
  gemini: 'bg-blue-500',
  opencode: 'bg-amber-500',
  qoder: 'bg-rose-500',
  other: 'bg-zinc-500',
};

export function ToolSplitCard({ data }: { data: ToolSplit[] }) {
  const t = useT();
  const total = data.reduce((s, d) => s + d.sessions, 0);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.toolSplit.title')}</p>
      {data.length === 0 ? (
        <p className="text-zinc-600 text-sm">{t('common.empty')}</p>
      ) : (
        <>
          {/* Stacked bar */}
          <div className="flex h-2 rounded overflow-hidden gap-0.5 mb-3">
            {data.map((d) => (
              <div
                key={d.tool}
                className={`${TOOL_COLOR[d.tool] ?? 'bg-zinc-500'} rounded-sm`}
                style={{ width: `${d.pct}%` }}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            {data.map((d) => (
              <div key={d.tool} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-sm inline-block ${TOOL_COLOR[d.tool] ?? 'bg-zinc-500'}`} />
                  <span className="text-zinc-300">{d.tool === 'claude-code' ? 'claude code' : d.tool}</span>
                </div>
                <span className="text-zinc-500 tabular-nums">
                  {d.sessions} {t('card.toolSplit.sessions')} · {fmtHours(d.totalMs)} · {d.pct}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-2">{t('card.toolSplit.totalSessions', { n: total })}</p>
        </>
      )}
    </div>
  );
}

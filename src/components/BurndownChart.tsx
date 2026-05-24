'use client';

import { useState, useRef, useCallback } from 'react';
import type { BurndownPoint } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

const W = 560, H = 120, PL = 32, PR = 8, PT = 4, PB = 4;

function toSvgPoints(pts: { x: number; y: number }[]): string {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === today.toDateString()) return time;
  return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${time}`;
}

interface HoverState {
  svgX: number;   // in viewBox coords
  screenX: number;
  screenY: number;
  point: BurndownPoint;
}

export function BurndownChart({ data, label = 'claude code' }: { data: BurndownPoint[]; label?: string }) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const minTs = data.length >= 2 ? data[0].ts : 0;
  const maxTs = data.length >= 2 ? data[data.length - 1].ts : 1;
  const tsRange = maxTs - minTs || 1;

  const xOf = (ts: number) => PL + ((ts - minTs) / tsRange) * (W - PL - PR);
  const yOf = (pct: number | null) => pct == null ? null : PT + (1 - pct / 100) * (H - PT - PB);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || data.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    // frac maps to viewBox x: PL..W-PR
    const svgX = PL + frac * (W - PL - PR);
    // find nearest data point by x
    let best = data[0];
    let bestDist = Infinity;
    for (const pt of data) {
      const d = Math.abs(xOf(pt.ts) - svgX);
      if (d < bestDist) { bestDist = d; best = pt; }
    }
    setHover({ svgX: xOf(best.ts), screenX: e.clientX, screenY: rect.top, point: best });
  }, [data, minTs, tsRange]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data.length < 2) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{t('card.burndown.header', { label })}</p>
        <p className="text-zinc-600 text-sm">{t('card.burndown.notEnough')}</p>
      </div>
    );
  }

  const pts5h     = data.filter((d) => d.pct5h     != null).map((d) => ({ x: xOf(d.ts), y: yOf(d.pct5h)!     }));
  const ptsWeekly = data.filter((d) => d.pctWeekly != null).map((d) => ({ x: xOf(d.ts), y: yOf(d.pctWeekly)! }));

  const last5h     = data.filter((d) => d.pct5h     != null).at(-1)?.pct5h;
  const lastWeekly = data.filter((d) => d.pctWeekly != null).at(-1)?.pctWeekly;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 relative">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.burndown.header', { label })}</p>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-28 cursor-crosshair"
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Y-axis grid + labels */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = yOf(pct)!;
          return (
            <g key={pct}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#27272a" strokeWidth="1" />
              <text x={PL - 3} y={y + 3.5} textAnchor="end" fontSize="8" fill="#52525b">{pct}%</text>
            </g>
          );
        })}

        {pts5h.length >= 2 && (
          <polyline points={toSvgPoints(pts5h)}
            fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinejoin="round" />
        )}
        {ptsWeekly.length >= 2 && (
          <polyline points={toSvgPoints(ptsWeekly)}
            fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="4 2" />
        )}

        {/* Crosshair */}
        {hover && (
          <>
            <line x1={hover.svgX} y1={PT} x2={hover.svgX} y2={H - PB}
              stroke="#52525b" strokeWidth="1" strokeDasharray="3 2" />
            {hover.point.pct5h != null && (
              <circle cx={hover.svgX} cy={yOf(hover.point.pct5h)!} r="2.5" fill="#8b5cf6" />
            )}
            {hover.point.pctWeekly != null && (
              <circle cx={hover.svgX} cy={yOf(hover.point.pctWeekly)!} r="2.5" fill="#10b981" />
            )}
          </>
        )}
      </svg>

      {/* Floating tooltip */}
      {hover && (
        <div className="pointer-events-none absolute z-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: `${((hover.svgX - PL) / (W - PL - PR) * 100).toFixed(1)}%`,
            transform: hover.svgX > W * 0.65 ? 'translateX(-110%)' : 'translateX(4px)',
            top: '40px',
          }}
        >
          <p className="text-zinc-400 mb-1">{fmtTs(hover.point.ts)}</p>
          {hover.point.pct5h != null && (
            <p className="text-violet-400">{t('card.burndown.legend5h')}: {hover.point.pct5h.toFixed(0)}% {t('card.burndown.tipUsed')}</p>
          )}
          {hover.point.pctWeekly != null && (
            <p className="text-emerald-400">{t('card.burndown.legend7d')}: {hover.point.pctWeekly.toFixed(0)}% {t('card.burndown.tipUsed')}</p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-1 text-xs text-zinc-600">
        <span>{fmtTs(minTs)}</span>
        <div className="flex gap-4">
          <span className="text-violet-400">— {t('card.burndown.legend5h')} {last5h != null ? `(${last5h.toFixed(0)}% ${t('card.burndown.tipUsed')})` : ''}</span>
          <span className="text-emerald-400">-- {t('card.burndown.legend7d')} {lastWeekly != null ? `(${lastWeekly.toFixed(0)}% ${t('card.burndown.tipUsed')})` : ''}</span>
        </div>
        <span>{fmtTs(maxTs)}</span>
      </div>
    </div>
  );
}

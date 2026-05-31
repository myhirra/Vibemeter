'use client';

import type { ProjectRoi } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

interface Props {
  roi: ProjectRoi;
  /** Display name of the project ("All projects" when scope is global). */
  projectLabel: string;
  /** "7d" or "30d" — controls which window-label string is rendered. */
  window: '7d' | '30d';
  onWindowChange: (next: '7d' | '30d') => void;
}

function formatPct(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}

function formatRatio(ratio: number | null): string {
  if (ratio == null) return '—';
  return `${Math.round(ratio)}%`;
}

function formatPerDollar(value: number | null): string {
  if (value == null) return '—';
  if (value >= 10) return value.toFixed(0);
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

function momentumLabelKey(label: 'accelerating' | 'steady' | 'cooling' | null): string | null {
  if (!label) return null;
  if (label === 'accelerating') return 'card.roi.momentumAccelerating';
  if (label === 'cooling') return 'card.roi.momentumCooling';
  return 'card.roi.momentumSteady';
}

function momentumPalette(label: 'accelerating' | 'steady' | 'cooling' | null) {
  if (label === 'accelerating') return 'text-emerald-300';
  if (label === 'cooling') return 'text-rose-300';
  if (label === 'steady') return 'text-zinc-300';
  return 'text-zinc-500';
}

function momentumArrow(label: 'accelerating' | 'steady' | 'cooling' | null): string {
  if (label === 'accelerating') return '↑';
  if (label === 'cooling') return '↓';
  if (label === 'steady') return '→';
  return '·';
}

function focusInterpretation(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 70) return 'card.roi.focusFocused';
  if (score >= 35) return 'card.roi.focusBalanced';
  return 'card.roi.focusScattered';
}

/**
 * Per-project ROI card — 5 small stat tiles. Numbers are free for all users;
 * the Pro tier gates the narrative around them (Phase 2) and the historical
 * week-picker, not the metrics themselves.
 */
export function ProjectRoiCard({ roi, projectLabel, window, onWindowChange }: Props) {
  const t = useT();
  const windowLabel = window === '7d' ? t('card.roi.window7d') : t('card.roi.window30d');

  const shipRate = roi.shipRate.rate;
  const reworkPct = roi.reworkRate.pct;
  const momentumLabel = roi.momentum.label;
  const focus = roi.focus;
  const opd = roi.outputPerDollar;

  const isEmpty =
    shipRate == null
    && roi.reworkRate.totalSessions === 0
    && roi.momentum.label == null
    && focus == null
    && opd.commitsPerDollar == null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.roi.title')}</p>
        <div className="flex gap-1">
          {(['7d', '30d'] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWindowChange(w)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                window === w
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {w === '7d' ? t('card.roi.window7d') : t('card.roi.window30d')}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-[11px] text-zinc-600">
        {t('card.roi.subtitle', { project: projectLabel, window: windowLabel })}
        {roi.shipRate.untagged > 0 && (
          <span className="ml-2 text-zinc-700">
            · {t('card.roi.untaggedExcluded', { n: roi.shipRate.untagged })}
          </span>
        )}
      </p>

      {isEmpty ? (
        <p className="py-6 text-center text-sm text-zinc-600">{t('card.roi.empty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {/* Ship Rate */}
          <Tile
            label={t('card.roi.shipRate')}
            value={formatPct(shipRate)}
            hint={t('card.roi.shipRateHint')}
            interp={shipRate == null ? t('card.roi.noSignal') : null}
            valueClass="text-emerald-200"
          />
          {/* Rework Rate — lower is better, so the colour cues invert */}
          <Tile
            label={t('card.roi.reworkRate')}
            value={roi.reworkRate.totalSessions === 0 ? '—' : `${reworkPct}%`}
            hint={t('card.roi.reworkRateHint')}
            interp={null}
            valueClass={
              roi.reworkRate.totalSessions === 0
                ? 'text-zinc-500'
                : reworkPct >= 40
                ? 'text-rose-200'
                : reworkPct >= 20
                ? 'text-amber-200'
                : 'text-emerald-200'
            }
          />
          {/* Momentum */}
          <Tile
            label={t('card.roi.momentum')}
            value={
              <span className="flex items-baseline justify-center gap-1">
                <span aria-hidden className={`text-base ${momentumPalette(momentumLabel)}`}>
                  {momentumArrow(momentumLabel)}
                </span>
                <span>{formatRatio(roi.momentum.ratio)}</span>
              </span>
            }
            hint={t('card.roi.momentumHint')}
            interp={
              momentumLabel
                ? t(momentumLabelKey(momentumLabel) ?? 'card.roi.momentumSteady')
                : t('card.roi.noSignal')
            }
            valueClass={momentumPalette(momentumLabel)}
          />
          {/* Focus — project-agnostic, label makes the global scope explicit */}
          <Tile
            label={t('card.roi.focus')}
            value={focus == null ? '—' : `${focus}`}
            hint={t('card.roi.focusHint')}
            interp={
              focus == null
                ? t('card.roi.noSignal')
                : t(focusInterpretation(focus) ?? 'card.roi.focusBalanced')
            }
            valueClass={
              focus == null
                ? 'text-zinc-500'
                : focus >= 70
                ? 'text-violet-200'
                : focus >= 35
                ? 'text-zinc-200'
                : 'text-amber-200'
            }
          />
          {/* Output per Dollar — compact: commits/$ headline, ships/$ in hint */}
          <Tile
            label={t('card.roi.outputPerDollar')}
            value={formatPerDollar(opd.commitsPerDollar)}
            hint={t('card.roi.outputPerDollarHint', {
              commits: formatPerDollar(opd.commitsPerDollar),
              ships: formatPerDollar(opd.shippedSessionsPerDollar),
            })}
            interp={opd.commitsPerDollar == null ? t('card.roi.noSignal') : null}
            valueClass="text-cyan-200"
          />
        </div>
      )}
    </div>
  );
}

interface TileProps {
  label: string;
  value: React.ReactNode;
  hint: string;
  interp: string | null;
  valueClass: string;
}

function Tile({ label, value, hint, interp, valueClass }: TileProps) {
  return (
    <div className="rounded-md border border-zinc-800/60 bg-zinc-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500" title={hint}>
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {interp && <p className="mt-0.5 text-[10px] text-zinc-500">{interp}</p>}
    </div>
  );
}

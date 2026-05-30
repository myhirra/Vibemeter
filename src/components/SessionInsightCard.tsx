'use client';

import { useState } from 'react';
import type { SessionInsight } from '@/lib/stats';
import type { RecapCardData, RecapPeriod } from '@/lib/recap-card';
import { useT } from '@/lib/i18n/client';
import { RecapShareButton } from './RecapShareButton';

function fmtCost(n: number | null) {
  if (n == null) return '—';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return m ? `${h}h ${m}m` : `${h}h`;
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

const VALUE_PLANS = [
  { name: 'Pro $20', priceUsd: 20 },
  { name: 'Max $100', priceUsd: 100 },
  { name: 'Max $200', priceUsd: 200 },
];

function recapCardForPeriod(
  cards: { today: RecapCardData; weekly: RecapCardData; monthly: RecapCardData },
  period: RecapPeriod,
) {
  return period === 'today' ? cards.today : period === '7d' ? cards.weekly : cards.monthly;
}

function periodPlanCost(monthlyUsd: number, card: RecapCardData): number {
  const denominator = card.period.billingDenominatorDays > 0 ? card.period.billingDenominatorDays : 365.2425 / 12;
  return Math.round((monthlyUsd * card.period.days / denominator) * 100) / 100;
}

function periodLabelKey(period: RecapPeriod) {
  return period === 'today' ? 'today' : period === '7d' ? '7d' : 'month';
}

export function SessionInsightCard({
  data,
  redact = false,
  recapCards,
}: {
  data: SessionInsight;
  redact?: boolean;
  recapCards?: { today: RecapCardData; weekly: RecapCardData; monthly: RecapCardData };
}) {
  const t = useT();
  const [recapPeriod, setRecapPeriod] = useState<RecapPeriod>('7d');
  const { retryRate7d, topExpensive, value } = data;
  const selectedRecap = recapCards ? recapCardForPeriod(recapCards, recapPeriod) : null;
  const displayValueUsd = selectedRecap?.valueAtApiRatesUsd ?? value.monthToDateUsd;
  const valuePlans = selectedRecap
    ? VALUE_PLANS.map((p) => {
      const priceUsd = periodPlanCost(p.priceUsd, selectedRecap);
      return {
        name: p.name,
        priceUsd,
        multiplier: priceUsd > 0 ? Math.round((displayValueUsd / priceUsd) * 10) / 10 : 0,
      };
    })
    : value.plans;
  const bestPlan = valuePlans.reduce((best, p) => (p.multiplier >= 1 && (!best || p.priceUsd > best.priceUsd) ? p : best), null as null | typeof valuePlans[number]);
  const tipPlan = bestPlan ?? valuePlans[valuePlans.length - 1] ?? null;
  const valueTip = tipPlan
    ? t(selectedRecap ? 'card.insight.valueTipPeriod' : 'card.insight.valueTip', {
      period: t(`card.insight.period.${periodLabelKey(recapPeriod)}`),
      cost: `$${displayValueUsd.toFixed(2)}`,
      plan: tipPlan.name,
      price: `$${tipPlan.priceUsd.toFixed(tipPlan.priceUsd >= 10 ? 0 : 2)}`,
      x: tipPlan.multiplier,
    })
    : null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <p className="text-xs text-zinc-500 uppercase tracking-wider mb-3">{t('card.insight.title')}</p>

      <div className="mb-4 rounded-md border border-emerald-800/40 bg-emerald-950/30 p-3">
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            {t('card.insight.valueTitle')}
            {valueTip && (
              <span className="group relative inline-flex">
                <span
                  tabIndex={0}
                  aria-label={valueTip}
                  title={valueTip}
                  className="grid size-4 cursor-help place-items-center rounded-full border border-emerald-700/50 bg-emerald-950 text-[10px] leading-none text-emerald-200 outline-none transition-colors hover:border-emerald-500 focus:border-emerald-500"
                >
                  ?
                </span>
                <span className="pointer-events-none absolute left-0 top-6 z-20 hidden w-72 rounded-md border border-emerald-800/60 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300 shadow-xl shadow-black/40 group-hover:block group-focus-within:block">
                  {valueTip}
                </span>
              </span>
            )}
          </span>
          <span className="text-lg font-semibold text-emerald-300">${displayValueUsd.toFixed(2)}</span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          {selectedRecap ? t(`card.insight.valueSub.${periodLabelKey(recapPeriod)}`) : t('card.insight.valueSub')}
        </p>
        {bestPlan && (
          <p className="mt-1 text-[11px] text-emerald-200/80">
            {t('card.insight.valuePlan', { plan: bestPlan.name, x: bestPlan.multiplier })}
          </p>
        )}
        {recapCards && (
          <div className="mt-3 flex justify-end">
            <RecapShareButton
              today={recapCards.today}
              weekly={recapCards.weekly}
              monthly={recapCards.monthly}
              period={recapPeriod}
              onPeriodChange={setRecapPeriod}
            />
          </div>
        )}
      </div>

      <div className="mb-4 rounded-md border border-zinc-800 bg-zinc-950 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-500">{t('card.insight.retryTitle')}</span>
          <span className="text-lg font-semibold text-zinc-100">
            {t('card.insight.retryFmt', {
              retried: retryRate7d.retriedSessions,
              total: retryRate7d.totalSessions,
              pct: retryRate7d.pct,
            })}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">{t('card.insight.retryDesc')}</p>
      </div>

      <div>
        <p className="mb-2 text-xs text-zinc-500">{t('card.insight.topTitle')}</p>
        {topExpensive.length === 0 ? (
          <p className="text-xs text-zinc-600">{t('card.insight.topEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {topExpensive.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-zinc-200">{s.aiTitle ?? s.project}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {s.project} · {fmtDuration(s.durationMs)} · {new Date(s.startedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-emerald-300">{fmtCost(s.costUsd)}</span>
                  {redact ? (
                    <button
                      type="button"
                      disabled
                      title={t('redact.transcriptHidden')}
                      className="cursor-not-allowed text-[10px] text-zinc-600"
                    >
                      {t('card.insight.openTranscript')}
                    </button>
                  ) : (
                    s.transcriptPath && (
                      <button
                        type="button"
                        onClick={() => openTranscript(s.transcriptPath!)}
                        className="text-[10px] text-violet-300 hover:text-violet-200"
                      >
                        {t('card.insight.openTranscript')}
                      </button>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

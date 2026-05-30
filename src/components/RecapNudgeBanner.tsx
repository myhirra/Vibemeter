'use client';

import { useState } from 'react';
import type { RecapCardData } from '@/lib/recap-card';
import type { RecapNudge } from '@/lib/recap-nudge';
import { useT } from '@/lib/i18n/client';
import { RecapShareButton } from './RecapShareButton';

function cardForPeriod(
  period: RecapNudge['period'],
  cards: { today: RecapCardData; weekly: RecapCardData; monthly: RecapCardData },
) {
  return period === 'today' ? cards.today : period === 'month' ? cards.monthly : cards.weekly;
}

function periodKey(period: RecapNudge['period']) {
  return period === 'today' ? 'today' : period === 'month' ? 'month' : 'week';
}

export function RecapNudgeBanner({
  nudge,
  today,
  weekly,
  monthly,
}: {
  nudge: RecapNudge | null;
  today: RecapCardData;
  weekly: RecapCardData;
  monthly: RecapCardData;
}) {
  const t = useT();
  const [visible, setVisible] = useState(Boolean(nudge));
  if (!nudge || !visible) return null;
  const card = cardForPeriod(nudge.period, { today, weekly, monthly });
  const periodLabel = t(`recap.period.${periodKey(nudge.period)}`);
  const headline = card.roiMultiplier != null
    ? t('recap.nudge.headline.roi', { period: periodLabel, x: card.roiMultiplier })
    : t('recap.nudge.headline.value', {
      period: periodLabel,
      value: `$${card.valueAtApiRatesUsd.toFixed(card.valueAtApiRatesUsd >= 10 ? 1 : 2)}`,
    });

  async function dismiss() {
    setVisible(false);
    try {
      await fetch('/api/recap-nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', id: nudge?.id }),
      });
    } catch {
      // Dismissal is cosmetic; the next server read will expire the banner.
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-violet-700/40 bg-violet-950/20 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-100">{headline}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{t('recap.nudge.detail')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <RecapShareButton today={today} weekly={weekly} monthly={monthly} compact />
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          aria-label={t('recap.nudge.dismissAria')}
        >
          {t('recap.nudge.dismiss')}
        </button>
      </div>
    </div>
  );
}

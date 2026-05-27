'use client';

import { useState } from 'react';
import type { RecapCardData } from '@/lib/recap-card';
import type { RecapNudge } from '@/lib/recap-nudge';
import { RecapShareButton } from './RecapShareButton';

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
  const [visible, setVisible] = useState(Boolean(nudge));
  if (!nudge || !visible) return null;

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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-700/40 bg-violet-950/20 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-violet-100">{nudge.headline}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{nudge.detail}</p>
      </div>
      <div className="flex items-center gap-2">
        <RecapShareButton today={today} weekly={weekly} monthly={monthly} compact />
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-zinc-700 px-2 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          aria-label="Dismiss recap nudge"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

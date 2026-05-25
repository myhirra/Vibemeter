'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

export function OpenFloatButton() {
  const t = useT();
  const [state, setState] = useState<'idle' | 'opening' | 'error'>('idle');

  async function open() {
    setState('opening');
    try {
      const r = await fetch('/api/float-open', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      window.setTimeout(() => setState('idle'), 800);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={state === 'opening'}
      className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
    >
      {state === 'opening' ? t('header.floatOpening') : state === 'error' ? t('header.floatError') : t('header.openFloat')}
    </button>
  );
}

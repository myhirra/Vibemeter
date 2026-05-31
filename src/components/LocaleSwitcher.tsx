'use client';

import { useRouter } from 'next/navigation';
import { startTransition } from 'react';
import { LOCALE_COOKIE } from '@/lib/i18n/types';
import { useLocale, useSetLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n';

export function LocaleSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const t = useT();
  const router = useRouter();

  function set(next: Locale) {
    if (next === locale) return;
    // 365-day cookie so the choice persists across server restarts. Same-site
    // Lax is the right default — this is a UI preference, not an auth token.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // Flip client state immediately — every useT() consumer re-renders right
    // away, so the user sees the new language in <100ms instead of waiting on
    // the server to re-run the whole dashboard route.
    setLocale(next);
    // Background refresh so server-rendered, locale-bound strings (weekly
    // report headline, recap cards) catch up. Not awaited; buttons stay
    // enabled. If the user clicks again before this finishes, the next
    // refresh just supersedes it.
    startTransition(() => router.refresh());
  }

  return (
    <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => set('zh')}
        className={`px-2.5 py-1.5 transition-colors ${locale === 'zh' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
      >
        {t('header.langZh')}
      </button>
      <span className="text-zinc-700">·</span>
      <button
        type="button"
        onClick={() => set('en')}
        className={`px-2.5 py-1.5 transition-colors ${locale === 'en' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
      >
        {t('header.langEn')}
      </button>
    </div>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE } from '@/lib/i18n/types';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n';

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function set(next: Locale) {
    if (next === locale) return;
    // 365-day cookie so the choice persists across server restarts. Same-site
    // Lax is the right default — this is a UI preference, not an auth token.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => set('zh')}
        disabled={pending}
        className={`px-2.5 py-1.5 transition-colors ${locale === 'zh' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
      >
        {t('header.langZh')}
      </button>
      <span className="text-zinc-700">·</span>
      <button
        type="button"
        onClick={() => set('en')}
        disabled={pending}
        className={`px-2.5 py-1.5 transition-colors ${locale === 'en' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
      >
        {t('header.langEn')}
      </button>
    </div>
  );
}

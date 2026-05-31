'use client';

// Client-side locale plumbing. A provider receives the initial locale from the
// root server layout (cookie-derived, single source of truth on first paint),
// but the client also keeps a useState mirror so LocaleSwitcher can flip the
// language instantly — without waiting for a full RSC refresh that re-runs
// every DB query on the dashboard route.

import { createContext, useContext, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, type Locale } from './types';
import { t as translate } from './index';

interface LocaleCtxValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleCtxValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function LocaleProvider({ locale: initialLocale, children }: { locale: Locale; children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const value = useMemo<LocaleCtxValue>(() => ({ locale, setLocale }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale(): (next: Locale) => void {
  return useContext(LocaleContext).setLocale;
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

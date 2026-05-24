'use client';

// Client-side locale plumbing. A provider receives the locale from the root
// server layout (one source of truth, cookie-derived); descendants read it
// via useLocale() and call useT() to translate without prop-drilling.

import { createContext, useContext, useMemo } from 'react';
import { DEFAULT_LOCALE, type Locale } from './types';
import { t as translate } from './index';

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const locale = useLocale();
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
}

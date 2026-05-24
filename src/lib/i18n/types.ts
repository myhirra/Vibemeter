// Locale types + constants. Default Chinese — toggle via cookie + header switcher.

export type Locale = 'zh' | 'en';
export const LOCALES: readonly Locale[] = ['zh', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALE_COOKIE = 'vibemeter_locale';

export function isLocale(v: unknown): v is Locale {
  return v === 'zh' || v === 'en';
}

export function normalizeLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

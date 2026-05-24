// Pure translator. Lookup by key + optional {name} interpolation. Works in
// both server and client contexts — caller supplies the locale explicitly so
// we don't need to thread next/headers into the hot path.

import { messagesFor } from './messages';
import type { Locale } from './types';

export type { Locale } from './types';
export { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale, normalizeLocale } from './types';
export { messagesFor } from './messages';

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const msgs = messagesFor(locale);
  const tpl = msgs[key] ?? key;
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, name) => {
    const v = vars[name];
    return v == null ? `{${name}}` : String(v);
  });
}

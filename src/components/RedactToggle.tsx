'use client';

/**
 * Toggle for "Redact sensitive data" mode.
 *
 * Stores the preference as a cookie (`vibemeter:redact=1`) so the server can
 * read it during SSR and mask data before the page is rendered. A
 * `location.reload()` follows every change so the next paint is fully masked
 * (no flicker of real data during hydration).
 *
 * Free feature — no entitlement gate. The whole point is for people to safely
 * screenshot their dashboard for marketing / bug reports / sharing.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/client';

const COOKIE_NAME = 'vibemeter:redact';

function readCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((part) => part.trim().startsWith(`${COOKIE_NAME}=1`));
}

function writeCookie(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) {
    document.cookie = `${COOKIE_NAME}=1; path=/; max-age=31536000; SameSite=Lax`;
  } else {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function RedactToggle() {
  const t = useT();
  // SSR-friendly default: assume off until we hydrate. After mount we read the
  // real cookie value so the switch matches the persisted preference.
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Hydration sync — one-shot init from document.cookie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setEnabled(readCookie());
  }, []);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    writeCookie(next);
    // Reload so the server re-renders with masked data. Without this the
    // existing prop tree would still carry real project names until the user
    // navigated away and back.
    window.location.reload();
  }

  // While SSR / before hydration we render the inert "off" state so the
  // markup matches what the server emitted (avoids a hydration mismatch).
  const isOn = mounted ? enabled : false;

  return (
    <section
      id="redact"
      className="rounded-lg border border-zinc-800 bg-zinc-900 p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-200">{t('redact.title')}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t('redact.description')}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={t('redact.toggle')}
          onClick={toggle}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
            isOn
              ? 'border-violet-500/60 bg-violet-500/30'
              : 'border-zinc-700 bg-zinc-800'
          }`}
        >
          <span
            aria-hidden
            className={`inline-block h-4 w-4 transform rounded-full bg-zinc-100 shadow transition-transform ${
              isOn ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p className="mt-3 text-[11px] text-zinc-600">{t('redact.toggle')}</p>
    </section>
  );
}

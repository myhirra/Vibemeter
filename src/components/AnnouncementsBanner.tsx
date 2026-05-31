'use client';

// Dashboard top-of-page strip for curated announcements (quota resets,
// outages, pricing changes). Renders every relevant item as a vertically
// stacked, three-tier list — never collapsed — so the user sees the full
// picture at a glance.
//
//   urgent → big card, rose ring + ⛔ icon
//   warn / notice → standard card (severity icon + title + body + kind chip
//                    + countdown + source + dismiss)
//   info → single-line strip (icon + title + source link + dismiss)
//
// The fetch/filter/dismiss/seen pipeline still lives in `useAnnouncements`;
// this component only owns layout + per-row chrome.

import { useEffect, useState } from 'react';
import {
  pickLocalized,
  type Announcement,
  type AnnouncementSeverity,
  type AnnouncementKind,
} from '@/lib/announcements';
import { useAnnouncements } from '@/lib/announcements-client';
import { useLocale, useT } from '@/lib/i18n/client';

interface SeverityPalette {
  ring: string;
  text: string;
  dot: string;
  chip: string;
  icon: string;
}

/**
 * Severity → palette. urgent gets a heavier rose ring + ⛔ icon to set it
 * apart from warn (amber) and notice (violet). Info uses zinc; we never
 * render info as a full card so its palette only affects the strip row.
 */
function severityPalette(severity: AnnouncementSeverity): SeverityPalette {
  switch (severity) {
    case 'urgent':
      return {
        ring: 'border-rose-500/70 bg-rose-950/40',
        text: 'text-rose-50',
        dot: 'bg-rose-500',
        chip: 'border-rose-500/60 bg-rose-500/15 text-rose-100',
        icon: '⛔',
      };
    case 'warn':
      return {
        ring: 'border-amber-700/50 bg-amber-950/30',
        text: 'text-amber-100',
        dot: 'bg-amber-300',
        chip: 'border-amber-700/50 text-amber-200',
        icon: '!',
      };
    case 'notice':
      return {
        ring: 'border-violet-700/40 bg-violet-950/30',
        text: 'text-violet-100',
        dot: 'bg-violet-300',
        chip: 'border-violet-700/40 text-violet-200',
        icon: '·',
      };
    case 'info':
    default:
      return {
        ring: 'border-zinc-800/80 bg-zinc-950/70',
        text: 'text-zinc-200',
        dot: 'bg-zinc-500',
        chip: 'border-zinc-700 text-zinc-300',
        icon: 'ⓘ',
      };
  }
}

function kindIcon(kind: AnnouncementKind): string {
  switch (kind) {
    case 'quota_reset': return '⟳';
    case 'outage':      return '!';
    case 'pricing':     return '$';
    case 'model':       return '◆';
    default:            return '·';
  }
}

function kindKey(kind: AnnouncementKind): string {
  return `ann.kind.${kind}`;
}

/** Render an `occurs_at` ISO into a "in 2h 5m" / "now" string. */
function relativeUntil(iso: string | undefined, now: number, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return null;
  const diff = target - now;
  if (diff <= 0) return t('ann.now');
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const days = Math.floor(hours / 24);
  let rel: string;
  if (days > 0) {
    const remHours = hours - days * 24;
    rel = remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  } else if (hours > 0) {
    rel = `${hours}h ${minutes}m`;
  } else {
    rel = `${minutes}m`;
  }
  return t('ann.in', { rel });
}

interface CardProps {
  item: Announcement;
  onDismiss: (id: string) => void;
  locale: 'zh' | 'en';
  now: number;
  t: (k: string, v?: Record<string, string | number>) => string;
}

/** Full card — used for urgent / warn / notice. */
function AnnouncementCard({ item, onDismiss, locale, now, t }: CardProps) {
  const palette = severityPalette(item.severity);
  const title = pickLocalized(item.title, locale);
  const body = pickLocalized(item.body, locale);
  const rel = relativeUntil(item.occurs_at, now, t);
  const sourceUrl = item.source?.url;
  const sourceLabel = item.source?.label ?? sourceUrl;
  const sevIcon = item.severity === 'urgent' ? palette.icon : kindIcon(item.kind);

  // Urgent items keep the full row width so they can't be missed; warn /
  // notice flow into the 2-col grid above so two of them can sit side by side.
  const spanClass = item.severity === 'urgent' ? 'md:col-span-2' : '';

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${palette.ring} ${spanClass}`}>
      <span aria-hidden className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full ${palette.dot} text-xs font-bold text-zinc-950`}>
        {sevIcon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className={`text-sm font-semibold ${palette.text}`}>{title}</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${palette.chip}`}>
            {t(kindKey(item.kind))}
          </span>
          {rel && (
            <span className="text-[11px] tabular-nums text-zinc-400">{rel}</span>
          )}
        </div>
        {body && <p className="mt-1 text-xs leading-snug text-zinc-400">{body}</p>}
        {(sourceLabel || sourceUrl) && (
          <p className="mt-1 text-[11px] text-zinc-500">
            {t('ann.source')}:{' '}
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-zinc-300 underline-offset-2 transition-colors hover:text-zinc-100 hover:underline"
              >
                {sourceLabel}
              </a>
            ) : (
              <span className="text-zinc-300">{sourceLabel}</span>
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('ann.dismiss')}
        title={t('ann.dismiss')}
        className="shrink-0 rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

/** Single-line strip — used for info only. Compact, darker, no body/chip. */
function AnnouncementInfoStrip({ item, onDismiss, locale, t }: CardProps) {
  const palette = severityPalette('info');
  const title = pickLocalized(item.title, locale);
  const sourceUrl = item.source?.url;
  const sourceLabel = item.source?.label ?? sourceUrl;

  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs md:col-span-2 ${palette.ring}`}>
      <span aria-hidden className="inline-flex size-4 shrink-0 items-center justify-center text-[11px] leading-none text-zinc-500">
        {palette.icon}
      </span>
      <p className={`min-w-0 flex-1 truncate ${palette.text}`}>{title}</p>
      {sourceLabel && (
        sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="shrink-0 text-[11px] text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-200 hover:underline"
          >
            {sourceLabel}
          </a>
        ) : (
          <span className="shrink-0 text-[11px] text-zinc-500">{sourceLabel}</span>
        )
      )}
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t('ann.dismiss')}
        title={t('ann.dismiss')}
        className="shrink-0 rounded-full border border-zinc-800 px-1.5 text-xs leading-none text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

interface BannerProps {
  /**
   * Providers the user actually has data for. When unknown, pass `null` and
   * the banner will show every provider's items (acceptable fallback per
   * spec). For the dashboard we pass a Set built from the visible agents.
   */
  userProviders?: ReadonlySet<string> | null;
}

export function AnnouncementsBanner({ userProviders = null }: BannerProps) {
  const t = useT();
  const locale = useLocale();
  const { items, dismiss, markSeen } = useAnnouncements({ userProviders });
  // `now` ticks once a minute so countdowns stay accurate while the dashboard
  // is open without touching every other piece of state.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Mark every currently-rendered item as seen as soon as it shows up — the
  // banner itself counts as "the user saw it". Dismiss is a separate, stronger
  // signal (means "hide forever").
  useEffect(() => {
    if (items.length === 0) return;
    markSeen(items.map((item) => item.id));
  }, [items, markSeen]);

  if (items.length === 0) return null;

  return (
    <section className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-2" aria-label="announcements">
      {items.map((item) => (
        item.severity === 'info' ? (
          <AnnouncementInfoStrip
            key={item.id}
            item={item}
            onDismiss={dismiss}
            locale={locale}
            now={now}
            t={t}
          />
        ) : (
          <AnnouncementCard
            key={item.id}
            item={item}
            onDismiss={dismiss}
            locale={locale}
            now={now}
            t={t}
          />
        )
      ))}
    </section>
  );
}

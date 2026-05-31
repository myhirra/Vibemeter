// Announcement feed — fetch + cache + client filter.
//
// Contract (locked, server side is curated by hand): a versioned JSON payload
// at `NEXT_PUBLIC_VIBEMETER_ANNOUNCEMENTS_URL` (default
// https://vibemeter.siney.top/v1/announcements.json) carrying a small set of
// curated items — quota resets, outages, pricing nudges. We fetch on app
// boot, again on a 15-min interval, and once on every window-focus event.
//
// Caching is ETag-based via localStorage so the offline experience is
// "you keep seeing the last good payload, silently". Failures are swallowed:
// announcements are non-essential UI; never crash the dashboard for them.
//
// All filtering happens client-side so the public JSON stays purely the
// editor's truth — the client picks what's relevant for *this* install:
//   * `expires_at` in the past   → drop
//   * `affects.min_version`      → drop if local pkg is older
//   * `affects.providers`        → keep only items relevant to providers the
//                                  user has any data for (caller supplies the
//                                  provider set; null = no filtering)
//   * locally dismissed ids      → drop
//
// Pure helpers (no React, no DOM) live in this file so they can be
// unit-tested under `node --test` and imported from server-side route
// handlers. The React hook that wires this into a component tree lives in
// the sibling `announcements-client.tsx` (a `'use client'` module).

export type AnnouncementKind = 'quota_reset' | 'outage' | 'pricing' | 'model' | 'other';
export type AnnouncementProvider = 'claude' | 'codex' | 'cursor' | 'all';
export type AnnouncementSeverity = 'info' | 'notice' | 'warn' | 'urgent';

export interface AnnouncementLocalized {
  zh?: string;
  en?: string;
}

export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  provider: AnnouncementProvider;
  severity: AnnouncementSeverity;
  title: AnnouncementLocalized;
  body?: AnnouncementLocalized;
  occurs_at?: string;
  expires_at?: string;
  source?: { label?: string; url?: string };
  affects?: { providers?: string[]; min_version?: string };
}

export interface AnnouncementFeed {
  version: number;
  items: Announcement[];
}

export interface AnnouncementFilterContext {
  /** Local install version (semver-ish, e.g. "0.2.28"). */
  appVersion: string | null;
  /** Providers the user has any data for. `null` = unknown, do not filter. */
  userProviders: ReadonlySet<string> | null;
  /** Map of dismissed ids → timestamp ms. */
  dismissed: Record<string, number>;
  /** Now epoch ms — injected for testability. */
  now: number;
}

const DEFAULT_URL = 'https://vibemeter.siney.top/v1/announcements.json';
const LS_ETAG = 'vm:ann:etag';
const LS_BODY = 'vm:ann:body';
const LS_DISMISSED = 'vm:ann:dismissed';
const LS_SEEN = 'vm:ann:seen';
const LS_NOTIFIED = 'vm:ann:notified';
const LS_PREFS = 'vm:ann:prefs';
export const POLL_INTERVAL_MS = 15 * 60 * 1_000;
/** Notified records older than this are pruned. 30 days is plenty — items
 *  themselves usually have shorter `expires_at`, but we keep the long tail
 *  to avoid the "same id re-notified after the user dismissed it weeks ago"
 *  failure mode if the editor ever republishes an old id. */
const NOTIFIED_MAX_AGE_MS = 30 * 24 * 3_600_000;

export const SEVERITY_RANK: Record<AnnouncementSeverity, number> = {
  urgent: 3,
  warn: 2,
  notice: 1,
  info: 0,
};

/** Compare two dot-separated semver-ish strings. Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => parseInt(part.replace(/[^\d].*$/, ''), 10) || 0);
  const pb = b.split('.').map((part) => parseInt(part.replace(/[^\d].*$/, ''), 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Apply the four client-side filter rules and return the pruned list. Stable
 * sort by severity DESC, then `occurs_at` ASC (sooner-first), then id.
 */
export function filterAnnouncements(
  items: Announcement[],
  ctx: AnnouncementFilterContext,
): Announcement[] {
  const out: Announcement[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue;
    if (ctx.dismissed[item.id]) continue;
    if (item.expires_at) {
      const expiresMs = Date.parse(item.expires_at);
      if (!Number.isNaN(expiresMs) && expiresMs <= ctx.now) continue;
    }
    if (item.affects?.min_version && ctx.appVersion) {
      if (compareVersions(ctx.appVersion, item.affects.min_version) < 0) continue;
    }
    // Provider filter: only when caller supplied the user's provider set.
    // `all` provider is always relevant. `affects.providers` overrides the
    // top-level provider if present.
    if (ctx.userProviders) {
      const required = item.affects?.providers ?? [item.provider];
      const relevant = required.some((p) => p === 'all' || ctx.userProviders!.has(p));
      if (!relevant) continue;
    }
    out.push(item);
  }
  out.sort((a, b) => {
    const rs = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (rs !== 0) return rs;
    const at = a.occurs_at ? Date.parse(a.occurs_at) : Number.POSITIVE_INFINITY;
    const bt = b.occurs_at ? Date.parse(b.occurs_at) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
  return out;
}

/** Pick the best localized field. Order: current locale → en → zh → undefined. */
export function pickLocalized(field: AnnouncementLocalized | undefined, locale: 'zh' | 'en'): string {
  if (!field) return '';
  return field[locale] ?? field.en ?? field.zh ?? '';
}

/** Endpoint URL — env override, default to vibemeter.siney.top. */
export function announcementsUrl(): string {
  const env =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_VIBEMETER_ANNOUNCEMENTS_URL;
  return env && env.length > 0 ? env : DEFAULT_URL;
}

export interface CachedAnnouncementPayload {
  etag: string | null;
  feed: AnnouncementFeed;
}

export function safeReadCache(): CachedAnnouncementPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const body = window.localStorage.getItem(LS_BODY);
    if (!body) return null;
    const feed = JSON.parse(body) as AnnouncementFeed;
    const etag = window.localStorage.getItem(LS_ETAG);
    return { etag, feed };
  } catch {
    return null;
  }
}

function safeWriteCache(etag: string | null, feed: AnnouncementFeed) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_BODY, JSON.stringify(feed));
    if (etag) window.localStorage.setItem(LS_ETAG, etag);
  } catch {
    // quota or private mode — ignore, we'll just re-fetch next time.
  }
}

/**
 * Fetch the feed honouring ETag. On 304 or network failure we return the
 * cached body (if any). Never throws — callers can treat `null` as "no data".
 */
export async function loadAnnouncements(url: string = announcementsUrl()): Promise<AnnouncementFeed | null> {
  const cached = safeReadCache();
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    const response = await fetch(url, { headers, cache: 'no-store' });
    if (response.status === 304 && cached) return cached.feed;
    if (!response.ok) return cached?.feed ?? null;
    const feed = (await response.json()) as AnnouncementFeed;
    if (!feed || typeof feed !== 'object' || !Array.isArray(feed.items)) {
      return cached?.feed ?? null;
    }
    const etag = response.headers.get('ETag');
    safeWriteCache(etag, feed);
    return feed;
  } catch {
    return cached?.feed ?? null;
  }
}

function readJsonRecord(key: string): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeJsonRecord(key: string, value: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function readDismissed(): Record<string, number> {
  return readJsonRecord(LS_DISMISSED);
}

export function readSeen(): Record<string, number> {
  return readJsonRecord(LS_SEEN);
}

export function dismissAnnouncement(id: string): Record<string, number> {
  const next = { ...readDismissed(), [id]: Date.now() };
  writeJsonRecord(LS_DISMISSED, next);
  return next;
}

export function markSeen(ids: string[]): Record<string, number> {
  if (ids.length === 0) return readSeen();
  const next = { ...readSeen() };
  const stamp = Date.now();
  for (const id of ids) next[id] = stamp;
  writeJsonRecord(LS_SEEN, next);
  return next;
}

// ── Notified bookkeeping (for fan-out dedup) ──────────────────────────────
// Same shape as dismissed/seen — `{ id → timestampMs }`. Stored separately so
// we never confuse "user manually closed it" (dismissed) with "we already
// pushed this once" (notified). 30-day max age, pruned on read.

export function readNotified(now: number = Date.now()): Record<string, number> {
  const raw = readJsonRecord(LS_NOTIFIED);
  return pruneNotified(raw, now);
}

/** Pure: drop entries older than NOTIFIED_MAX_AGE_MS. Exported for tests. */
export function pruneNotified(
  record: Record<string, number>,
  now: number,
): Record<string, number> {
  const cutoff = now - NOTIFIED_MAX_AGE_MS;
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(record)) {
    if (typeof ts === 'number' && ts >= cutoff) out[id] = ts;
  }
  return out;
}

export function recordNotified(ids: string[], now: number = Date.now()): Record<string, number> {
  if (ids.length === 0) return readNotified(now);
  const next = pruneNotified(readJsonRecord(LS_NOTIFIED), now);
  for (const id of ids) next[id] = now;
  writeJsonRecord(LS_NOTIFIED, next);
  return next;
}

// ── User prefs (fan-out routing) ──────────────────────────────────────────
// urgent → system notification is hard-coded ON and not stored here; the
// settings panel surfaces it as a read-only toggle so the user understands
// the contract.

export interface AnnouncementPrefs {
  /** urgent → webhook channels. Default true; can be opted out. */
  urgentWebhook: boolean;
  /** warn → system notification. Default false. */
  warnSystem: boolean;
  /** warn → webhook channels. Default false. */
  warnWebhook: boolean;
}

export const DEFAULT_ANNOUNCEMENT_PREFS: AnnouncementPrefs = {
  urgentWebhook: true,
  warnSystem: false,
  warnWebhook: false,
};

export function readAnnouncementPrefs(): AnnouncementPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  try {
    const raw = window.localStorage.getItem(LS_PREFS);
    if (!raw) return { ...DEFAULT_ANNOUNCEMENT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AnnouncementPrefs>;
    return {
      urgentWebhook: typeof parsed.urgentWebhook === 'boolean' ? parsed.urgentWebhook : DEFAULT_ANNOUNCEMENT_PREFS.urgentWebhook,
      warnSystem: typeof parsed.warnSystem === 'boolean' ? parsed.warnSystem : DEFAULT_ANNOUNCEMENT_PREFS.warnSystem,
      warnWebhook: typeof parsed.warnWebhook === 'boolean' ? parsed.warnWebhook : DEFAULT_ANNOUNCEMENT_PREFS.warnWebhook,
    };
  } catch {
    return { ...DEFAULT_ANNOUNCEMENT_PREFS };
  }
}

export function writeAnnouncementPrefs(prefs: AnnouncementPrefs): AnnouncementPrefs {
  if (typeof window === 'undefined') return prefs;
  try {
    window.localStorage.setItem(LS_PREFS, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
  return prefs;
}

// ── Fan-out planning ──────────────────────────────────────────────────────
// Pure decision helper: given the freshly fetched items, the per-id record of
// what we've already notified, and the user's prefs, return what to push and
// over which channel. Side effects (Notification API, webhook fetch, writing
// the notified record) live in the caller so this function is trivially
// testable under node --test.

export interface FanOutPlan {
  /** Items to push via Notification API. */
  system: Announcement[];
  /** Items to push via webhook channels. */
  webhook: Announcement[];
  /** Ids the caller should record as notified once side effects ran. */
  notifiedIds: string[];
}

export function planFanOut(
  items: Announcement[],
  notified: Record<string, number>,
  prefs: AnnouncementPrefs,
): FanOutPlan {
  const system: Announcement[] = [];
  const webhook: Announcement[] = [];
  const notifiedIds: string[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== 'string') continue;
    if (notified[item.id]) continue;
    let didAnything = false;
    if (item.severity === 'urgent') {
      // Urgent is always-on for system notifications.
      system.push(item);
      if (prefs.urgentWebhook) webhook.push(item);
      didAnything = true;
    } else if (item.severity === 'warn') {
      if (prefs.warnSystem) { system.push(item); didAnything = true; }
      if (prefs.warnWebhook) { webhook.push(item); didAnything = true; }
    }
    // info / notice never fan out.
    if (didAnything) notifiedIds.push(item.id);
  }
  return { system, webhook, notifiedIds };
}

/** Build the "[Vibemeter 情报｜severity] title\n\nbody\n\n来源: label (url)"
 *  payload that goes to both wxwork-markdown and generic JSON channels. */
export function formatAnnouncementMessage(
  item: Announcement,
  locale: 'zh' | 'en',
): { title: string; body: string } {
  const title = pickLocalized(item.title, locale) || item.id;
  const body = pickLocalized(item.body, locale);
  const sevLabel = locale === 'zh'
    ? ({ urgent: '紧急', warn: '警告', notice: '提示', info: '资讯' } as const)[item.severity]
    : ({ urgent: 'urgent', warn: 'warn', notice: 'notice', info: 'info' } as const)[item.severity];
  const brand = locale === 'zh' ? 'Vibemeter 情报' : 'Vibemeter intel';
  const headline = `[${brand}｜${sevLabel}] ${title}`;
  const lines: string[] = [];
  if (body) lines.push(body);
  const sourceLabel = item.source?.label ?? item.source?.url;
  if (sourceLabel) {
    const srcKey = locale === 'zh' ? '来源' : 'Source';
    const url = item.source?.url ? ` (${item.source.url})` : '';
    lines.push(`${srcKey}: ${sourceLabel}${url}`);
  }
  return { title: headline, body: lines.join('\n\n') };
}

/**
 * Side-effect runner for fan-out. Reads the user's prefs + notified record,
 * plans the push, fires Notification API + webhook calls, then commits the
 * notified record. Safe to call repeatedly: dedup is keyed off the persisted
 * id set, so a refetch with the same items is a no-op.
 *
 * SSR-safe: bails out the moment it sees `typeof window === 'undefined'`.
 * Failures are swallowed — announcements are non-critical UI; we never let a
 * webhook 500 or a permission-denied Notification crash the dashboard tree.
 */
export async function runAnnouncementFanOut(items: Announcement[]): Promise<void> {
  if (typeof window === 'undefined') return;
  if (items.length === 0) return;
  const prefs = readAnnouncementPrefs();
  const notified = readNotified();
  const plan = planFanOut(items, notified, prefs);
  if (plan.notifiedIds.length === 0) return;

  const locale = readLocaleFromDocument();

  // 1) System notifications. Permission must already be granted — we never
  // auto-prompt; the Settings panel has an explicit "Enable" button. If the
  // user denied or hasn't decided, we silently skip system pushes (webhook
  // routing still runs).
  if (plan.system.length > 0 && hasNotificationPermission()) {
    for (const item of plan.system) {
      try {
        const { title, body } = formatAnnouncementMessage(item, locale);
        const note = new window.Notification(title, {
          body,
          tag: `vibemeter-ann-${item.id}`,
          // re-use the id as a renotify guard at the OS level too
          renotify: false,
        } as NotificationOptions);
        note.onclick = () => {
          try { window.focus(); } catch { /* noop */ }
          const url = item.source?.url;
          if (url) {
            try { window.open(url, '_blank', 'noopener'); } catch { /* noop */ }
          }
        };
      } catch {
        // ignore one-off Notification errors per item
      }
    }
  }

  // 2) Webhook fan-out. Hit our API which has access to the secret webhook
  // values (the client never sees the plaintext URL). We POST once per item
  // and let the server iterate channels.
  if (plan.webhook.length > 0) {
    await Promise.all(plan.webhook.map(async (item) => {
      try {
        await fetch('/api/announcements/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item, locale }),
        });
      } catch {
        // network failures are non-fatal; user still sees the banner.
      }
    }));
  }

  // 3) Commit the notified record only after we've at least *attempted* the
  // pushes above. Doing it eagerly means a transient webhook 500 doesn't
  // cause a duplicate push on the next refetch — that's acceptable; the
  // user has the banner regardless.
  recordNotified(plan.notifiedIds);
}

function hasNotificationPermission(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;
  return window.Notification.permission === 'granted';
}

function readLocaleFromDocument(): 'zh' | 'en' {
  if (typeof document === 'undefined') return 'zh';
  // Mirror the cookie name from '@/lib/i18n/types' (LOCALE_COOKIE). Hardcoded
  // here to keep this module dependency-free for unit tests under node --test.
  const match = document.cookie.match(/(?:^|;\s*)vibemeter_locale=([^;]+)/);
  const v = match ? decodeURIComponent(match[1]) : '';
  return v === 'en' ? 'en' : 'zh';
}

export const APP_VERSION = readAppVersion();

function readAppVersion(): string | null {
  // package.json is statically available at build time — Next bundles it via
  // a JSON import, but here we'd rather not eagerly bundle the whole file, so
  // we expose the version through a Next env override if set, else fall back
  // to a baked-in constant matching the current release line.
  const env =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_VIBEMETER_VERSION;
  if (env && env.length > 0) return env;
  return null;
}

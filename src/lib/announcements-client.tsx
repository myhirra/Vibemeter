'use client';

// React hook that wires the announcements feed into a component tree. The
// pure helpers + side-effect runner live in `./announcements.ts` so they can
// be imported from server route handlers without dragging React into the
// server bundle.
//
// Fetches once on mount, polls every 15 min, and refetches on window focus.
// Caller can pass the user's provider set to scope the feed; pass `null` (or
// omit) to show items for every provider. `now` is tracked as a ticking state
// so filter results stay fresh as items cross their `expires_at` while the
// dashboard is open.

import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import {
  APP_VERSION,
  POLL_INTERVAL_MS,
  dismissAnnouncement,
  filterAnnouncements,
  loadAnnouncements,
  markSeen,
  readDismissed,
  readSeen,
  runAnnouncementFanOut,
  safeReadCache,
  type Announcement,
  type AnnouncementFeed,
} from './announcements';

export interface UseAnnouncementsOptions {
  /**
   * Providers the user has any data for. Callers that don't know this can
   * pass `null` to skip the provider filter entirely.
   */
  userProviders?: ReadonlySet<string> | null;
}

export interface UseAnnouncementsResult {
  /** Filtered, sorted list — ready to render. */
  items: Announcement[];
  /** Raw feed (for debugging / future surfaces). */
  feed: AnnouncementFeed | null;
  /** Loading state for the very first fetch only. */
  loading: boolean;
  dismissed: Record<string, number>;
  seen: Record<string, number>;
  dismiss: (id: string) => void;
  /** Mark ids as seen (so the floater's unread dot disappears). */
  markSeen: (ids: string[]) => void;
  /** Force a refresh (e.g. after manual user action). */
  refetch: () => Promise<void>;
}

export function useAnnouncements(options: UseAnnouncementsOptions = {}): UseAnnouncementsResult {
  const userProviders = options.userProviders ?? null;
  const providersKey = useMemo(() => {
    if (userProviders == null) return '__null__';
    return [...userProviders].sort().join(',');
  }, [userProviders]);

  const [feed, setFeed] = useState<AnnouncementFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState<Record<string, number>>({});
  // 0 sentinel until first effect tick so SSR / hydration agree; we re-tick
  // every minute to keep `expires_at` filtering accurate.
  const [now, setNow] = useState(0);

  // Hydrate dismissed/seen from localStorage once on mount and start ticking
  // `now` so filter results stay fresh. State writes are wrapped in
  // startTransition to keep React from flagging them as cascading renders.
  useEffect(() => {
    startTransition(() => {
      setDismissed(readDismissed());
      setSeen(readSeen());
      setNow(Date.now());
    });
    const id = window.setInterval(
      () => startTransition(() => setNow(Date.now())),
      60_000,
    );
    return () => window.clearInterval(id);
  }, []);

  const refetch = useCallback(async () => {
    const next = await loadAnnouncements();
    if (next) setFeed(next);
    setLoading(false);
  }, []);

  // Initial load (also reads the cache so we paint immediately if the network
  // is slow). Pre-seed feed from the cache so the first render isn't blank.
  useEffect(() => {
    const cached = safeReadCache();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached) setFeed(cached.feed);
    void refetch();
  }, [refetch]);

  // Poll + focus refresh.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setInterval(() => void refetch(), POLL_INTERVAL_MS);
    const onFocus = () => void refetch();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refetch]);

  const items = useMemo(() => {
    if (!feed) return [];
    // Fall back to a far-future epoch until the mount tick fires so
    // expires_at items aren't briefly hidden during SSR hydration.
    const nowOrPaint = now > 0 ? now : Number.NEGATIVE_INFINITY;
    return filterAnnouncements(feed.items, {
      appVersion: APP_VERSION,
      userProviders,
      dismissed,
      now: nowOrPaint,
    });
    // providersKey participates so we recompute when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, dismissed, providersKey, now]);

  // Fan-out side effect — runs whenever the filtered list changes. We let
  // the items list settle first (now > 0 means hydration finished) so we
  // don't fire on the SSR snapshot, then we plan + push. The actual side
  // effects live in `runAnnouncementFanOut`, kept impure on purpose so the
  // pure `planFanOut` stays trivially testable.
  useEffect(() => {
    if (now <= 0 || items.length === 0) return;
    void runAnnouncementFanOut(items);
  }, [items, now]);

  const dismiss = useCallback((id: string) => {
    setDismissed(dismissAnnouncement(id));
  }, []);

  const mark = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    // The localStorage write is the source of truth; React state is just so
    // consumers re-render. The dependency analyzer can't see through the
    // helper so we declare it explicitly.
    setSeen((current) => {
      const next = markSeen(ids);
      const same = ids.every((id) => current[id] === next[id]);
      return same ? current : next;
    });
  }, []);

  return {
    items,
    feed,
    loading,
    dismissed,
    seen,
    dismiss,
    markSeen: mark,
    refetch,
  };
}

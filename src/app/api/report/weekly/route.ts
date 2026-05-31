import { NextResponse } from 'next/server';
import { getServerLocale } from '@/lib/i18n/server';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { buildWeeklyReport, type WeeklyReport } from '@/lib/report/weekly';
import {
  isoWeekFromDate,
  isoWeekWindow,
  parseIsoWeek,
} from '@/lib/report/iso-week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── In-memory cache ────────────────────────────────────────────────────────
// Keyed by (`weekIso`, `locale`). 5-min TTL so Pro users see fresh numbers on
// every other dashboard load but back-to-back nav re-fetches don't re-run the
// SQL. The cache is per-process; Vibemeter's Next.js runs on a single Node
// process so this is safe enough.
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  payload: WeeklyReport;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(weekIso: string, locale: string): string {
  return `${weekIso}::${locale}`;
}

export async function GET(request: Request) {
  // Mirror the existing /api/report route: pull the latest snapshots before
  // answering so the metrics aren't stale-by-design. A trickle of new rows is
  // a tens-of-ms cost.
  importUsageSnapshots();

  const url = new URL(request.url);
  const weekParam = url.searchParams.get('week');
  const locale = await getServerLocale();
  const now = new Date();

  // ?week=2026-W22 — validated below. Defaults to the ISO week containing `now`.
  let weekIso: string;
  let weekOffset: number;
  if (weekParam == null) {
    const here = isoWeekFromDate(now);
    weekIso = here.iso;
    weekOffset = 0;
  } else {
    const parsed = parseIsoWeek(weekParam);
    if (!parsed) {
      return NextResponse.json(
        { error: 'invalid ?week — expected YYYY-Www (e.g. 2026-W22)' },
        { status: 400 },
      );
    }
    const here = isoWeekFromDate(now);
    weekIso = parsed.iso;
    // Translate the asked week into a `weekOffset` relative to current. We
    // compute the offset as (target.start - current.start) / 7d so DST nights
    // don't push us off by one.
    const targetStart = isoWeekWindow(parsed.year, parsed.week).startMs;
    const currentStart = isoWeekWindow(here.year, here.week).startMs;
    const diffDays = Math.round((targetStart - currentStart) / 86_400_000);
    weekOffset = Math.round(diffDays / 7);
    if (weekOffset > 0) {
      return NextResponse.json(
        { error: 'future weeks are not supported' },
        { status: 400 },
      );
    }
  }

  const key = cacheKey(weekIso, locale);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(hit.payload);
  }

  const report = buildWeeklyReport({ now, weekOffset, locale });
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload: report });
  return NextResponse.json(report);
}

/**
 * Test-only hook: lets the test runner clear the in-memory cache between
 * cases. Not exported via any public boundary — production code never imports
 * the route module directly.
 */
export function __resetCacheForTests() {
  cache.clear();
}

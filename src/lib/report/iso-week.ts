// ISO calendar week math (Mon 00:00 local → next Mon 00:00). Pure; no DB / no
// Date.now() inside the helpers — callers pass `now` in so tests can pin the
// clock without monkey-patching globals.
//
// We didn't find an existing ISO-week helper in the repo (stats.ts uses
// rolling 7d windows for momentum, on purpose), so this module owns the math.

export interface IsoWeek {
  year: number;
  week: number;
  /** "2026-W22" — zero-padded week, matches the `?week=` API parameter. */
  iso: string;
}

export interface IsoWeekWindow extends IsoWeek {
  /** Local-time Mon 00:00 of this ISO week (inclusive). */
  startMs: number;
  /** Local-time Mon 00:00 of the *next* ISO week (exclusive). */
  endMs: number;
}

const DAY_MS = 86_400_000;

/**
 * ISO-week year + week number for a given local-time `Date`. Follows ISO 8601:
 * weeks start Monday; week 1 is the week containing the year's first Thursday.
 *
 * Derived by walking to the Thursday of the same week (so the "which year" is
 * unambiguous) and counting days from Jan 1 of that year.
 */
export function isoWeekFromDate(d: Date): IsoWeek {
  // Local-time copy at midnight so DST offsets in the input don't shift the
  // weekday calc by an hour.
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // 1..7, Mon = 1, Sun = 7 (matches ISO).
  const dayNum = ((target.getDay() + 6) % 7) + 1;
  // Roll to the Thursday of this ISO week.
  target.setDate(target.getDate() + (4 - dayNum));
  const year = target.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = 1 + Math.round((target.getTime() - jan1.getTime()) / DAY_MS / 7);
  return { year, week, iso: formatIso(year, week) };
}

export function formatIso(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Parse "YYYY-Www". Returns null on bad input — callers decide whether to 400.
 */
export function parseIsoWeek(value: string): IsoWeek | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  if (week < 1 || week > 53) return null;
  return { year, week, iso: formatIso(year, week) };
}

/**
 * Local-time Monday 00:00 of (year, week). Walks from Jan 4 (always in ISO
 * week 1 of that year) to the requested week's Monday.
 */
export function isoWeekStart(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const jan4Day = ((jan4.getDay() + 6) % 7) + 1;
  const week1Monday = new Date(year, 0, 4 - (jan4Day - 1));
  return new Date(
    week1Monday.getFullYear(),
    week1Monday.getMonth(),
    week1Monday.getDate() + (week - 1) * 7,
  );
}

/**
 * Window for an ISO week ⇒ `[Mon 00:00 local, next Mon 00:00 local)`.
 */
export function isoWeekWindow(year: number, week: number): IsoWeekWindow {
  const start = isoWeekStart(year, week);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return {
    year,
    week,
    iso: formatIso(year, week),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

/**
 * Apply `offset` to a base ISO week, returning the resulting ISO week. We do
 * the math via Monday-of-week + 7*offset days so year rollover is handled by
 * the Date constructor.
 *
 *   offset =  0 → same week
 *   offset = -1 → previous week
 *   offset = +1 → next week
 */
export function shiftIsoWeek(year: number, week: number, offset: number): IsoWeek {
  const start = isoWeekStart(year, week);
  const shifted = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + offset * 7,
  );
  return isoWeekFromDate(shifted);
}

/**
 * Convenience: ISO week that contains `now`, then shifted by `offset`. The
 * callable shape mirrors `buildWeeklyReport`'s `{ now, weekOffset }` inputs.
 */
export function resolveIsoWeek(now: Date, offset: number): IsoWeek {
  const here = isoWeekFromDate(now);
  if (offset === 0) return here;
  return shiftIsoWeek(here.year, here.week, offset);
}

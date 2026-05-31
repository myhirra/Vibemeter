import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isoWeekFromDate,
  isoWeekStart,
  isoWeekWindow,
  parseIsoWeek,
  resolveIsoWeek,
  shiftIsoWeek,
} from '../src/lib/report/iso-week.ts';

// ── Parse ──────────────────────────────────────────────────────────────────

test('parseIsoWeek: well-formed input round-trips', () => {
  const parsed = parseIsoWeek('2026-W22');
  assert.deepEqual(parsed, { year: 2026, week: 22, iso: '2026-W22' });
});

test('parseIsoWeek: rejects malformed inputs', () => {
  assert.equal(parseIsoWeek(''), null);
  assert.equal(parseIsoWeek('2026'), null);
  assert.equal(parseIsoWeek('2026-W1'), null);   // missing zero pad
  assert.equal(parseIsoWeek('2026-22'), null);   // missing W
  assert.equal(parseIsoWeek('20a6-W22'), null);
  assert.equal(parseIsoWeek('2026-W00'), null);  // week 0 invalid
  assert.equal(parseIsoWeek('2026-W54'), null);  // week >53 invalid
});

test('parseIsoWeek: rejects W53 in years that do not have one', () => {
  // 2025 is a 52-week ISO year (Jan 1 was Wednesday, not leap). W53 must reject
  // instead of silently rolling over to 2026-W01.
  assert.equal(parseIsoWeek('2025-W53'), null);
  // 2026 IS a 53-week ISO year (Jan 1 is Thursday) — W53 must round-trip.
  assert.deepEqual(parseIsoWeek('2026-W53'), { year: 2026, week: 53, iso: '2026-W53' });
});

// ── isoWeekFromDate ────────────────────────────────────────────────────────

test('isoWeekFromDate: Monday lands in the week starting that Monday', () => {
  // 2026-06-01 is a Monday → ISO 2026-W23
  const monday = new Date(2026, 5, 1);
  const w = isoWeekFromDate(monday);
  assert.equal(w.iso, '2026-W23');
});

test('isoWeekFromDate: Sunday of the same week is still W23', () => {
  // 2026-06-07 is Sunday → still W23
  const sunday = new Date(2026, 5, 7);
  const w = isoWeekFromDate(sunday);
  assert.equal(w.iso, '2026-W23');
});

test('isoWeekFromDate: New Year edge — 2025-12-29 is W1 of 2026', () => {
  // 2025-12-29 is a Monday; per ISO it belongs to week 1 of 2026 because
  // its Thursday (2026-01-01) is in 2026.
  const date = new Date(2025, 11, 29);
  const w = isoWeekFromDate(date);
  assert.equal(w.year, 2026);
  assert.equal(w.week, 1);
});

test('isoWeekFromDate: 2025-01-01 (a Wednesday) is week 1 of 2025', () => {
  const date = new Date(2025, 0, 1);
  const w = isoWeekFromDate(date);
  assert.equal(w.iso, '2025-W01');
});

// ── isoWeekStart / isoWeekWindow ───────────────────────────────────────────

test('isoWeekStart: week 1 Monday', () => {
  // 2026-W01 Monday is 2025-12-29.
  const start = isoWeekStart(2026, 1);
  assert.equal(start.getFullYear(), 2025);
  assert.equal(start.getMonth(), 11);
  assert.equal(start.getDate(), 29);
  assert.equal(start.getHours(), 0);
});

test('isoWeekWindow: span covers exactly 7 days', () => {
  const w = isoWeekWindow(2026, 23);
  const diffDays = (w.endMs - w.startMs) / 86_400_000;
  // Floating-point on DST nights can land at 6.96 or 7.04 — round before asserting.
  assert.equal(Math.round(diffDays), 7);
});

// ── shiftIsoWeek / resolveIsoWeek ──────────────────────────────────────────

test('shiftIsoWeek: previous week handles month boundary', () => {
  // 2026-06-01 is Monday of W23. Shift -1 → W22 (Mon May 25).
  const w = shiftIsoWeek(2026, 23, -1);
  assert.equal(w.iso, '2026-W22');
});

test('shiftIsoWeek: previous week handles year boundary', () => {
  // 2026-W01 Mon is 2025-12-29. Shift -1 should land in 2025-W52 (Mon 2025-12-22).
  const w = shiftIsoWeek(2026, 1, -1);
  assert.equal(w.year, 2025);
});

test('resolveIsoWeek: offset 0 returns the containing week', () => {
  const d = new Date(2026, 5, 3);
  const w = resolveIsoWeek(d, 0);
  assert.equal(w.iso, '2026-W23');
});

test('resolveIsoWeek: offset -2 returns two weeks earlier', () => {
  const d = new Date(2026, 5, 3); // W23
  const w = resolveIsoWeek(d, -2);
  assert.equal(w.iso, '2026-W21');
});

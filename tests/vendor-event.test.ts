/**
 * Tests for the vendor_event alert evaluator — detects vendor-initiated bulk
 * resets (e.g. Anthropic's 2026-05-15 "we reset everyone's counters" event)
 * by comparing the two most recent usage snapshots.
 *
 * We isolate the SQLite layer with an in-memory database that mirrors the
 * `usage_snapshots` schema, and call `evaluateVendorEvent` directly with a
 * stubbed `VendorEventDeps.db` so no real DB bootstrap runs.
 */

import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

register('./_resolve.mjs', import.meta.url);

const { evaluateVendorEvent } = await import('../src/lib/alerts/runner.ts');
const { insertUsageSnapshot } = await import('../src/lib/usage-snapshots.ts');

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      account_id TEXT,
      window_5h_used_pct REAL,
      window_weekly_used_pct REAL,
      reset_at_5h INTEGER,
      reset_at_weekly INTEGER,
      raw_output TEXT,
      confidence TEXT NOT NULL
    );
  `);
  return db;
}

const DAY = 86_400_000;
const T = 1_780_000_000_000;

const RULE = {
  id: 'r1',
  kind: 'vendor_event' as const,
  metric: 'claude_weekly' as const,
  minUsedPctBefore: 5,
  maxUsedPctAfter: 1,
  channelIds: ['c1'],
  enabled: true,
};

function snap(db: Database.Database, capturedAt: number, usedPct: number, resetAt: number) {
  insertUsageSnapshot(db, {
    capturedAt,
    source: 'statusline',
    accountId: null,
    window5hUsedPct: null,
    windowWeeklyUsedPct: usedPct,
    resetAt5h: null,
    resetAtWeekly: resetAt,
    rawOutput: null,
    confidence: 'high',
  });
}

test('fires when used_pct collapses to 0 before the previously scheduled reset_at', () => {
  const db = memoryDb();
  snap(db, T - DAY, 45, T + DAY); // had real usage; scheduled to reset 1 day out
  snap(db, T, 0, T + 7 * DAY); // observed BEFORE prev reset_at; vendor pushed new window

  const r = evaluateVendorEvent(RULE, undefined, { db, codexAccountId: null }, 'zh');
  assert.ok(r, 'expected to fire');
  assert.equal(r!.nextState.kind, 'vendor_event');
  assert.ok(r!.title.includes('Claude'));
});

test('does NOT fire on natural rollover (newest observation after prev reset_at)', () => {
  const db = memoryDb();
  // prev was scheduled to reset at T - 1s, then we observe at T after the
  // natural expiry — used_pct legitimately rolled over on its own.
  snap(db, T - DAY, 50, T - 1000);
  snap(db, T, 0, T + 7 * DAY);

  const r = evaluateVendorEvent(RULE, undefined, { db, codexAccountId: null }, 'zh');
  assert.equal(r, null);
});

test('does NOT fire when older snapshot had no meaningful usage', () => {
  const db = memoryDb();
  snap(db, T - DAY, 1, T + DAY); // below minUsedPctBefore = 5
  snap(db, T, 0, T + 7 * DAY);

  const r = evaluateVendorEvent(RULE, undefined, { db, codexAccountId: null }, 'zh');
  assert.equal(r, null);
});

test('does NOT fire when reset_at did not advance', () => {
  const db = memoryDb();
  snap(db, T - DAY, 45, T + DAY);
  snap(db, T, 0, T + DAY); // same reset_at — could be a local zero hiccup, not vendor push

  const r = evaluateVendorEvent(RULE, undefined, { db, codexAccountId: null }, 'zh');
  assert.equal(r, null);
});

test('dedupes when state.lastFiredForResetAt matches the new reset_at', () => {
  const db = memoryDb();
  snap(db, T - DAY, 45, T + DAY);
  snap(db, T, 0, T + 7 * DAY);

  const r = evaluateVendorEvent(
    RULE,
    { kind: 'vendor_event', lastFiredForResetAt: T + 7 * DAY },
    { db, codexAccountId: null },
    'zh',
  );
  assert.equal(r, null);
});

test('returns null when there is only one snapshot available', () => {
  const db = memoryDb();
  snap(db, T, 0, T + 7 * DAY);

  const r = evaluateVendorEvent(RULE, undefined, { db, codexAccountId: null }, 'zh');
  assert.equal(r, null);
});

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import test from 'node:test';

import { getLatestUsageSnapshot, insertUsageSnapshot } from '../src/lib/usage-snapshots.ts';

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

test('Codex usage lookup is scoped to the selected account without falling back to global rows', () => {
  const db = memoryDb();

  insertUsageSnapshot(db, {
    capturedAt: 100,
    source: 'codex',
    accountId: null,
    window5hUsedPct: 63,
    windowWeeklyUsedPct: 29,
    resetAt5h: null,
    resetAtWeekly: null,
    rawOutput: null,
    confidence: 'high',
  });
  insertUsageSnapshot(db, {
    capturedAt: 200,
    source: 'codex',
    accountId: 'acct-a',
    window5hUsedPct: 2,
    windowWeeklyUsedPct: 0,
    resetAt5h: null,
    resetAtWeekly: null,
    rawOutput: null,
    confidence: 'high',
  });

  assert.equal(getLatestUsageSnapshot(db, 'codex', 'acct-a')?.window_5h_used_pct, 2);
  assert.equal(getLatestUsageSnapshot(db, 'codex', 'acct-b'), null);
  assert.equal(getLatestUsageSnapshot(db, 'codex')?.window_5h_used_pct, 2);

  db.close();
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';

test('database bootstrap adds usage account_id before creating account-scoped index', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vibemeter-db-'));
  const dbPath = path.join(root, 'continuity.sqlite');
  const oldDb = new Database(dbPath);
  oldDb.exec(`
    CREATE TABLE usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      window_5h_used_pct REAL,
      window_weekly_used_pct REAL,
      reset_at_5h INTEGER,
      reset_at_weekly INTEGER,
      raw_output TEXT,
      confidence TEXT NOT NULL
    );
  `);
  oldDb.close();

  const { bootstrap } = await import('../src/lib/db-bootstrap.ts');
  const db = new Database(dbPath);
  bootstrap(db);
  const columns = db.prepare(`PRAGMA table_info(usage_snapshots)`).all() as { name: string }[];
  const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
  const indexes = db.prepare(`PRAGMA index_list(usage_snapshots)`).all() as { name: string }[];

  assert.equal(columns.some((column) => column.name === 'account_id'), true);
  assert.equal(sessionColumns.some((column) => column.name === 'prompt_count'), true);
  assert.equal(indexes.some((index) => index.name === 'idx_usage_source_account_captured'), true);
});

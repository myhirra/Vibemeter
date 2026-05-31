import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

// Qoder is a VS Code-based AI IDE, so its chat/session data most likely lives
// in a VS Code-style `state.vscdb` under the app's globalStorage — the same
// shape Cursor uses (`cursorDiskKV` keyed `composerData:<id>`). This was NOT
// verifiable on the dev machine (Qoder not installed), so this importer is
// best-effort: it reads the Cursor-style table when present and is a clean
// no-op otherwise. If Qoder uses a different key/table, the SELECT simply
// returns nothing and no rows are written — adjust here once confirmed on a
// real Qoder install.
const QODER_GLOBAL_DB = path.join(
  os.homedir(),
  'Library/Application Support/Qoder/User/globalStorage/state.vscdb',
);

export function importQoderSessions(): void {
  if (!fs.existsSync(QODER_GLOBAL_DB)) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');

  let rows: { key: string; value: Buffer | string }[];
  try {
    const gdb = new BetterSqlite(QODER_GLOBAL_DB, { readonly: true });
    const hasTable = gdb.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'`,
    ).get();
    if (!hasTable) { gdb.close(); return; }
    rows = gdb.prepare(
      `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`,
    ).all() as { key: string; value: Buffer | string }[];
    gdb.close();
  } catch { return; }

  if (!rows.length) return;

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, confidence)
    VALUES (@id, 'qoder', @started_at, @ended_at, NULL, @ai_title, 'medium')
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      ai_title = COALESCE(sessions.ai_title, excluded.ai_title)
  `);
  db.transaction(() => {
    for (const r of rows) {
      let data: { composerId?: string; createdAt?: number; lastUpdatedAt?: number; name?: string; text?: string };
      try {
        data = JSON.parse(typeof r.value === 'string' ? r.value : r.value.toString('utf8'));
      } catch { continue; }
      const id = data.composerId || r.key.slice('composerData:'.length);
      if (!id || !data.createdAt) continue;
      upsert.run({
        id,
        started_at: data.createdAt,
        ended_at: data.lastUpdatedAt ?? data.createdAt,
        ai_title: data.name || (data.text ? data.text.slice(0, 120) : null),
      });
    }
  })();
}

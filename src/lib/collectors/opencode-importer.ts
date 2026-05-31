import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

// OpenCode stores its sessions in a SQLite db at
//   ~/.local/share/opencode/opencode.db  → `session` table
// with ms timestamps (time_created / time_updated), a title, and the project
// directory. Sub-agent runs are child sessions (parent_id set); we only import
// top-level sessions so the count matches real conversations. No quota/token
// data, so OpenCode shows as session activity in the combined dashboard view.
const OPENCODE_DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

interface OpenCodeSessionRow {
  id: string;
  title: string | null;
  directory: string | null;
  time_created: number | null;
  time_updated: number | null;
}

export function importOpenCodeSessions(): void {
  if (!fs.existsSync(OPENCODE_DB)) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');

  let rows: OpenCodeSessionRow[];
  try {
    const ocdb = new BetterSqlite(OPENCODE_DB, { readonly: true });
    const hasTable = ocdb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='session'`).get();
    if (!hasTable) { ocdb.close(); return; }
    rows = ocdb.prepare(
      `SELECT id, title, directory, time_created, time_updated
       FROM session
       WHERE parent_id IS NULL`,
    ).all() as OpenCodeSessionRow[];
    ocdb.close();
  } catch { return; } // db locked / unreadable — skip this pass

  if (!rows.length) return;

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, confidence)
    VALUES (@id, 'opencode', @started_at, @ended_at, @cwd, @ai_title, 'high')
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      cwd      = COALESCE(sessions.cwd, excluded.cwd),
      ai_title = COALESCE(sessions.ai_title, excluded.ai_title)
  `);
  db.transaction(() => {
    for (const r of rows) {
      if (!r.id || !r.time_created) continue;
      upsert.run({
        id: r.id,
        started_at: r.time_created,
        ended_at: r.time_updated ?? r.time_created,
        cwd: r.directory ?? null,
        ai_title: r.title ?? null,
      });
    }
  })();
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

const CURSOR_BASE = path.join(
  os.homedir(),
  'Library/Application Support/Cursor/User'
);
const CURSOR_WS = path.join(CURSOR_BASE, 'workspaceStorage');
const CURSOR_GLOBAL_DB = path.join(CURSOR_BASE, 'globalStorage/state.vscdb');

interface ComposerEntry {
  composerId: string;
  createdAt: number;
  name?: string;
  unifiedMode?: string;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  isArchived?: boolean;
}

interface ComposerData {
  allComposers?: ComposerEntry[];
}

export function importCursorSessions(): void {
  if (!fs.existsSync(CURSOR_WS)) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, confidence)
    VALUES (@id, 'cursor', @started_at, @ended_at, @cwd, @ai_title, 'high')
    ON CONFLICT(id) DO UPDATE SET
      ended_at = excluded.ended_at,
      cwd      = COALESCE(sessions.cwd, excluded.cwd),
      ai_title = COALESCE(sessions.ai_title, excluded.ai_title)
  `);

  let dirs: string[];
  try { dirs = fs.readdirSync(CURSOR_WS); } catch { return; }

  const importAll = db.transaction(() => {
    for (const dir of dirs) {
      const vscdb = path.join(CURSOR_WS, dir, 'state.vscdb');
      const wsJson = path.join(CURSOR_WS, dir, 'workspace.json');
      if (!fs.existsSync(vscdb)) continue;

      let folder: string | null = null;
      try {
        const ws = JSON.parse(fs.readFileSync(wsJson, 'utf8')) as { folder?: string };
        folder = ws.folder?.replace('file://', '') ?? null;
      } catch { /* ok */ }

      try {
        const cdb = new BetterSqlite(vscdb, { readonly: true });
        const row = cdb.prepare(
          `SELECT value FROM ItemTable WHERE key = 'composer.composerData'`
        ).get() as { value: string } | undefined;
        cdb.close();
        if (!row) continue;

        const data = JSON.parse(row.value) as ComposerData;
        const composers = data.allComposers ?? [];

        for (const c of composers) {
          if (!c.composerId || !c.createdAt) continue;
          upsert.run({
            id: c.composerId,
            started_at: c.createdAt,
            ended_at: c.createdAt, // Cursor doesn't record end time
            cwd: folder,
            ai_title: c.name ?? null,
          });
        }
      } catch { /* corrupt db, skip */ }
    }
  });

  importAll();

  // 2026 onwards: Cursor migrated composers to a single global `cursorDiskKV`
  // table inside ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb.
  // Per-workspace storage above only covers pre-migration data; we read the new
  // table here too. Upsert dedupes on composerId.
  if (fs.existsSync(CURSOR_GLOBAL_DB)) {
    try {
      const gdb = new BetterSqlite(CURSOR_GLOBAL_DB, { readonly: true });
      // Check the table exists before querying (older Cursor versions won't have it).
      const hasTable = gdb.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'`,
      ).get();
      if (hasTable) {
        const rows = gdb.prepare(
          `SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`,
        ).all() as { key: string; value: Buffer | string }[];

        const importGlobal = db.transaction(() => {
          for (const r of rows) {
            const id = r.key.slice('composerData:'.length);
            let data: { composerId?: string; createdAt?: number; lastUpdatedAt?: number; name?: string; text?: string };
            try {
              data = JSON.parse(typeof r.value === 'string' ? r.value : r.value.toString('utf8'));
            } catch { continue; }
            const composerId = data.composerId || id;
            const createdAt = data.createdAt;
            if (!composerId || !createdAt) continue;
            const endedAt = data.lastUpdatedAt ?? createdAt;
            const aiTitle = data.name || (data.text ? data.text.slice(0, 120) : null);
            upsert.run({
              id: composerId,
              started_at: createdAt,
              ended_at: endedAt,
              cwd: null,
              ai_title: aiTitle,
            });
          }
        });
        importGlobal();
      }
      gdb.close();
    } catch { /* skip — corrupt or locked */ }
  }
}

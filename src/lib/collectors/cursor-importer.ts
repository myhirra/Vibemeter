import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

const CURSOR_WS = path.join(
  os.homedir(),
  'Library/Application Support/Cursor/User/workspaceStorage'
);

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
}

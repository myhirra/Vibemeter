import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const STATE_DB = path.join(CODEX_DIR, 'state_5.sqlite');
const HISTORY_PATH = path.join(CODEX_DIR, 'history.jsonl');

interface ThreadRow {
  id: string;
  created_at_ms: number;
  updated_at_ms: number;
  cwd: string | null;
  title: string | null;
  first_user_message: string | null;
  tokens_used: number | null;
  git_branch: string | null;
  model: string | null;
  archived: number;
}

function importFromStateDb(): boolean {
  if (!fs.existsSync(STATE_DB)) return false;
  try {
    // Use better-sqlite3 to read Codex's own SQLite
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');
    const codexDb = new BetterSqlite(STATE_DB, { readonly: true });

    const threads = codexDb.prepare(`
      SELECT id, created_at_ms, updated_at_ms, cwd, title, first_user_message,
             tokens_used, git_branch, model, archived
      FROM threads
      ORDER BY created_at_ms ASC
    `).all() as ThreadRow[];

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, tokens_used, confidence)
      VALUES (@id, 'codex', @started_at, @ended_at, @cwd, @ai_title, @tokens_used, 'high')
      ON CONFLICT(id) DO UPDATE SET
        ended_at    = excluded.ended_at,
        cwd         = COALESCE(sessions.cwd, excluded.cwd),
        ai_title    = COALESCE(sessions.ai_title, excluded.ai_title),
        tokens_used = excluded.tokens_used,
        confidence  = 'high'
    `);

    const importAll = db.transaction(() => {
      for (const t of threads) {
        upsert.run({
          id: t.id,
          started_at: t.created_at_ms,
          ended_at: t.updated_at_ms,
          cwd: t.cwd,
          ai_title: t.title ?? t.first_user_message?.slice(0, 120) ?? null,
          tokens_used: t.tokens_used,
        });
      }
    });
    importAll();
    codexDb.close();
    return true;
  } catch {
    return false;
  }
}

function importFromHistoryJsonl(): void {
  if (!fs.existsSync(HISTORY_PATH)) return;
  interface Entry { session_id: string; ts: number; }
  const bySession = new Map<string, { minTs: number; maxTs: number }>();
  try {
    for (const line of fs.readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line) as Entry;
        if (!e.session_id || !e.ts) continue;
        const cur = bySession.get(e.session_id);
        if (!cur) { bySession.set(e.session_id, { minTs: e.ts, maxTs: e.ts }); }
        else { if (e.ts < cur.minTs) cur.minTs = e.ts; if (e.ts > cur.maxTs) cur.maxTs = e.ts; }
      } catch { /* skip */ }
    }
  } catch { return; }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, confidence)
    VALUES (@id, 'codex', @started_at, @ended_at, 'medium')
    ON CONFLICT(id) DO NOTHING
  `);
  const importAll = db.transaction(() => {
    for (const [id, { minTs, maxTs }] of bySession) {
      upsert.run({ id, started_at: minTs * 1000, ended_at: maxTs * 1000 });
    }
  });
  importAll();
}

export function importCodexSessions(): void {
  const usedStateDb = importFromStateDb();
  if (!usedStateDb) importFromHistoryJsonl(); // fallback
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

// Gemini CLI keeps per-project conversation logs at
//   ~/.gemini/tmp/<project-hash>/logs.json
// as an array of { sessionId, messageId, type, message, timestamp } records.
// There's no quota/token data, so we surface Gemini purely as session activity
// in the dashboard's combined view — one session row per distinct sessionId.
const GEMINI_TMP = path.join(os.homedir(), '.gemini', 'tmp');

interface GeminiLogEntry {
  sessionId?: string;
  type?: string;
  message?: string;
  timestamp?: string;
}

interface Agg {
  startedAt: number;
  endedAt: number;
  prompts: number;
  title: string | null;
}

export function importGeminiSessions(): void {
  if (!fs.existsSync(GEMINI_TMP)) return;

  let dirs: string[];
  try { dirs = fs.readdirSync(GEMINI_TMP); } catch { return; }

  const sessions = new Map<string, Agg>();
  for (const dir of dirs) {
    const logsPath = path.join(GEMINI_TMP, dir, 'logs.json');
    let entries: GeminiLogEntry[];
    try {
      entries = JSON.parse(fs.readFileSync(logsPath, 'utf8')) as GeminiLogEntry[];
    } catch { continue; } // no logs.json (e.g. tmp/bin) or corrupt — skip
    if (!Array.isArray(entries)) continue;

    for (const e of entries) {
      if (!e.sessionId || !e.timestamp) continue;
      const ts = Date.parse(e.timestamp);
      if (Number.isNaN(ts)) continue;
      const agg = sessions.get(e.sessionId) ?? { startedAt: ts, endedAt: ts, prompts: 0, title: null };
      agg.startedAt = Math.min(agg.startedAt, ts);
      agg.endedAt = Math.max(agg.endedAt, ts);
      if (e.type === 'user') {
        agg.prompts += 1;
        if (!agg.title && typeof e.message === 'string' && e.message.trim()) {
          agg.title = e.message.trim().slice(0, 120);
        }
      }
      sessions.set(e.sessionId, agg);
    }
  }

  if (sessions.size === 0) return;

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, ai_title, prompt_count, confidence)
    VALUES (@id, 'gemini', @started_at, @ended_at, @ai_title, @prompt_count, 'high')
    ON CONFLICT(id) DO UPDATE SET
      ended_at     = excluded.ended_at,
      ai_title     = COALESCE(sessions.ai_title, excluded.ai_title),
      prompt_count = excluded.prompt_count
  `);
  db.transaction(() => {
    for (const [id, a] of sessions) {
      upsert.run({ id, started_at: a.startedAt, ended_at: a.endedAt, ai_title: a.title, prompt_count: a.prompts || null });
    }
  })();
}

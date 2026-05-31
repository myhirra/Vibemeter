import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const STATE_DB = path.join(CODEX_DIR, 'state_5.sqlite');
const LOGS_DB = path.join(CODEX_DIR, 'logs_2.sqlite');
const HISTORY_PATH = path.join(CODEX_DIR, 'history.jsonl');

interface ThreadRow {
  id: string;
  created_at_ms: number;
  updated_at_ms: number;
  cwd: string | null;
  title: string | null;
  first_user_message: string | null;
  has_user_event: number | null;
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
             has_user_event, tokens_used, git_branch, model, archived
      FROM threads
      ORDER BY created_at_ms ASC
    `).all() as ThreadRow[];

    const db = getDb();
    const upsert = db.prepare(`
      INSERT INTO sessions (id, tool, started_at, ended_at, cwd, ai_title, tokens_used, prompt_count, confidence)
      VALUES (@id, 'codex', @started_at, @ended_at, @cwd, @ai_title, @tokens_used, @prompt_count, 'high')
      ON CONFLICT(id) DO UPDATE SET
        ended_at     = excluded.ended_at,
        cwd          = COALESCE(sessions.cwd, excluded.cwd),
        ai_title     = COALESCE(sessions.ai_title, excluded.ai_title),
        tokens_used  = excluded.tokens_used,
        prompt_count = COALESCE(NULLIF(sessions.prompt_count, 0), excluded.prompt_count),
        confidence   = 'high'
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
          prompt_count: (t.first_user_message?.trim() || t.has_user_event) ? 1 : null,
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

function attr(body: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`${escaped}=("[^"]*"|\\S+)`));
  if (!match) return null;
  return match[1].replace(/^"|"$/g, '');
}

function numAttr(body: string, key: string): number {
  const raw = attr(body, key);
  const value = raw == null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function importTokenBreakdownFromLogs(): void {
  if (!fs.existsSync(LOGS_DB)) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite = require('better-sqlite3') as typeof import('better-sqlite3');
    const logsDb = new BetterSqlite(LOGS_DB, { readonly: true });
    const rows = logsDb.prepare(`
      SELECT thread_id, ts, feedback_log_body
      FROM logs
      WHERE target = 'codex_otel.log_only'
        AND feedback_log_body LIKE '%event.name="codex.sse_event"%'
        AND feedback_log_body LIKE '%event.kind=response.completed%'
    `).all() as { thread_id: string | null; ts: number; feedback_log_body: string | null }[];

    const byThread = new Map<string, {
      input: number;
      cacheRead: number;
      output: number;
      firstTs: number;
      lastTs: number;
    }>();

    for (const row of rows) {
      const body = row.feedback_log_body ?? '';
      const threadId = row.thread_id ?? attr(body, 'conversation.id');
      if (!threadId) continue;
      const inputTotal = numAttr(body, 'input_token_count');
      const cacheRead = Math.min(inputTotal, numAttr(body, 'cached_token_count'));
      const output = numAttr(body, 'output_token_count');
      if (inputTotal <= 0 && cacheRead <= 0 && output <= 0) continue;
      const current = byThread.get(threadId) ?? { input: 0, cacheRead: 0, output: 0, firstTs: row.ts, lastTs: row.ts };
      current.input += Math.max(0, inputTotal - cacheRead);
      current.cacheRead += cacheRead;
      current.output += output;
      current.firstTs = Math.min(current.firstTs, row.ts);
      current.lastTs = Math.max(current.lastTs, row.ts);
      byThread.set(threadId, current);
    }
    logsDb.close();

    if (byThread.size === 0) return;
    const db = getDb();
    const update = db.prepare(`
      UPDATE sessions
      SET input_tokens = @input,
          cache_creation_tokens = 0,
          cache_read_tokens = @cache_read,
          output_tokens = @output,
          started_at = COALESCE(started_at, @started_at),
          ended_at = MAX(COALESCE(ended_at, @ended_at), @ended_at),
          confidence = 'high'
      WHERE id = @id
        AND tool = 'codex'
    `);

    const updateAll = db.transaction(() => {
      for (const [id, totals] of byThread) {
        update.run({
          id,
          input: totals.input || null,
          cache_read: totals.cacheRead || null,
          output: totals.output || null,
          started_at: totals.firstTs * 1000,
          ended_at: totals.lastTs * 1000,
        });
      }
    });
    updateAll();
  } catch {
    return;
  }
}

function importFromHistoryJsonl(): void {
  if (!fs.existsSync(HISTORY_PATH)) return;
  interface Entry { session_id: string; ts: number; text?: string; }
  const bySession = new Map<string, { minTs: number; maxTs: number; promptCount: number }>();
  try {
    for (const line of fs.readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line) as Entry;
        if (!e.session_id || !e.ts) continue;
        const prompt = typeof e.text === 'string' && e.text.trim().length > 0 ? 1 : 0;
        const cur = bySession.get(e.session_id);
        if (!cur) {
          bySession.set(e.session_id, { minTs: e.ts, maxTs: e.ts, promptCount: prompt });
        } else {
          if (e.ts < cur.minTs) cur.minTs = e.ts;
          if (e.ts > cur.maxTs) cur.maxTs = e.ts;
          cur.promptCount += prompt;
        }
      } catch { /* skip */ }
    }
  } catch { return; }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, prompt_count, confidence)
    VALUES (@id, 'codex', @started_at, @ended_at, @prompt_count, 'medium')
    ON CONFLICT(id) DO UPDATE SET
      prompt_count = excluded.prompt_count
    WHERE sessions.tool = 'codex'
  `);
  const importAll = db.transaction(() => {
    for (const [id, { minTs, maxTs, promptCount }] of bySession) {
      upsert.run({ id, started_at: minTs * 1000, ended_at: maxTs * 1000, prompt_count: promptCount || null });
    }
  });
  importAll();
}

export function importCodexSessions(): void {
  importFromStateDb();
  importFromHistoryJsonl(); // prompt counts + fallback rows when state DB is unavailable
  importTokenBreakdownFromLogs();
}

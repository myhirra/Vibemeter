/**
 * Scans ~/.claude/projects/ for session JSONL files and upserts them into SQLite.
 * Active sessions (present in ~/.claude/sessions/) get ended_at = null.
 *
 * This is the primary data source — no claude CLI alias needed.
 * confidence='high' because data comes directly from Claude Code's own files.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDb } from '../db';
import { parseSessionLog } from '../parsers/session-log';
import { parseStatuslineJson } from '../parsers/statusline-json';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

/** Returns the set of sessionIds currently active (file present in ~/.claude/sessions/). */
function getActiveSessionIds(): Set<string> {
  const active = new Set<string>();
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8');
        const data = JSON.parse(raw) as { sessionId?: string };
        if (data.sessionId) active.add(data.sessionId);
      } catch { /* corrupt file, skip */ }
    }
  } catch { /* SESSIONS_DIR doesn't exist */ }
  return active;
}

/** Returns all .jsonl paths under ~/.claude/projects/. */
function collectJsonlPaths(): string[] {
  const result: string[] = [];
  try {
    const projectDirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of projectDirs) {
      const full = path.join(PROJECTS_DIR, dir);
      try {
        const stat = fs.statSync(full);
        if (!stat.isDirectory()) continue;
        const files = fs.readdirSync(full);
        for (const f of files) {
          if (f.endsWith('.jsonl')) result.push(path.join(full, f));
        }
      } catch { /* skip */ }
    }
  } catch { /* PROJECTS_DIR doesn't exist */ }
  return result;
}

export interface ImportResult {
  scanned: number;
  inserted: number;
  skipped: number;
}

export function importSessions(): ImportResult {
  const db = getDb();
  const activeIds = getActiveSessionIds();
  const jsonlPaths = collectJsonlPaths();

  const upsert = db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, exit_code, cwd, cli_args, summary, confidence)
    VALUES (@id, @tool, @started_at, @ended_at, @exit_code, @cwd, @cli_args, @summary, @confidence)
    ON CONFLICT(id) DO UPDATE SET
      ended_at   = excluded.ended_at,
      exit_code  = excluded.exit_code,
      confidence = excluded.confidence
  `);

  let inserted = 0;
  let skipped = 0;

  const importAll = db.transaction(() => {
    for (const jsonlPath of jsonlPaths) {
      const meta = parseSessionLog(jsonlPath);
      if (!meta || !meta.startedAt) { skipped++; continue; }

      const isActive = activeIds.has(meta.sessionId);

      upsert.run({
        id: meta.sessionId,
        tool: 'claude-code',
        started_at: meta.startedAt,
        ended_at: isActive ? null : meta.lastSeenAt,
        exit_code: null,  // not available from JSONL
        cwd: meta.cwd,
        cli_args: null,   // not available from JSONL (wrapper-less import)
        summary: null,    // TODO Day 2: generate from session content
        confidence: 'high',
      });
      inserted++;
    }
  });

  importAll();

  // Snapshot current usage from statusline-latest.json (written by statusline-command.sh)
  const usage = parseStatuslineJson();
  if (usage) {
    db.prepare(`
      INSERT INTO usage_snapshots
        (captured_at, source, window_5h_used_pct, window_weekly_used_pct,
         reset_at_5h, reset_at_weekly, raw_output, confidence)
      VALUES
        (@captured_at, @source, @window_5h_used_pct, @window_weekly_used_pct,
         @reset_at_5h, @reset_at_weekly, @raw_output, @confidence)
    `).run({
      captured_at: Date.now(),
      source: 'statusline',
      window_5h_used_pct: usage.window_5h_used_pct,
      window_weekly_used_pct: usage.window_weekly_used_pct,
      reset_at_5h: usage.reset_at_5h,
      reset_at_weekly: usage.reset_at_weekly,
      raw_output: usage.raw_output,
      confidence: 'high',
    });
  }

  return { scanned: jsonlPaths.length, inserted, skipped };
}

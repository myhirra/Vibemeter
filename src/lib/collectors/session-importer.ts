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
import { parseCodexRateLimit } from '../parsers/codex-ratelimit';
import { importCodexSessions } from './codex-importer';
import { importCursorSessions } from './cursor-importer';
import { getCurrentCodexAccount } from '../codex-auth';
import { scanGitCommits } from '../git/scan';
import { getLatestUsageSnapshot, insertUsageSnapshot } from '../usage-snapshots';
import { autoClassifyOutcomes } from '../outcome/auto-classify';

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

export function importUsageSnapshots(): void {
  const db = getDb();

  // Claude Code: from statusline-latest.json written by statusline-command.sh
  const usage = parseStatuslineJson();
  if (usage) {
    const last = getLatestUsageSnapshot(db, 'statusline');
    const changed =
      !last ||
      last.window_5h_used_pct !== usage.window_5h_used_pct ||
      last.window_weekly_used_pct !== usage.window_weekly_used_pct ||
      last.reset_at_5h !== usage.reset_at_5h ||
      last.reset_at_weekly !== usage.reset_at_weekly;
    if (changed) {
      insertUsageSnapshot(db, {
        capturedAt: Date.now(),
        source: 'statusline',
        accountId: null,
        window5hUsedPct: usage.window_5h_used_pct,
        windowWeeklyUsedPct: usage.window_weekly_used_pct,
        resetAt5h: usage.reset_at_5h,
        resetAtWeekly: usage.reset_at_weekly,
        rawOutput: usage.raw_output,
        confidence: 'high',
      });
    }
  }

  // Codex: from ~/.codex/sessions/*/rollout-*.jsonl rate_limits events
  const currentCodexAccount = getCurrentCodexAccount();
  const codexUsage = parseCodexRateLimit({
    minMtimeMs: currentCodexAccount?.authMtimeMs,
  });
  if (codexUsage) {
    const accountId = currentCodexAccount?.accountId ?? null;
    const last = getLatestUsageSnapshot(db, 'codex', accountId);
    const changed =
      !last ||
      last.window_5h_used_pct !== codexUsage.window_5h_used_pct ||
      last.window_weekly_used_pct !== codexUsage.window_weekly_used_pct ||
      last.reset_at_5h !== codexUsage.reset_at_5h ||
      last.reset_at_weekly !== codexUsage.reset_at_weekly;
    if (changed) {
      insertUsageSnapshot(db, {
        capturedAt: Date.now(),
        source: 'codex',
        accountId,
        window5hUsedPct: codexUsage.window_5h_used_pct,
        windowWeeklyUsedPct: codexUsage.window_weekly_used_pct,
        resetAt5h: codexUsage.reset_at_5h,
        resetAtWeekly: codexUsage.reset_at_weekly,
        rawOutput: null,
        confidence: 'high',
      });
    }
  }
}

export function importSessions(): ImportResult {
  const db = getDb();
  const activeIds = getActiveSessionIds();
  const jsonlPaths = collectJsonlPaths();

  const upsert = db.prepare(`
    INSERT INTO sessions (
      id, tool, started_at, ended_at, exit_code, cwd, cli_args, summary, ai_title, confidence,
      input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
      peak_context_tokens, last_context_tokens, last_turn_at
    )
    VALUES (
      @id, @tool, @started_at, @ended_at, @exit_code, @cwd, @cli_args, @summary, @ai_title, @confidence,
      @input_tokens, @cache_creation_tokens, @cache_read_tokens, @output_tokens,
      @peak_context_tokens, @last_context_tokens, @last_turn_at
    )
    ON CONFLICT(id) DO UPDATE SET
      ended_at              = excluded.ended_at,
      exit_code             = excluded.exit_code,
      ai_title              = COALESCE(sessions.ai_title, excluded.ai_title),
      confidence            = excluded.confidence,
      input_tokens          = excluded.input_tokens,
      cache_creation_tokens = excluded.cache_creation_tokens,
      cache_read_tokens     = excluded.cache_read_tokens,
      output_tokens         = excluded.output_tokens,
      peak_context_tokens   = excluded.peak_context_tokens,
      last_context_tokens   = excluded.last_context_tokens,
      last_turn_at          = excluded.last_turn_at
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
        exit_code: null,
        cwd: meta.cwd,
        cli_args: null,
        summary: null,
        ai_title: meta.aiTitle,
        confidence: 'high',
        input_tokens: meta.inputTokens || null,
        cache_creation_tokens: meta.cacheCreationTokens || null,
        cache_read_tokens: meta.cacheReadTokens || null,
        output_tokens: meta.outputTokens || null,
        peak_context_tokens: meta.peakContextTokens,
        last_context_tokens: meta.lastContextTokens,
        last_turn_at: meta.lastTurnAt,
      });
      inserted++;
    }
  });

  importAll();
  importCodexSessions();
  importCursorSessions();

  importUsageSnapshots();

  // Best-effort git linkage; never fail the import if git isn't available.
  try { scanGitCommits(db); } catch { /* skip */ }

  // Best-effort outcome auto-classification — runs after scanGitCommits so we
  // can use the freshly-linked commits. Never overwrites human-set outcomes
  // (the helper guards on `outcome IS NULL`). Failures are silent — the
  // dashboard still works without auto-labels.
  try { autoClassifyOutcomes(db); } catch { /* skip */ }

  return { scanned: jsonlPaths.length, inserted, skipped };
}

/**
 * Scans the most recent ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl and extracts
 * the last rate_limits event (type=token_count with payload.rate_limits).
 * primary  = 5-hour window (300 min)
 * secondary = 7-day window (10080 min)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');

interface RateLimitWindow {
  used_percent: number;
  window_minutes: number;
  resets_at: number; // unix seconds
}

interface RateLimits {
  primary: RateLimitWindow;
  secondary: RateLimitWindow;
}

export interface CodexUsage {
  window_5h_used_pct: number;
  window_weekly_used_pct: number;
  reset_at_5h: number;    // unix ms
  reset_at_weekly: number; // unix ms
  source_mtime_ms: number;
}

export interface CodexRateLimitParseOptions {
  sessionsDir?: string;
  minMtimeMs?: number;
}

export function parseCodexRateLimit(options: CodexRateLimitParseOptions = {}): CodexUsage | null {
  // Find the most recently modified jsonl across all session dirs
  const sessionsDir = options.sessionsDir ?? SESSIONS_DIR;
  const minMtimeMs = options.minMtimeMs ?? 0;
  try {
    let bestFile: { path: string; mtime: number } | null = null as { path: string; mtime: number } | null;
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          if (entry.endsWith('.jsonl') && stat.mtimeMs >= minMtimeMs && stat.mtimeMs > (bestFile?.mtime ?? 0)) {
            bestFile = { path: full, mtime: stat.mtimeMs };
          }
        } catch { /* skip */ }
      }
    }
    if (!fs.existsSync(sessionsDir)) return null;
    walk(sessionsDir);
    if (!bestFile) return null;

    // Read from the end — last rate_limits event wins
    const lines = fs.readFileSync(bestFile.path, 'utf8').split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as { payload?: { rate_limits?: RateLimits } };
        const rl = obj?.payload?.rate_limits;
        if (!rl?.primary || !rl?.secondary) continue;
        return {
          window_5h_used_pct: rl.primary.used_percent,
          window_weekly_used_pct: rl.secondary.used_percent,
          reset_at_5h: rl.primary.resets_at * 1000,
          reset_at_weekly: rl.secondary.resets_at * 1000,
          source_mtime_ms: bestFile.mtime,
        };
      } catch { /* skip */ }
    }
    return null;
  } catch {
    return null;
  }
}

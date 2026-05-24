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
  // Codex can keep multiple rollout files active at once. Near-identical token_count
  // events can disagree briefly after a reset, so use the most conservative recent
  // reading across all rollout files instead of trusting one latest file.
  const sessionsDir = options.sessionsDir ?? SESSIONS_DIR;
  const minMtimeMs = options.minMtimeMs ?? 0;
  try {
    const files: { path: string; mtime: number }[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          if (entry.endsWith('.jsonl') && stat.mtimeMs >= minMtimeMs) {
            files.push({ path: full, mtime: stat.mtimeMs });
          }
        } catch { /* skip */ }
      }
    }
    if (!fs.existsSync(sessionsDir)) return null;
    walk(sessionsDir);
    if (files.length === 0) return null;

    const readings: { timestampMs: number; mtime: number; limits: RateLimits }[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file.path, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as { timestamp?: string; payload?: { rate_limits?: RateLimits } };
          const rl = obj?.payload?.rate_limits;
          if (!rl?.primary || !rl?.secondary) continue;
          const timestampMs = obj.timestamp ? Date.parse(obj.timestamp) : file.mtime;
          readings.push({ timestampMs: Number.isFinite(timestampMs) ? timestampMs : file.mtime, mtime: file.mtime, limits: rl });
        } catch { /* skip */ }
      }
    }
    if (readings.length === 0) return null;

    const latestTimestamp = Math.max(...readings.map((reading) => reading.timestampMs));
    const recent = readings.filter((reading) => latestTimestamp - reading.timestampMs <= 5 * 60_000);
    const best = recent.reduce((current, next) => {
      if (next.limits.primary.used_percent > current.limits.primary.used_percent) return next;
      if (
        next.limits.primary.used_percent === current.limits.primary.used_percent
        && next.timestampMs > current.timestampMs
      ) return next;
      return current;
    }, recent[0]);

    return {
      window_5h_used_pct: best.limits.primary.used_percent,
      window_weekly_used_pct: best.limits.secondary.used_percent,
      reset_at_5h: best.limits.primary.resets_at * 1000,
      reset_at_weekly: best.limits.secondary.resets_at * 1000,
      source_mtime_ms: best.mtime,
    };
  } catch {
    return null;
  }
}

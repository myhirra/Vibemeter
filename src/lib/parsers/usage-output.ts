/**
 * TODO: `claude /usage` currently returns only a plain-text subscription message
 * with no parseable numeric data (no 5h window %, no weekly %, no reset timestamps).
 * Probe output: "You are currently using your subscription to power your Claude Code usage"
 *
 * Until Anthropic exposes structured usage data, this parser is a stub.
 * All usage_snapshots rows inserted via this path will have null percentages
 * and confidence='low'.
 */

export interface UsageParseResult {
  window_5h_used_pct: null;
  window_weekly_used_pct: null;
  reset_at_5h: null;
  reset_at_weekly: null;
  raw_output: string;
  confidence: 'low';
}

export function parseUsageOutput(stdout: string): UsageParseResult {
  return {
    window_5h_used_pct: null,
    window_weekly_used_pct: null,
    reset_at_5h: null,
    reset_at_weekly: null,
    raw_output: stdout.slice(0, 2000), // cap to avoid storing huge blobs
    confidence: 'low',
  };
}

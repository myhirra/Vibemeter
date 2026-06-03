import type Database from 'better-sqlite3';

export type UsageSource = 'claude_usage_cmd' | 'statusline' | 'manual' | 'codex';
export type UsageConfidence = 'high' | 'medium' | 'low';

export interface UsageSnapshotInput {
  capturedAt: number;
  source: UsageSource;
  accountId: string | null;
  window5hUsedPct: number | null;
  windowWeeklyUsedPct: number | null;
  resetAt5h: number | null;
  resetAtWeekly: number | null;
  rawOutput: string | null;
  confidence: UsageConfidence;
}

export interface UsageSnapshotRecord {
  id: number;
  captured_at: number;
  source: UsageSource;
  account_id: string | null;
  window_5h_used_pct: number | null;
  window_weekly_used_pct: number | null;
  reset_at_5h: number | null;
  reset_at_weekly: number | null;
  raw_output: string | null;
  confidence: UsageConfidence;
}

export function insertUsageSnapshot(db: Database.Database, input: UsageSnapshotInput): void {
  db.prepare(`
    INSERT INTO usage_snapshots
      (captured_at, source, account_id, window_5h_used_pct, window_weekly_used_pct,
       reset_at_5h, reset_at_weekly, raw_output, confidence)
    VALUES
      (@captured_at, @source, @account_id, @window_5h_used_pct, @window_weekly_used_pct,
       @reset_at_5h, @reset_at_weekly, @raw_output, @confidence)
  `).run({
    captured_at: input.capturedAt,
    source: input.source,
    account_id: input.accountId,
    window_5h_used_pct: input.window5hUsedPct,
    window_weekly_used_pct: input.windowWeeklyUsedPct,
    reset_at_5h: input.resetAt5h,
    reset_at_weekly: input.resetAtWeekly,
    raw_output: input.rawOutput,
    confidence: input.confidence,
  });
}

// Returns the N most recent snapshots for a (source, account) ordered newest-first.
// Used by vendor_event detection to compare adjacent readings.
export function getRecentUsageSnapshots(
  db: Database.Database,
  source: UsageSource,
  accountId: string | null,
  limit: number,
): UsageSnapshotRecord[] {
  const sql = `
    SELECT id, captured_at, source, account_id, window_5h_used_pct, window_weekly_used_pct,
           reset_at_5h, reset_at_weekly, raw_output, confidence
    FROM usage_snapshots
    WHERE source = ? AND ${accountId == null ? 'account_id IS NULL' : 'account_id = ?'}
    ORDER BY captured_at DESC
    LIMIT ?
  `;
  const rows = accountId == null
    ? db.prepare(sql).all(source, limit)
    : db.prepare(sql).all(source, accountId, limit);
  return rows as UsageSnapshotRecord[];
}

export function getLatestUsageSnapshot(
  db: Database.Database,
  source: UsageSource,
  accountId?: string | null,
): UsageSnapshotRecord | null {
  const row = accountId != null
    ? db.prepare(`
        SELECT id, captured_at, source, account_id, window_5h_used_pct, window_weekly_used_pct,
               reset_at_5h, reset_at_weekly, raw_output, confidence
        FROM usage_snapshots
        WHERE source = ? AND account_id = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `).get(source, accountId)
    : db.prepare(`
        SELECT id, captured_at, source, account_id, window_5h_used_pct, window_weekly_used_pct,
               reset_at_5h, reset_at_weekly, raw_output, confidence
        FROM usage_snapshots
        WHERE source = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `).get(source);

  return (row as UsageSnapshotRecord | undefined) ?? null;
}

/**
 * Like getLatestUsageSnapshot but only considers snapshots that actually carry
 * quota data (5h or weekly used_pct). When Claude Code runs through a proxy /
 * custom ANTHROPIC_BASE_URL, its statusline has no Anthropic `rate_limits`, so
 * the newest snapshot blanks the quota ring. The 5h/weekly quota belongs to the
 * account, not the proxy session, so we fall back to the most recent real
 * reading (e.g. from a direct-Anthropic session). Returns null only when no
 * quota-bearing snapshot exists at all — then the ring is simply not shown.
 */
export function getLatestQuotaSnapshot(
  db: Database.Database,
  source: UsageSource,
  accountId?: string | null,
): UsageSnapshotRecord | null {
  const where = accountId != null
    ? 'source = ? AND account_id = ?'
    : 'source = ?';
  const params = accountId != null ? [source, accountId] : [source];
  const row = db.prepare(`
    SELECT id, captured_at, source, account_id, window_5h_used_pct, window_weekly_used_pct,
           reset_at_5h, reset_at_weekly, raw_output, confidence
    FROM usage_snapshots
    WHERE ${where}
      AND (window_5h_used_pct IS NOT NULL OR window_weekly_used_pct IS NOT NULL)
    ORDER BY captured_at DESC
    LIMIT 1
  `).get(...params);
  return (row as UsageSnapshotRecord | undefined) ?? null;
}

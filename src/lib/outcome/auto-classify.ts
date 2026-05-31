// Walks the `sessions` table and fills in `outcome` for rows that don't have
// one yet, using the pure heuristic in `./classify`. Runs as part of
// `importSessions()` after `scanGitCommits()` so we can read freshly-linked
// commits out of `session_commits`.
//
// Guarantees:
//   - NEVER overwrites a row whose `outcome IS NOT NULL` (whether user-set or
//     a previous auto-classify pass). The current-iteration human input is
//     sacred — if the user clears their own label, only then will the next
//     pass re-classify.
//   - Bounded: at most `MAX_PASS_SIZE` rows per call to avoid lock-up on big
//     historical imports. We pick most-recent-first.
//   - One transaction for all writes.

import type Database from 'better-sqlite3';
import { classifyOutcome } from './classify';

/** Hard cap so a one-time import on a multi-year DB doesn't stall the UI. */
const MAX_PASS_SIZE = 5000;
/** Fallback duration when `ended_at` is missing (active sessions). */
const ACTIVE_SESSION_FALLBACK_MS = 5 * 60_000;

interface PendingSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

interface AutoClassifyResult {
  considered: number;
  updated: number;
}

export function autoClassifyOutcomes(db: Database.Database): AutoClassifyResult {
  const candidates = db.prepare(`
    SELECT id, started_at AS startedAt, ended_at AS endedAt
    FROM sessions
    WHERE outcome IS NULL
    ORDER BY started_at DESC
    LIMIT ?
  `).all(MAX_PASS_SIZE) as PendingSession[];

  if (candidates.length === 0) return { considered: 0, updated: 0 };

  const commitsStmt = db.prepare(`
    SELECT subject FROM session_commits WHERE session_id = ?
  `);
  const fileChangesStmt = db.prepare(`
    SELECT COUNT(*) AS n FROM file_changes WHERE session_id = ?
  `);
  // Crucial: only write when outcome is still NULL. Belt-and-braces against a
  // race where the user labels something between SELECT and UPDATE.
  const update = db.prepare(`
    UPDATE sessions
       SET outcome = ?, outcome_source = 'auto', outcome_set_at = ?
     WHERE id = ?
       AND outcome IS NULL
  `);

  const now = Date.now();
  let updated = 0;

  const run = db.transaction(() => {
    for (const s of candidates) {
      const commitRows = commitsStmt.all(s.id) as { subject: string | null }[];
      const commitSubjects = commitRows
        .map((r) => r.subject ?? '')
        .filter((x) => x.length > 0);
      const { n: fileChangeCount } = fileChangesStmt.get(s.id) as { n: number };

      // For active sessions (no ended_at) we treat duration as a small positive
      // value rather than NaN — keeps the classifier from accidentally calling
      // them 'refactor' just because endedAt is null.
      const durationMs = s.endedAt != null
        ? s.endedAt - s.startedAt
        : ACTIVE_SESSION_FALLBACK_MS;

      const outcome = classifyOutcome({
        durationMs,
        commitCount: commitSubjects.length,
        commitSubjects,
        fileChangeCount,
      });
      if (!outcome) continue;

      const info = update.run(outcome, now, s.id);
      if (info.changes > 0) updated++;
    }
  });
  run();

  return { considered: candidates.length, updated };
}

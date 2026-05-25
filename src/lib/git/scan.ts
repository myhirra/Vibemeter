// Passive git ↔ session linker. Looks at every cwd we already track in the
// `sessions` table, runs `git log` in the ones that are git repos, and stores
// commit↔session links into `session_commits`. No hooks, no writes back to the
// user's repos — just observation. Safe to run as part of importSessions().

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/** Look-back window for `git log`. Anything older is unlikely to still match a session in our table. */
const SCAN_WINDOW_DAYS = 30;
/** Hard cap on how far a session timestamp can drift from a commit to still match. */
const POST_COMMIT_GRACE_MS = 30 * 60_000; // commit can be up to 30 min after session ends
const PRE_COMMIT_GRACE_MS = 5 * 60_000;

interface CommitRow {
  sha: string;
  committedAt: number; // unix ms
  subject: string;
}

function isGitRepo(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, '.git'));
}

function readRecentCommits(repo: string): CommitRow[] {
  try {
    const since = `${SCAN_WINDOW_DAYS} days ago`;
    const out = execFileSync(
      'git',
      ['-C', repo, 'log', `--since=${since}`, '--format=%H|%ct|%s'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result: CommitRow[] = [];
    for (const line of out.split('\n')) {
      if (!line) continue;
      const sep1 = line.indexOf('|');
      const sep2 = line.indexOf('|', sep1 + 1);
      if (sep1 < 0 || sep2 < 0) continue;
      const sha = line.slice(0, sep1);
      const ts = Number(line.slice(sep1 + 1, sep2));
      if (!Number.isFinite(ts)) continue;
      result.push({ sha, committedAt: ts * 1000, subject: line.slice(sep2 + 1) });
    }
    return result;
  } catch {
    return [];
  }
}

interface CandidateSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
}

function pickSessionForCommit(commit: CommitRow, sessions: CandidateSession[]): CandidateSession | null {
  // Sessions are pre-sorted DESC by started_at. We want the most-recent session whose
  // active window [start - pre, end + post] covers the commit time.
  const t = commit.committedAt;
  for (const s of sessions) {
    const start = s.startedAt - PRE_COMMIT_GRACE_MS;
    const end = (s.endedAt ?? s.startedAt + 8 * 3_600_000) + POST_COMMIT_GRACE_MS;
    if (t >= start && t <= end) return s;
  }
  return null;
}

export interface GitScanResult {
  reposScanned: number;
  reposSkipped: number;
  commitsSeen: number;
  linksInserted: number;
}

export function scanGitCommits(db: Database.Database): GitScanResult {
  const cwds = db.prepare(`
    SELECT DISTINCT cwd
    FROM sessions
    WHERE cwd IS NOT NULL
      AND started_at > ?
  `).all(Date.now() - SCAN_WINDOW_DAYS * 86_400_000) as { cwd: string }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO session_commits (session_id, repo, sha, subject, committed_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  let reposScanned = 0;
  let reposSkipped = 0;
  let commitsSeen = 0;
  let linksInserted = 0;

  const tx = db.transaction(() => {
    for (const { cwd } of cwds) {
      if (!isGitRepo(cwd)) { reposSkipped++; continue; }
      const commits = readRecentCommits(cwd);
      if (commits.length === 0) { reposSkipped++; continue; }
      reposScanned++;
      commitsSeen += commits.length;

      const cutoffMs = Math.min(...commits.map((c) => c.committedAt)) - 8 * 3_600_000;
      const sessions = db.prepare(`
        SELECT id, started_at AS startedAt, ended_at AS endedAt
        FROM sessions
        WHERE cwd = ?
          AND started_at > ?
        ORDER BY started_at DESC
      `).all(cwd, cutoffMs) as CandidateSession[];

      for (const commit of commits) {
        const session = pickSessionForCommit(commit, sessions);
        if (!session) continue;
        const info = insert.run(session.id, cwd, commit.sha, commit.subject, commit.committedAt);
        if (info.changes > 0) linksInserted++;
      }
    }
  });

  tx();
  return { reposScanned, reposSkipped, commitsSeen, linksInserted };
}

export interface SessionCommitSummary {
  sessionId: string;
  count: number;
}

export function commitCountsBySession(db: Database.Database): Map<string, number> {
  const rows = db.prepare(`
    SELECT session_id AS sessionId, COUNT(*) AS count
    FROM session_commits
    GROUP BY session_id
  `).all() as SessionCommitSummary[];
  return new Map(rows.map((r) => [r.sessionId, r.count]));
}

export interface CommitForSession {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: number;
}

export function commitsForSession(sessionId: string, db: Database.Database): CommitForSession[] {
  const rows = db.prepare(`
    SELECT sha, subject, committed_at AS committedAt
    FROM session_commits
    WHERE session_id = ?
    ORDER BY committed_at ASC
  `).all(sessionId) as { sha: string; subject: string; committedAt: number }[];
  return rows.map((r) => ({
    sha: r.sha,
    shortSha: r.sha.slice(0, 7),
    subject: r.subject,
    committedAt: r.committedAt,
  }));
}

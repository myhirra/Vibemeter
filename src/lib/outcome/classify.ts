// Pure heuristic classifier for session outcomes (Phase 1).
//
// Given a small set of post-hoc signals (duration, commits, commit subjects,
// file-change count) returns the best-guess `Outcome` label — or `null` when
// the heuristics can't make any call at all.
//
// Design rules:
//   1. Pure function — no DB access, no IO, no `Date.now()`. The caller passes
//      in everything we need so this stays trivial to unit-test.
//   2. `'failed'` is NEVER returned. That value is reserved for the human
//      pressing the pill — we have no reliable "user gave up" signal locally.
//   3. The priority order below is deliberate; the first matching rule wins.

import type { Outcome } from '../schema';

export interface ClassifyInput {
  /** Session duration in milliseconds (ended_at - started_at). */
  durationMs: number;
  /** Number of commits we've attributed to this session via `session_commits`. */
  commitCount: number;
  /** Commit subjects for the linked commits (used for keyword sniffing). */
  commitSubjects: string[];
  /** Number of rows in `file_changes` for this session (a rough activity proxy). */
  fileChangeCount: number;
}

// Heuristic keyword sets. Kept small and conservative — the goal is a sensible
// default the user can override, not a precise classifier.
const SHIP_RE = /release|publish|deploy|ship|bump|version/i;
const BUGFIX_RE = /^fix(\(|:)|bug/i;

/**
 * Map session signals to a likely outcome. Returns `null` only if no rule
 * matches at all (today that's effectively never — rule #6 catches everything).
 */
export function classifyOutcome(input: ClassifyInput): Outcome | null {
  const { durationMs, commitCount, commitSubjects, fileChangeCount } = input;

  if (commitCount >= 1) {
    // Strongest signal first: explicit ship-language anywhere in the linked
    // commits → call it shipped, even if other commits look like bugfixes.
    if (commitSubjects.some((s) => SHIP_RE.test(s))) return 'shipped';

    // Bugfix detection requires the *majority* of subjects to look like fixes,
    // so a single stray `fix: typo` in a feature batch doesn't mislabel.
    const bugfixHits = commitSubjects.filter((s) => BUGFIX_RE.test(s)).length;
    if (bugfixHits > 0 && bugfixHits * 2 >= commitSubjects.length) return 'bugfix';

    // Default: any commit at all → shipped. Users can override to 'refactor'
    // etc. via the UI pill.
    return 'shipped';
  }

  // No commits below this point.
  if (durationMs > 20 * 60_000 && fileChangeCount > 0) return 'refactor';
  if (durationMs < 10 * 60_000) return 'discarded';
  return 'explore';
}

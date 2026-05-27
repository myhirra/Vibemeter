/**
 * Redact / demo helpers.
 *
 * Both the demo path (no real data → MarketingPage fallback uses anonymized
 * fixtures) and the user-facing "Redact sensitive data" toggle pump their data
 * through this module so the masking logic stays in one place.
 *
 * Masking rules:
 * - Project name → `project-alpha`, `project-beta`, … deterministic per
 *   `(name, salt)` pair so the same input always yields the same label across
 *   page reloads.
 * - Session cwd → `~/projects/<masked-project>` so the basename in the table
 *   still gives the eye something to anchor on.
 * - ai_title → one of a small bilingual pool of generic task titles, picked
 *   deterministically from the row id.
 * - Commit messages → fixed placeholder string.
 *
 * Aggregate numbers (tokens, dates, costs, counts) are NOT touched here; they
 * are safe to screenshot and are the whole point of the dashboard.
 */
import crypto from 'node:crypto';

/**
 * Demo project labels. These are the same fifteen used by the marketing /
 * demo path and intentionally read like generic side-project names so a
 * screenshot doesn't leak which real repos the user works on.
 */
export const DEMO_PROJECTS = [
  'kanban-board', 'pomodoro', 'weather-widget', 'recipe-box', 'mood-journal',
  'habit-tracker', 'flashcards', 'spelling-bee', 'budget-app', 'markdown-blog',
  'todo-cli', 'music-player', 'photo-gallery', 'note-vault', 'expense-split',
] as const;

/**
 * Greek-letter style project labels used for the redact toggle. Keeping these
 * separate from DEMO_PROJECTS makes the two modes visually distinguishable
 * during screenshots — `project-alpha` reads as "intentionally masked", while
 * `kanban-board` reads as "this is the demo".
 */
const REDACT_LABELS = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon',
  'zeta', 'eta', 'theta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'omicron',
  'pi', 'rho', 'sigma', 'tau', 'upsilon',
  'phi', 'chi', 'psi', 'omega',
] as const;

/**
 * Generic session titles used to replace real ai_title strings. Bilingual on
 * purpose — the redact mode is locale-aware in the UI but we don't want to
 * leak which language the user codes in by mixing them, so we stick to
 * English-language placeholders (matches Vibemeter's own marketing tone).
 */
export const DEMO_TITLES = [
  'add dark mode toggle',
  'refactor router boundaries',
  'fix mobile layout overflow',
  'wire up websocket reconnect',
  'optimize image lazy loading',
  'migrate to server components',
  'tighten type signatures',
  'investigate flaky e2e tests',
  'add keyboard shortcuts',
  'improve empty states',
] as const;

/** Marker used in place of a real commit message in redact mode. */
export const REDACTED_COMMIT_MESSAGE = '[commit message redacted]';

/** Marker used as the masked cwd prefix. */
const REDACTED_CWD_PREFIX = '~/projects';

/**
 * Hash `name + salt` into a stable integer. We do not need cryptographic
 * strength here — sha1 is plenty for "deterministic bucket assignment" and is
 * cheap on the server. The first 4 bytes give us up to 2^32 distinct buckets,
 * which we then mod into the small label pool.
 */
function stableBucket(name: string, salt: string): number {
  const hash = crypto.createHash('sha1').update(`${salt}:${name}`).digest();
  // Read 4 bytes as an unsigned 32-bit int.
  return hash.readUInt32BE(0);
}

/**
 * Hash a key into a small non-negative integer suitable for `array[index % len]`
 * lookups. Re-exported because `src/app/page.tsx` needs to deterministically
 * pick demo titles for timeline entries / cache rows without rebuilding the
 * `redactSession` envelope around them.
 */
export function deterministicBucket(key: string, salt: string): number {
  return stableBucket(key, salt);
}

/**
 * Pick a deterministic `project-<label>` for a real project name.
 *
 * Same `(name, salt)` always returns the same label, so a user who screenshots
 * "project-alpha" today still sees "project-alpha" tomorrow — useful when
 * sharing the same screenshot across a thread.
 */
export function redactProject(name: string, salt: string): string {
  const safe = name.trim() || 'unknown';
  const bucket = stableBucket(safe, salt);
  const label = REDACT_LABELS[bucket % REDACT_LABELS.length];
  return `project-${label}`;
}

/** Extract the project basename from a cwd path. */
function projectBasename(cwd: string | null): string | null {
  if (!cwd) return null;
  const parts = cwd.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Mask a session row in-place-style (returns a new object).
 *
 * Touches only `cwd` and `ai_title` — everything else (id, tokens, dates,
 * tool, tags, commit counts) is the aggregate data the user wants to keep
 * visible.
 */
export function redactSession<T extends { id: string; cwd: string | null; ai_title: string | null }>(
  row: T,
  salt: string,
): T {
  const base = projectBasename(row.cwd);
  const masked = base ? redactProject(base, salt) : null;
  const titleBucket = stableBucket(row.id, salt);
  return {
    ...row,
    cwd: masked ? `${REDACTED_CWD_PREFIX}/${masked}` : row.cwd,
    ai_title: row.ai_title ? DEMO_TITLES[titleBucket % DEMO_TITLES.length] : null,
  };
}

/**
 * Return the redaction placeholder for a git commit message. Currently always
 * returns the same string, but kept as a function so callers don't reach into
 * the constant directly — gives us room to make it locale-aware later.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function redactCommit(_msg: string): string {
  return REDACTED_COMMIT_MESSAGE;
}

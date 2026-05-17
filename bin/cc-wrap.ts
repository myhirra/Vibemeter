#!/usr/bin/env tsx
/**
 * cc-wrap — thin Claude Code wrapper.
 *
 * What it does:
 *   1. Runs the session importer to sync all past ~/.claude/projects/ sessions into SQLite.
 *   2. Spawns `claude` with all provided args, piping stdio transparently.
 *   3. After claude exits, runs the importer again to capture the new session.
 *
 * Setup (add to ~/.zshrc or ~/.bashrc):
 *   alias claude='/path/to/ai-sessions/bin/cc-wrap.ts'
 *   # Or if installed globally: alias claude='cc-wrap'
 *
 * Note: The importer reads ~/.claude/projects/ directly (confidence='high').
 * No interception of claude's stdout — privacy preserved.
 */

import { spawnSync } from 'child_process';
import { importSessions } from '../src/lib/collectors/session-importer';

const args = process.argv.slice(2);

// Pre-import: sync past sessions
try {
  importSessions();
} catch (e) {
  // Never block claude startup due to our own errors
  process.stderr.write(`[cc-wrap] pre-import error: ${String(e)}\n`);
}

// Spawn claude transparently
const result = spawnSync('claude', args, {
  stdio: 'inherit',
  env: process.env,
});

// Post-import: pick up the session that just ended
try {
  importSessions();
} catch (e) {
  process.stderr.write(`[cc-wrap] post-import error: ${String(e)}\n`);
}

process.exit(result.status ?? 0);

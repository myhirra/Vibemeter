import path from 'path';
import os from 'os';

/**
 * Where Vibemeter stores its SQLite DB and statusline snapshot.
 *
 * Defaults to `~/.vibemeter` so that the dev server and the installed
 * statusline (~/.claude/statusline-command.sh writes here unconditionally)
 * share the same snapshot. Override with VIBEMETER_DATA_DIR.
 */
export function dataDir(): string {
  return process.env.VIBEMETER_DATA_DIR ?? path.join(os.homedir(), '.vibemeter');
}

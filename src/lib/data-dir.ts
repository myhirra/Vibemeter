import path from 'path';

/**
 * Where Vibemeter stores its SQLite DB and statusline snapshot.
 *
 * - When installed via `npx @hirra/vibemeter`: the bin script sets
 *   VIBEMETER_DATA_DIR to `~/.vibemeter` for a stable user-data location.
 * - In local development from a checkout: defaults to `<cwd>/.data`.
 */
export function dataDir(): string {
  return process.env.VIBEMETER_DATA_DIR ?? path.join(process.cwd(), '.data');
}

// Reads the "needs you" markers the Notification hook writes to
// ~/.vibemeter/attention/<session_id>.json. A session is "waiting for you" from
// when Claude blocks on permission / goes idle until you (or the run) move it
// along (the clear hooks delete the marker). We also age out stale markers in
// case a session was closed without a clear ever firing.

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './data-dir';

const ATTENTION_TTL_MS = 30 * 60 * 1000; // 30 min safety net

export interface WaitingSession {
  sessionId: string;
  project: string | null;
  cwd: string | null;
  at: number;
}

function attentionDir(): string {
  return path.join(dataDir(), 'attention');
}

export function readWaitingSessions(now = Date.now()): WaitingSession[] {
  const dir = attentionDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out: WaitingSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    try {
      const rec = JSON.parse(fs.readFileSync(full, 'utf8')) as { cwd?: string | null; at?: number };
      const at = typeof rec.at === 'number' ? rec.at : 0;
      if (now - at > ATTENTION_TTL_MS) {
        // Stale (session likely closed without clearing) — drop it.
        fs.rmSync(full, { force: true });
        continue;
      }
      const cwd = typeof rec.cwd === 'string' ? rec.cwd : null;
      out.push({
        sessionId: file.replace(/\.json$/, ''),
        cwd,
        project: cwd ? cwd.split('/').filter(Boolean).pop() ?? null : null,
        at,
      });
    } catch {
      // corrupt marker — ignore
    }
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

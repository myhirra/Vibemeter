import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseCodexRateLimit } from '../src/lib/parsers/codex-ratelimit.ts';

async function writeRollout(root: string, isoName: string, usedPercent: number, mtimeMs: number) {
  const dir = path.join(root, '2026', '05', '23');
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-${isoName}.jsonl`);
  await writeFile(
    filePath,
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        rate_limits: {
          primary: { used_percent: usedPercent, window_minutes: 300, resets_at: 1_779_538_514 },
          secondary: { used_percent: 0, window_minutes: 10080, resets_at: 1_780_125_314 },
        },
      },
    })}\n`,
    'utf8',
  );
  const mtime = new Date(mtimeMs);
  utimesSync(filePath, mtime, mtime);
}

test('Codex rate-limit parser can ignore rollout files older than the current account switch', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'codex-ratelimit-'));
  await writeRollout(root, 'old.jsonl', 63, 1_000);
  await writeRollout(root, 'new.jsonl', 2, 3_000);

  assert.equal(parseCodexRateLimit({ sessionsDir: root, minMtimeMs: 2_000 })?.window_5h_used_pct, 2);
  assert.equal(parseCodexRateLimit({ sessionsDir: root, minMtimeMs: 4_000 }), null);
});

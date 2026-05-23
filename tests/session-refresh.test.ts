import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionRefreshRunner } from '../src/lib/session-refresh.ts';

test('coalesces concurrent session refreshes into one import run', async () => {
  let calls = 0;
  let release: () => void = () => {};
  const importer = () => {
    calls += 1;
    return new Promise<{ scanned: number; inserted: number; skipped: number }>((resolve) => {
      release = () => resolve({ scanned: 10, inserted: 8, skipped: 2 });
    });
  };

  const runner = createSessionRefreshRunner(importer);
  const first = runner.refreshSessions();
  const second = runner.refreshSessions();

  assert.equal(calls, 1);
  release?.();

  assert.deepEqual(await first, { scanned: 10, inserted: 8, skipped: 2 });
  assert.deepEqual(await second, { scanned: 10, inserted: 8, skipped: 2 });
  assert.equal(calls, 1);
});

import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./_resolve.mjs', import.meta.url);

// Each test gets an isolated data dir so the real ~/.vibemeter is never touched.
function withTempDataDir(fn: () => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-telemetry-'));
  const prev = process.env.VIBEMETER_DATA_DIR;
  process.env.VIBEMETER_DATA_DIR = dir;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.VIBEMETER_DATA_DIR;
    else process.env.VIBEMETER_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const { getInstallId, getLastSentDay, markSentDay } = await import('../src/lib/telemetry/install-id.ts');

test('getInstallId creates and persists a stable uuid', () => {
  withTempDataDir(() => {
    const first = getInstallId();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(getInstallId(), first, 'second call returns the same id');
    assert.ok(existsSync(path.join(process.env.VIBEMETER_DATA_DIR!, 'telemetry-state.json')));
  });
});

test('lastSentDay round-trips and preserves the install id', () => {
  withTempDataDir(() => {
    const id = getInstallId();
    assert.equal(getLastSentDay(), null);
    markSentDay('2026-05-31');
    assert.equal(getLastSentDay(), '2026-05-31');
    assert.equal(getInstallId(), id, 'marking a day must not rotate the id');
  });
});

test('markSentDay before any getInstallId still yields a valid id', () => {
  withTempDataDir(() => {
    markSentDay('2026-06-01');
    assert.equal(getLastSentDay(), '2026-06-01');
    assert.match(getInstallId(), /^[0-9a-f-]{36}$/i);
  });
});

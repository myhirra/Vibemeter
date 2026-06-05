import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./_resolve.mjs', import.meta.url);

const { readWaitingSessions } = await import('../src/lib/attention.ts');

function withDataDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-attn-'));
  const prev = process.env.VIBEMETER_DATA_DIR;
  process.env.VIBEMETER_DATA_DIR = dir;
  mkdirSync(path.join(dir, 'attention'), { recursive: true });
  try { fn(dir); } finally {
    if (prev === undefined) delete process.env.VIBEMETER_DATA_DIR;
    else process.env.VIBEMETER_DATA_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const marker = (dir: string, id: string, rec: object) =>
  writeFileSync(path.join(dir, 'attention', `${id}.json`), JSON.stringify(rec));

test('returns fresh waiting sessions with project derived from cwd, newest first', () => {
  withDataDir((dir) => {
    marker(dir, 'sess-a', { cwd: '/Users/x/codes/vibemeter', at: Date.now() - 1000 });
    marker(dir, 'sess-b', { cwd: '/Users/x/codes/stocks', at: Date.now() });
    const out = readWaitingSessions();
    assert.equal(out.length, 2);
    assert.equal(out[0].sessionId, 'sess-b'); // newest first
    assert.equal(out[0].project, 'stocks');
    assert.equal(out[1].project, 'vibemeter');
  });
});

test('ages out and deletes stale markers (> TTL)', () => {
  withDataDir((dir) => {
    marker(dir, 'old', { cwd: '/p/old', at: Date.now() - 40 * 60 * 1000 }); // 40 min > 30 min TTL
    marker(dir, 'now', { cwd: '/p/now', at: Date.now() });
    const out = readWaitingSessions();
    assert.deepEqual(out.map((w) => w.sessionId), ['now']);
    assert.equal(existsSync(path.join(dir, 'attention', 'old.json')), false, 'stale marker removed');
  });
});

test('returns [] when the attention dir is missing', () => {
  const prev = process.env.VIBEMETER_DATA_DIR;
  process.env.VIBEMETER_DATA_DIR = path.join(tmpdir(), 'vm-attn-none-' + Math.random().toString(36).slice(2));
  try {
    assert.deepEqual(readWaitingSessions(), []);
  } finally {
    if (prev === undefined) delete process.env.VIBEMETER_DATA_DIR;
    else process.env.VIBEMETER_DATA_DIR = prev;
  }
});

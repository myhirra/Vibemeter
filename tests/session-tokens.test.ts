import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseSessionLog, readLiveContext } from '../src/lib/parsers/session-log.ts';

function writeJsonl(dir: string, sessionId: string, lines: object[]): string {
  const file = path.join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return file;
}

test('parseSessionLog aggregates token totals across assistant turns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-tokens-'));
  const file = writeJsonl(dir, '11111111-1111-1111-1111-111111111111', [
    { type: 'meta', timestamp: '2026-01-01T00:00:00Z', cwd: '/work' },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:01:00Z',
      message: { usage: { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 800, output_tokens: 50 } },
    },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:02:00Z',
      message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1100, output_tokens: 80 } },
    },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  assert.equal(meta!.inputTokens, 110);
  assert.equal(meta!.cacheCreationTokens, 200);
  assert.equal(meta!.cacheReadTokens, 1900);
  assert.equal(meta!.outputTokens, 130);
  // peak = max per-turn context = 100+200+800+50 = 1150 vs 10+0+1100+80 = 1190 → 1190
  assert.equal(meta!.peakContextTokens, 1190);
  assert.equal(meta!.lastContextTokens, 1190);
  assert.equal(meta!.cwd, '/work');
});

test('readLiveContext returns the last assistant turn even from a tail read', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-live-'));
  // Add a lot of filler to push the read past a fresh boundary
  const filler: object[] = [];
  for (let i = 0; i < 50; i++) {
    filler.push({ type: 'user', timestamp: '2026-01-01T00:00:00Z', content: 'x'.repeat(2000) });
  }
  const file = writeJsonl(dir, '22222222-2222-2222-2222-222222222222', [
    { type: 'meta', cwd: '/repo' },
    ...filler,
    {
      type: 'assistant',
      timestamp: '2026-01-01T05:00:00Z',
      cwd: '/repo',
      message: { usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 130_000, output_tokens: 200 } },
    },
  ]);

  const live = readLiveContext(file);
  assert.ok(live);
  assert.equal(live!.sessionId, '22222222-2222-2222-2222-222222222222');
  assert.equal(live!.tokens, 130_205);
  assert.equal(live!.cwd, '/repo');
});

test('readLiveContext returns null when no assistant usage seen', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-live-empty-'));
  const file = writeJsonl(dir, '33333333-3333-3333-3333-333333333333', [
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', content: 'hello' },
  ]);
  assert.equal(readLiveContext(file), null);
});

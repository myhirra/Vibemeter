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
      type: 'user',
      timestamp: '2026-01-01T00:00:10Z',
      isSidechain: false,
      message: { role: 'user', content: 'build the thing' },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:20Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:30Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    },
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
  assert.equal(meta!.promptCount, 2);
});

test('parseSessionLog uses Claude last-prompt markers when present', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-last-prompt-'));
  const file = writeJsonl(dir, '44444444-4444-4444-4444-444444444444', [
    { type: 'meta', timestamp: '2026-01-01T00:00:00Z', cwd: '/work' },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:10Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: 'first turn' }] },
    },
    { type: 'last-prompt', sessionId: '44444444-4444-4444-4444-444444444444', leafUuid: 'leaf-1' },
    {
      type: 'assistant',
      timestamp: '2026-01-01T00:00:20Z',
      message: { content: [{ type: 'tool_use', id: 'tool-1' }] },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:30Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }] },
    },
    { type: 'last-prompt', sessionId: '44444444-4444-4444-4444-444444444444', leafUuid: 'leaf-2' },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  assert.equal(meta!.promptCount, 2);
});

test('parseSessionLog dedups repeated last-prompt markers with identical text', () => {
  // Claude Code 每个 assistant turn 都会重写 last-prompt marker：leafUuid 每轮变、
  // 但 lastPrompt 原文不变。按原文去重，一条输入的多轮执行只算一次真实输入。
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-marker-dedup-'));
  const sid = '66666666-6666-6666-6666-666666666666';
  const file = writeJsonl(dir, sid, [
    { type: 'meta', timestamp: '2026-01-01T00:00:00Z', cwd: '/work' },
    // 第 1 条真实输入 → 随后每个 turn 重写同一原文的 marker（leaf 变）
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-a1', lastPrompt: '修一下 stocks 南向数据' },
    { type: 'assistant', timestamp: '2026-01-01T00:00:10Z', message: { usage: { output_tokens: 5 } } },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-a2', lastPrompt: '修一下 stocks 南向数据' },
    { type: 'assistant', timestamp: '2026-01-01T00:00:20Z', message: { usage: { output_tokens: 5 } } },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-a3', lastPrompt: '修一下 stocks 南向数据' },
    // 第 2 条真实输入：原文变了 → 计第 2 次
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-b1', lastPrompt: '再部署一下' },
    { type: 'assistant', timestamp: '2026-01-01T00:00:30Z', message: { usage: { output_tokens: 5 } } },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-b2', lastPrompt: '再部署一下' },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  // 5 个 marker、2 段原文 → 2 次真实输入（旧逻辑会错误计成 5）
  assert.equal(meta!.promptCount, 2);
});

test('parseSessionLog skips the session-head continuation pointer', () => {
  // 新格式会话首行是续接指针：无 lastPrompt 原文、无 timestamp、先于任何 user 行。
  // 它指向上一个会话的输入，不是本会话的 prompt——不计数（旧逻辑每会话虚计 +1）。
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-head-marker-'));
  const sid = '77777777-7777-7777-7777-777777777777';
  const file = writeJsonl(dir, sid, [
    { type: 'last-prompt', sessionId: sid, leafUuid: 'head-leaf' },
    {
      type: 'user',
      timestamp: '2026-01-01T12:00:10Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: '真实输入' }] },
    },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-1', lastPrompt: '真实输入' },
    { type: 'assistant', timestamp: '2026-01-01T12:00:20Z', message: { usage: { output_tokens: 5 } } },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-2', lastPrompt: '真实输入' },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  assert.equal(meta!.promptCount, 1);
  const dailyTotal = meta!.dailyUsage.reduce((sum, d) => sum + d.promptCount, 0);
  assert.equal(dailyTotal, 1);
});

test('parseSessionLog does not double-count a prompt whose marker lands on the next day', () => {
  // 输入在 day1（user 行），回复跨天、marker 到 day2 才落盘。
  // 按天口径必须跟全会话一致（有 marker 就全用 marker 桶），否则同一条输入两天各计一次。
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-cross-day-'));
  const sid = '88888888-8888-8888-8888-888888888888';
  const file = writeJsonl(dir, sid, [
    { type: 'meta', timestamp: '2026-01-01T12:00:00Z', cwd: '/work' },
    {
      type: 'user',
      timestamp: '2026-01-01T12:00:10Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: '跨天任务' }] },
    },
    // 相隔 48h，保证任意时区下都归属不同的本地日
    { type: 'assistant', timestamp: '2026-01-03T12:00:00Z', message: { usage: { output_tokens: 5 } } },
    { type: 'last-prompt', sessionId: sid, leafUuid: 'leaf-1', lastPrompt: '跨天任务' },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  assert.equal(meta!.promptCount, 1);
  const dailyTotal = meta!.dailyUsage.reduce((sum, d) => sum + d.promptCount, 0);
  // 旧逻辑：day1 回退 userPrompt 计 1 + day2 marker 计 1 = 2（双计）
  assert.equal(dailyTotal, 1);
});

test('parseSessionLog falls back to user text prompts for older Claude logs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vm-user-prompt-'));
  const file = writeJsonl(dir, '55555555-5555-5555-5555-555555555555', [
    { type: 'meta', timestamp: '2026-01-01T00:00:00Z', cwd: '/work' },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:10Z',
      isSidechain: false,
      message: { role: 'user', content: 'first turn' },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:20Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
    },
    {
      type: 'user',
      timestamp: '2026-01-01T00:00:30Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'text', text: 'follow up' }] },
    },
  ]);

  const meta = parseSessionLog(file);
  assert.ok(meta);
  assert.equal(meta!.promptCount, 2);
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

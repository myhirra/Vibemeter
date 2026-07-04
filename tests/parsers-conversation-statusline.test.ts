import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

register('./_resolve.mjs', import.meta.url);

// parseStatuslineJson reads STATUSLINE_PATH, which is resolved from dataDir()
// at module load — so point VIBEMETER_DATA_DIR at a temp dir BEFORE importing.
const dataDirPath = mkdtempSync(path.join(tmpdir(), 'vm-parsers-'));
process.env.VIBEMETER_DATA_DIR = dataDirPath;

const { readConversationTurns } = await import('../src/lib/parsers/session-log.ts');
const { parseStatuslineJson, STATUSLINE_PATH } = await import('../src/lib/parsers/statusline-json.ts');

function writeJsonl(lines: object[]): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'vm-jsonl-')), 'session.jsonl');
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('readConversationTurns extracts user text and assistant text + tool names', () => {
  const file = writeJsonl([
    { type: 'user', message: { role: 'user', content: '  hello there  ' } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'sure' },
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', name: 'Read' },
        ],
      },
    },
    { type: 'system', message: { role: 'system', content: 'ignored' } },
  ]);
  const turns = readConversationTurns(file);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[0], { role: 'user', text: 'hello there' });
  assert.equal(turns[1].role, 'assistant');
  assert.equal(turns[1].text, 'sure');
  assert.deepEqual(turns[1].toolNames, ['Bash', 'Read']);
});

test('readConversationTurns skips empty turns and keeps only the last `limit`', () => {
  const lines = [];
  for (let i = 0; i < 20; i += 1) {
    lines.push({ type: 'user', message: { role: 'user', content: `msg ${i}` } });
  }
  // an assistant turn with neither text nor tools must be dropped
  lines.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', text: 'x' }] } });
  const file = writeJsonl(lines);
  const turns = readConversationTurns(file, 5);
  assert.equal(turns.length, 5);
  assert.equal(turns[turns.length - 1].text, 'msg 19'); // empty assistant turn dropped
});

test('readConversationTurns returns [] for a missing file', () => {
  assert.deepEqual(readConversationTurns('/no/such/file.jsonl'), []);
});

test('parseStatuslineJson converts reset seconds to ms and maps fields', () => {
  writeFileSync(STATUSLINE_PATH, JSON.stringify({
    session_id: 's-1',
    session_name: 'demo',
    cwd: '/tmp/proj',
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: 1_700_000_000 },
      seven_day: { used_percentage: 8 },
    },
  }));
  const out = parseStatuslineJson();
  assert.ok(out);
  assert.equal(out!.window_5h_used_pct, 42);
  assert.equal(out!.window_weekly_used_pct, 8);
  assert.equal(out!.reset_at_5h, 1_700_000_000 * 1000); // seconds → ms
  assert.equal(out!.reset_at_weekly, null); // no resets_at provided
  assert.equal(out!.session_id, 's-1');
  assert.equal(out!.confidence, 'high');
  // fixture 无 context_window/model → 真实占比字段留空，调用方回退自算
  assert.equal(out!.context_used_pct, null);
  assert.equal(out!.context_tokens, null);
  assert.equal(out!.model_id, null);
});

test('parseStatuslineJson surfaces real context percentage, tokens and model id', () => {
  writeFileSync(STATUSLINE_PATH, JSON.stringify({
    session_id: 's-fable',
    model: { id: 'claude-fable-5', display_name: 'Fable 5' },
    // Fable 5 是 1M 窗口：20 万 token 只占 20%，绝不能被自算成 100%
    context_window: {
      total_input_tokens: 190_000,
      total_output_tokens: 10_000,
      used_percentage: 20,
    },
  }));
  const out = parseStatuslineJson();
  assert.ok(out);
  assert.equal(out!.context_used_pct, 20);
  assert.equal(out!.context_tokens, 200_000);
  assert.equal(out!.model_id, 'claude-fable-5');
});

test('parseStatuslineJson returns null on invalid JSON', () => {
  writeFileSync(STATUSLINE_PATH, '{ not valid json');
  assert.equal(parseStatuslineJson(), null);
});

test.after(() => rmSync(dataDirPath, { recursive: true, force: true }));

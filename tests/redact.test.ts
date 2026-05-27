import assert from 'node:assert/strict';
import test from 'node:test';

import { redactProject, redactSession, redactCommit, REDACTED_COMMIT_MESSAGE } from '../src/lib/redact.ts';

test('redactProject returns a deterministic project-* label', () => {
  const masked = redactProject('vibemeter', 'salt-a');
  assert.match(masked, /^project-[a-z]+$/);
});

test('redactProject is stable for the same input + salt', () => {
  const a = redactProject('vibemeter', 'salt-a');
  const b = redactProject('vibemeter', 'salt-a');
  assert.equal(a, b);
});

test('redactProject differs across distinct project names under one salt', () => {
  // Statistically two different names will land in different label buckets;
  // we picked a pair whose sha1 buckets differ, so this asserts the
  // mapping isn't a constant.
  const a = redactProject('vibemeter', 'salt-a');
  const b = redactProject('foo', 'salt-a');
  assert.notEqual(a, b);
});

test('redactProject differs across salts for the same name', () => {
  const a = redactProject('vibemeter', 'salt-a');
  const b = redactProject('vibemeter', 'salt-b');
  // We can't guarantee inequality for *all* salts (collision space is small),
  // but salt-a vs salt-b should pick different buckets — assert in case
  // someone changes the hash algorithm and accidentally weakens it.
  assert.notEqual(a, b);
});

test('redactProject coerces blank names to a stable fallback', () => {
  const a = redactProject('', 'salt-a');
  const b = redactProject('   ', 'salt-a');
  assert.equal(a, b);
  assert.match(a, /^project-[a-z]+$/);
});

test('redactSession masks ai_title and cwd but keeps id, tool, dates, tokens', () => {
  const row = {
    id: 'sess-123',
    tool: 'claude-code',
    started_at: 1_700_000_000_000,
    ended_at: 1_700_000_300_000,
    cwd: '/Users/me/code/vibemeter',
    ai_title: 'refactor the very secret thing',
    summary: null,
    tags: null,
    input_tokens: 42,
  };
  const masked = redactSession(row, 'salt-a');
  // Untouched fields
  assert.equal(masked.id, row.id);
  assert.equal(masked.tool, row.tool);
  assert.equal(masked.started_at, row.started_at);
  assert.equal(masked.ended_at, row.ended_at);
  assert.equal(masked.summary, row.summary);
  assert.equal(masked.tags, row.tags);
  assert.equal(masked.input_tokens, row.input_tokens);
  // Masked fields
  assert.notEqual(masked.ai_title, row.ai_title);
  assert.ok(masked.ai_title && masked.ai_title.length > 0);
  assert.notEqual(masked.cwd, row.cwd);
  assert.match(masked.cwd!, /^~\/projects\/project-[a-z]+$/);
});

test('redactSession leaves null ai_title and null cwd alone', () => {
  const row = {
    id: 'sess-empty',
    cwd: null,
    ai_title: null,
  };
  const masked = redactSession(row, 'salt-a');
  assert.equal(masked.cwd, null);
  assert.equal(masked.ai_title, null);
});

test('redactSession yields stable output for the same id + salt', () => {
  const row = {
    id: 'sess-abc',
    cwd: '/Users/me/code/vibemeter',
    ai_title: 'secret-thing',
  };
  const a = redactSession(row, 'salt-a');
  const b = redactSession(row, 'salt-a');
  assert.deepEqual(a, b);
});

test('redactCommit returns the redacted placeholder', () => {
  assert.equal(redactCommit('add feature x'), REDACTED_COMMIT_MESSAGE);
  assert.equal(redactCommit(''), REDACTED_COMMIT_MESSAGE);
  assert.equal(redactCommit('fix bug in widget'), REDACTED_COMMIT_MESSAGE);
});

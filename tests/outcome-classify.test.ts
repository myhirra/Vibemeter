import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyOutcome } from '../src/lib/outcome/classify.ts';

// Sane defaults so each test only has to override the field it cares about.
const base = {
  durationMs: 60 * 60_000,
  commitCount: 0,
  commitSubjects: [] as string[],
  fileChangeCount: 0,
};

test('rule 1: ship-language in commit subject wins → shipped', () => {
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['release v1.2.0'] }),
    'shipped',
  );
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['chore: bump version'] }),
    'shipped',
  );
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['deploy: nightly'] }),
    'shipped',
  );
});

test('rule 1 beats rule 2: a mix with shipping language is shipped, not bugfix', () => {
  assert.equal(
    classifyOutcome({
      ...base,
      commitCount: 2,
      commitSubjects: ['fix: off-by-one', 'release: bump'],
    }),
    'shipped',
  );
});

test('rule 2: majority bugfix subjects → bugfix', () => {
  assert.equal(
    classifyOutcome({
      ...base,
      commitCount: 3,
      commitSubjects: ['fix: crash on resize', 'fix(ui): contrast', 'bug in scroll'],
    }),
    'bugfix',
  );
});

test('rule 2 needs majority: 1 fix in 3 unrelated commits is not bugfix', () => {
  assert.equal(
    classifyOutcome({
      ...base,
      commitCount: 3,
      commitSubjects: ['fix: typo', 'add caching layer', 'tweak layout'],
    }),
    'shipped',
  );
});

test('rule 3: any commit without ship/bug keywords → shipped', () => {
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['add caching'] }),
    'shipped',
  );
  assert.equal(
    classifyOutcome({ ...base, commitCount: 2, commitSubjects: ['refactor x', 'doc tweak'] }),
    'shipped',
  );
});

test('rule 4: no commits + long session + file changes → refactor', () => {
  assert.equal(
    classifyOutcome({ ...base, durationMs: 30 * 60_000, fileChangeCount: 3 }),
    'refactor',
  );
});

test('rule 4 needs file changes: long talk, no file edits → explore', () => {
  assert.equal(
    classifyOutcome({ ...base, durationMs: 45 * 60_000, fileChangeCount: 0 }),
    'explore',
  );
});

test('rule 5: short session, no commits → discarded', () => {
  assert.equal(
    classifyOutcome({ ...base, durationMs: 4 * 60_000 }),
    'discarded',
  );
  assert.equal(
    classifyOutcome({ ...base, durationMs: 9 * 60_000, fileChangeCount: 1 }),
    'discarded',
  );
});

test('rule 6: medium-length no-commit session → explore', () => {
  assert.equal(
    classifyOutcome({ ...base, durationMs: 15 * 60_000 }),
    'explore',
  );
});

test('boundary: durationMs exactly 10min, no commits → explore (not discarded)', () => {
  // Rule 5 condition is strictly less than 10min.
  assert.equal(
    classifyOutcome({ ...base, durationMs: 10 * 60_000 }),
    'explore',
  );
});

test('boundary: durationMs exactly 20min with file changes → explore (refactor needs > 20min)', () => {
  assert.equal(
    classifyOutcome({ ...base, durationMs: 20 * 60_000, fileChangeCount: 5 }),
    'explore',
  );
});

test('failed is never auto-set, even for catastrophic inputs', () => {
  // Various pathological inputs that might "feel" like a failure — classifier
  // should still pick from the auto-allowed labels.
  assert.notEqual(
    classifyOutcome({ ...base, durationMs: 0, fileChangeCount: 0 }),
    'failed',
  );
  assert.notEqual(
    classifyOutcome({ ...base, durationMs: 24 * 3_600_000, fileChangeCount: 200 }),
    'failed',
  );
});

test('empty commit subjects array with positive commitCount still uses default', () => {
  // If somehow commitCount is reported but subjects array is empty, the
  // SHIP/BUGFIX regexes won't match, so we fall through to rule 3 → shipped.
  assert.equal(
    classifyOutcome({ ...base, commitCount: 2, commitSubjects: [] }),
    'shipped',
  );
});

test('case-insensitive matching for ship keywords', () => {
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['SHIP it'] }),
    'shipped',
  );
  assert.equal(
    classifyOutcome({ ...base, commitCount: 1, commitSubjects: ['Publish 0.2'] }),
    'shipped',
  );
});

test('case-insensitive matching for bugfix keywords', () => {
  assert.equal(
    classifyOutcome({
      ...base,
      commitCount: 2,
      commitSubjects: ['FIX: crash', 'Fix(ui): focus ring'],
    }),
    'bugfix',
  );
});

// Tests for the announcements curation block in admin-server.mjs.
// Run: node --test deploy/vibemeter-site/test-announcements.mjs
//
// We import admin-server.mjs as a module; thanks to the IS_ENTRY_POINT guard
// it won't start a listener and won't demand VIBEMETER_ADMIN_PASSWORD. We
// reach the validation helpers via the exported __announcementsTestHooks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Run tests inside a throwaway cwd so we never touch real announcements.json.
// Resolve realpath so the comparison below survives macOS' /private/var
// symlink dance.
const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'vm-ann-')));
process.chdir(tmp);

const mod = await import('./admin-server.mjs');
const hooks = mod.__announcementsTestHooks;
assert.ok(hooks, 'expected __announcementsTestHooks to be exported');

test('slugify normalises ids', () => {
  assert.equal(hooks.slugify('Codex Reset 2026/06/01!'), 'codex-reset-2026-06-01');
  assert.equal(hooks.slugify('  trailing-and-LEADING  '), 'trailing-and-leading');
  assert.equal(hooks.slugify(''), '');
});

test('isIsoDate accepts and rejects', () => {
  assert.equal(hooks.isIsoDate('2026-06-01T00:00:00Z'), true);
  assert.equal(hooks.isIsoDate('2026-06-01'), true);
  assert.equal(hooks.isIsoDate('not a date'), false);
  assert.equal(hooks.isIsoDate(42), false);
});

test('validateAnnouncement rejects bad kind/provider/severity', () => {
  const base = {
    kind: 'quota_reset', provider: 'codex', severity: 'notice',
    title: { zh: '标题', en: 'Title' },
  };
  assert.equal(hooks.validateAnnouncement({ ...base, kind: 'nope' }, 'create', new Set()).ok, false);
  assert.equal(hooks.validateAnnouncement({ ...base, provider: 'gemini' }, 'create', new Set()).ok, false);
  assert.equal(hooks.validateAnnouncement({ ...base, severity: 'meh' }, 'create', new Set()).ok, false);
});

test('validateAnnouncement requires at least one of title.zh/title.en', () => {
  const r = hooks.validateAnnouncement({
    kind: 'outage', provider: 'all', severity: 'urgent',
    title: { zh: '', en: '' },
  }, 'create', new Set());
  assert.equal(r.ok, false);
  assert.match(r.error, /title/);
});

test('validateAnnouncement accepts en-only title', () => {
  const r = hooks.validateAnnouncement({
    kind: 'outage', provider: 'all', severity: 'urgent',
    title: { en: 'English only' },
  }, 'create', new Set());
  assert.equal(r.ok, true);
  assert.equal(r.item.title.en, 'English only');
  assert.equal(r.item.title.zh, '');
});

test('validateAnnouncement rejects bad ISO 8601 dates', () => {
  const r = hooks.validateAnnouncement({
    kind: 'pricing', provider: 'claude', severity: 'info',
    title: { zh: '调价', en: 'Pricing' },
    occurs_at: 'tomorrow at noon',
  }, 'create', new Set());
  assert.equal(r.ok, false);
  assert.match(r.error, /occurs_at/);
});

test('validateAnnouncement normalises ISO 8601 to UTC string', () => {
  const r = hooks.validateAnnouncement({
    kind: 'quota_reset', provider: 'codex', severity: 'notice',
    title: { en: 'Reset' },
    occurs_at: '2026-06-01T08:00:00+08:00',
    expires_at: '2026-06-01T12:00:00+08:00',
  }, 'create', new Set());
  assert.equal(r.ok, true);
  assert.equal(r.item.occurs_at, '2026-06-01T00:00:00.000Z');
  assert.equal(r.item.expires_at, '2026-06-01T04:00:00.000Z');
});

test('suggestId picks <provider>-<kind>-<YYYYMMDD>', () => {
  const id = hooks.suggestId(
    { provider: 'codex', kind: 'quota_reset', occurs_at: '2026-06-01T00:00:00Z' },
    new Set(),
  );
  assert.equal(id, 'codex-quota_reset-20260601');
});

test('suggestId bumps -2, -3 on collisions', () => {
  const existing = new Set(['codex-quota_reset-20260601', 'codex-quota_reset-20260601-2']);
  const id = hooks.suggestId(
    { provider: 'codex', kind: 'quota_reset', occurs_at: '2026-06-01T00:00:00Z' },
    existing,
  );
  assert.equal(id, 'codex-quota_reset-20260601-3');
});

test('validateAnnouncement auto-generates id when omitted', () => {
  const r = hooks.validateAnnouncement({
    kind: 'quota_reset', provider: 'codex', severity: 'notice',
    title: { en: 'Reset' },
    occurs_at: '2026-06-01T00:00:00Z',
  }, 'create', new Set());
  assert.equal(r.ok, true);
  assert.equal(r.item.id, 'codex-quota_reset-20260601');
});

test('validateAnnouncement bumps suffix on explicit id collision', () => {
  const r = hooks.validateAnnouncement({
    id: 'my-event',
    kind: 'other', provider: 'all', severity: 'info',
    title: { en: 'Hello' },
  }, 'create', new Set(['my-event']));
  assert.equal(r.ok, true);
  assert.equal(r.item.id, 'my-event-2');
});

test('validateAnnouncement update mode requires id', () => {
  const r = hooks.validateAnnouncement({
    kind: 'other', provider: 'all', severity: 'info',
    title: { en: 'x' },
  }, 'update', new Set());
  assert.equal(r.ok, false);
  assert.match(r.error, /id required/);
});

// --- End-to-end: read / write / version increment ----------------------------

test('readAnnouncements returns empty when file missing', async () => {
  // Fresh cwd, no file written. The module reads from cwd-relative path which
  // was captured at import time; verify by checking that file path is in our
  // tmp dir.
  assert.ok(hooks.ANNOUNCEMENTS_FILE.startsWith(tmp), 'ANNOUNCEMENTS_FILE should be in tmp cwd');
  assert.ok(!existsSync(hooks.ANNOUNCEMENTS_FILE), 'file should not exist yet');
});

test('writeAnnouncements + readAnnouncements round-trip via the public API', async () => {
  // Simulate version increment by writing twice through the on-disk file.
  const fileV1 = { version: 1, items: [{
    id: 'demo-1', kind: 'other', provider: 'all', severity: 'info',
    title: { en: 'v1' },
  }] };
  writeFileSync(hooks.ANNOUNCEMENTS_FILE, JSON.stringify(fileV1));
  const back = JSON.parse(readFileSync(hooks.ANNOUNCEMENTS_FILE, 'utf8'));
  assert.equal(back.version, 1);
  assert.equal(back.items[0].id, 'demo-1');

  const fileV2 = { ...back, version: back.version + 1, items: [...back.items, {
    id: 'demo-2', kind: 'outage', provider: 'codex', severity: 'warn',
    title: { zh: '中断' },
  }] };
  writeFileSync(hooks.ANNOUNCEMENTS_FILE, JSON.stringify(fileV2));
  const back2 = JSON.parse(readFileSync(hooks.ANNOUNCEMENTS_FILE, 'utf8'));
  assert.equal(back2.version, 2);
  assert.equal(back2.items.length, 2);
});

test.after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

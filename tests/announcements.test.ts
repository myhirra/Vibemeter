import { register } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

register('./_resolve.mjs', import.meta.url);

const {
  filterAnnouncements,
  compareVersions,
  pickLocalized,
  SEVERITY_RANK,
  planFanOut,
  pruneNotified,
  formatAnnouncementMessage,
  DEFAULT_ANNOUNCEMENT_PREFS,
} = await import('../src/lib/announcements.ts');
import type { Announcement, AnnouncementPrefs } from '../src/lib/announcements.ts';

function ann(overrides: Partial<Announcement>): Announcement {
  return {
    id: overrides.id ?? 'x',
    kind: overrides.kind ?? 'other',
    provider: overrides.provider ?? 'all',
    severity: overrides.severity ?? 'info',
    title: overrides.title ?? { en: 'title' },
    ...overrides,
  };
}

const NOW = Date.parse('2026-05-31T12:00:00Z');

test('compareVersions handles semver-ish strings', () => {
  assert.equal(compareVersions('0.2.28', '0.2.20'), 1);
  assert.equal(compareVersions('0.2.20', '0.2.28'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  // missing trailing segments default to 0
  assert.equal(compareVersions('0.2', '0.2.0'), 0);
  // tolerate prerelease tails like "0.2.28-rc1"
  assert.equal(compareVersions('0.2.28-rc1', '0.2.28'), 0);
});

test('pickLocalized prefers current locale then falls back', () => {
  assert.equal(pickLocalized({ zh: '中', en: 'en' }, 'zh'), '中');
  assert.equal(pickLocalized({ zh: '中', en: 'en' }, 'en'), 'en');
  assert.equal(pickLocalized({ en: 'en-only' }, 'zh'), 'en-only');
  assert.equal(pickLocalized({ zh: '只中' }, 'en'), '只中');
  assert.equal(pickLocalized(undefined, 'en'), '');
});

test('SEVERITY_RANK orders the severities correctly', () => {
  assert.ok(SEVERITY_RANK.urgent > SEVERITY_RANK.warn);
  assert.ok(SEVERITY_RANK.warn > SEVERITY_RANK.notice);
  assert.ok(SEVERITY_RANK.notice > SEVERITY_RANK.info);
});

test('filterAnnouncements drops expired items', () => {
  const items = [
    ann({ id: 'expired', expires_at: '2026-05-30T00:00:00Z' }),
    ann({ id: 'live',    expires_at: '2026-06-30T00:00:00Z' }),
    ann({ id: 'no-exp' }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id).sort(), ['live', 'no-exp']);
});

test('filterAnnouncements drops items above app version (min_version)', () => {
  const items = [
    ann({ id: 'too-new', affects: { min_version: '0.3.0' } }),
    ann({ id: 'ok',      affects: { min_version: '0.2.20' } }),
    ann({ id: 'no-req' }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: '0.2.28',
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id).sort(), ['no-req', 'ok']);
});

test('filterAnnouncements skips min_version filter when appVersion is null', () => {
  const items = [
    ann({ id: 'gated', affects: { min_version: '99.0.0' } }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id), ['gated']);
});

test('filterAnnouncements honors dismissed ids', () => {
  const items = [
    ann({ id: 'a' }),
    ann({ id: 'b' }),
    ann({ id: 'c' }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: { a: 123, c: 456 },
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id), ['b']);
});

test('filterAnnouncements scopes by userProviders when supplied', () => {
  const items = [
    ann({ id: 'claude-only', provider: 'claude' }),
    ann({ id: 'codex-only',  provider: 'codex' }),
    ann({ id: 'cursor-only', provider: 'cursor' }),
    ann({ id: 'all',         provider: 'all' }),
    ann({ id: 'multi',       provider: 'claude', affects: { providers: ['cursor'] } }),
  ];
  const onlyClaude = filterAnnouncements(items, {
    appVersion: null,
    userProviders: new Set(['claude']),
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(onlyClaude.map((i) => i.id).sort(), ['all', 'claude-only']);

  const claudeAndCursor = filterAnnouncements(items, {
    appVersion: null,
    userProviders: new Set(['claude', 'cursor']),
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(claudeAndCursor.map((i) => i.id).sort(), ['all', 'claude-only', 'cursor-only', 'multi']);
});

test('filterAnnouncements treats userProviders=null as no provider filter', () => {
  const items = [
    ann({ id: 'a', provider: 'codex' }),
    ann({ id: 'b', provider: 'cursor' }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id).sort(), ['a', 'b']);
});

test('filterAnnouncements sorts by severity then by occurs_at ascending', () => {
  const items = [
    ann({ id: 'info1',   severity: 'info' }),
    ann({ id: 'urgent',  severity: 'urgent' }),
    ann({ id: 'notice1', severity: 'notice', occurs_at: '2026-06-02T00:00:00Z' }),
    ann({ id: 'notice2', severity: 'notice', occurs_at: '2026-06-01T00:00:00Z' }),
    ann({ id: 'warn',    severity: 'warn' }),
  ];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(
    out.map((i) => i.id),
    ['urgent', 'warn', 'notice2', 'notice1', 'info1'],
  );
});

test('filterAnnouncements ignores malformed items but keeps the rest', () => {
  // Intentionally malformed shapes to exercise the runtime guard. Cast through
  // unknown so TS doesn't complain about the missing id / wrong id type.
  const items = [
    ann({ id: 'good' }),
    { kind: 'other', provider: 'all', severity: 'info', title: {} },
    { id: 42, kind: 'other', provider: 'all', severity: 'info', title: {} },
  ] as unknown as Announcement[];
  const out = filterAnnouncements(items, {
    appVersion: null,
    userProviders: null,
    dismissed: {},
    now: NOW,
  });
  assert.deepEqual(out.map((i) => i.id), ['good']);
});

// ── Fan-out planning ─────────────────────────────────────────────────────

const defaultPrefs: AnnouncementPrefs = { ...DEFAULT_ANNOUNCEMENT_PREFS };

test('planFanOut: urgent always pushes to system + webhook by default', () => {
  const items = [ann({ id: 'u', severity: 'urgent' })];
  const plan = planFanOut(items, {}, defaultPrefs);
  assert.deepEqual(plan.system.map((i) => i.id), ['u']);
  assert.deepEqual(plan.webhook.map((i) => i.id), ['u']);
  assert.deepEqual(plan.notifiedIds, ['u']);
});

test('planFanOut: urgent webhook can be opted out, system stays on', () => {
  const items = [ann({ id: 'u', severity: 'urgent' })];
  const prefs: AnnouncementPrefs = { ...defaultPrefs, urgentWebhook: false };
  const plan = planFanOut(items, {}, prefs);
  assert.deepEqual(plan.system.map((i) => i.id), ['u']);
  assert.deepEqual(plan.webhook, []);
  assert.deepEqual(plan.notifiedIds, ['u']);
});

test('planFanOut: warn respects per-channel prefs', () => {
  const items = [ann({ id: 'w', severity: 'warn' })];
  // Both off — warn never fires (and the id isn't added to notifiedIds).
  const planOff = planFanOut(items, {}, defaultPrefs);
  assert.deepEqual(planOff.system, []);
  assert.deepEqual(planOff.webhook, []);
  assert.deepEqual(planOff.notifiedIds, []);

  // System on, webhook off.
  const planSys = planFanOut(items, {}, { ...defaultPrefs, warnSystem: true });
  assert.deepEqual(planSys.system.map((i) => i.id), ['w']);
  assert.deepEqual(planSys.webhook, []);
  assert.deepEqual(planSys.notifiedIds, ['w']);

  // Webhook on, system off.
  const planHook = planFanOut(items, {}, { ...defaultPrefs, warnWebhook: true });
  assert.deepEqual(planHook.system, []);
  assert.deepEqual(planHook.webhook.map((i) => i.id), ['w']);
  assert.deepEqual(planHook.notifiedIds, ['w']);
});

test('planFanOut: info and notice never fan out', () => {
  const items = [
    ann({ id: 'i', severity: 'info' }),
    ann({ id: 'n', severity: 'notice' }),
  ];
  // Even with every pref maxed out, no info/notice fires.
  const prefs: AnnouncementPrefs = { urgentWebhook: true, warnSystem: true, warnWebhook: true };
  const plan = planFanOut(items, {}, prefs);
  assert.deepEqual(plan.system, []);
  assert.deepEqual(plan.webhook, []);
  assert.deepEqual(plan.notifiedIds, []);
});

test('planFanOut: dedup against the notified record', () => {
  const items = [
    ann({ id: 'u', severity: 'urgent' }),
    ann({ id: 'w', severity: 'warn' }),
  ];
  const prefs: AnnouncementPrefs = { urgentWebhook: true, warnSystem: true, warnWebhook: true };
  const notified = { u: NOW - 1000, w: NOW - 2000 };
  const plan = planFanOut(items, notified, prefs);
  assert.deepEqual(plan.system, []);
  assert.deepEqual(plan.webhook, []);
  assert.deepEqual(plan.notifiedIds, []);
});

test('planFanOut: mixed list — only new urgent/warn fire, info/notice ignored, already-notified skipped', () => {
  const items = [
    ann({ id: 'old-urgent', severity: 'urgent' }),
    ann({ id: 'new-urgent', severity: 'urgent' }),
    ann({ id: 'new-warn',   severity: 'warn' }),
    ann({ id: 'new-notice', severity: 'notice' }),
    ann({ id: 'new-info',   severity: 'info' }),
  ];
  const prefs: AnnouncementPrefs = { urgentWebhook: true, warnSystem: false, warnWebhook: true };
  const plan = planFanOut(items, { 'old-urgent': NOW - 5000 }, prefs);
  assert.deepEqual(plan.system.map((i) => i.id), ['new-urgent']);
  assert.deepEqual(plan.webhook.map((i) => i.id).sort(), ['new-urgent', 'new-warn']);
  assert.deepEqual(plan.notifiedIds.sort(), ['new-urgent', 'new-warn']);
});

test('planFanOut: malformed items are silently skipped', () => {
  const items = [
    ann({ id: 'good', severity: 'urgent' }),
    { kind: 'outage', provider: 'all', severity: 'urgent', title: {} },
    null,
  ] as unknown as Announcement[];
  const plan = planFanOut(items, {}, defaultPrefs);
  assert.deepEqual(plan.system.map((i) => i.id), ['good']);
  assert.deepEqual(plan.notifiedIds, ['good']);
});

test('pruneNotified: drops entries older than 30 days, keeps fresh ones', () => {
  const day = 24 * 3_600_000;
  const now = NOW;
  const input = {
    'fresh-1d':  now - 1 * day,
    'fresh-29d': now - 29 * day,
    'edge-30d':  now - 30 * day,           // exactly at cutoff → kept
    'stale-31d': now - 31 * day,
    'stale-60d': now - 60 * day,
  };
  const out = pruneNotified(input, now);
  assert.deepEqual(Object.keys(out).sort(), ['edge-30d', 'fresh-1d', 'fresh-29d']);
});

test('pruneNotified: ignores non-number values', () => {
  const out = pruneNotified({ a: 'oops' as unknown as number, b: NOW }, NOW);
  assert.deepEqual(Object.keys(out), ['b']);
});

test('formatAnnouncementMessage: zh layout includes brand + severity + source', () => {
  const item = ann({
    id: 'claude-out-1',
    severity: 'urgent',
    title: { zh: 'Claude API 中断', en: 'Claude API outage' },
    body: { zh: '影响 us-east1，预计 30 分钟。', en: 'us-east1 affected, ~30m.' },
    source: { label: 'status.anthropic', url: 'https://status.anthropic.com/' },
  });
  const msg = formatAnnouncementMessage(item, 'zh');
  assert.match(msg.title, /Vibemeter 情报/);
  assert.match(msg.title, /紧急/);
  assert.match(msg.title, /Claude API 中断/);
  assert.match(msg.body, /影响 us-east1/);
  assert.match(msg.body, /来源:/);
  assert.match(msg.body, /status\.anthropic/);
  assert.match(msg.body, /https:\/\/status\.anthropic\.com/);
});

test('formatAnnouncementMessage: en falls back to en title even when zh exists', () => {
  const item = ann({
    id: 'pricing',
    severity: 'warn',
    title: { zh: '定价变化', en: 'Pricing change' },
    body: { en: 'Codex moves to new tiers next week.' },
  });
  const msg = formatAnnouncementMessage(item, 'en');
  assert.match(msg.title, /Vibemeter intel/);
  assert.match(msg.title, /warn/);
  assert.match(msg.title, /Pricing change/);
  assert.match(msg.body, /Codex moves to new tiers/);
});

test('formatAnnouncementMessage: missing body / source still produces a sane title', () => {
  const item = ann({ id: 'bare', severity: 'urgent', title: { en: 'Bare item' } });
  const msg = formatAnnouncementMessage(item, 'en');
  assert.match(msg.title, /Bare item/);
  assert.equal(msg.body, '');
});

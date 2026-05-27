/**
 * Tests for the recap card period + nudge state machine.
 *
 * `recapPeriodInfo` is a pure function (no DB) so we can call it directly.
 * `evaluateRecapNudge` reads/writes a JSON state file under `dataDir()` and
 * calls `buildRecapCard` (which touches the SQLite DB). We isolate state by
 * pointing `VIBEMETER_DATA_DIR` at a per-test temp directory before the
 * dynamic import — the DB bootstrap will create a fresh sqlite file there.
 */

import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

register('./_resolve.mjs', import.meta.url);

const { recapPeriodInfo } = await import('../src/lib/recap-card.ts');

const DAY_MS = 86_400_000;

test('today period: startMs is local 00:00 and days/billing are sensible', () => {
  // Pick a fixed UTC instant; we test using the user's local clock the way the
  // production code does (Date.getFullYear/getMonth/getDate). The exact 00:00
  // we expect depends on the runner's timezone — so we re-derive it the same
  // way the assertion target derives it, then check internal consistency.
  const now = Date.UTC(2026, 4, 27, 15, 30, 12, 0);
  const info = recapPeriodInfo('today', now);

  assert.equal(info.kind, 'today');
  assert.equal(info.label, 'today');
  assert.equal(info.shortLabel, 'today');
  assert.equal(info.endMs, now);

  // startMs should land on the same wall-clock day's 00:00 local time:
  const startDate = new Date(info.startMs);
  assert.equal(startDate.getHours(), 0);
  assert.equal(startDate.getMinutes(), 0);
  assert.equal(startDate.getSeconds(), 0);
  assert.equal(startDate.getMilliseconds(), 0);
  // and never be later than `now`
  assert.ok(info.startMs <= now);
  // and never be more than 24h earlier
  assert.ok(now - info.startMs < DAY_MS);

  // days should be in [0, 1) — partial-day fraction
  assert.ok(info.days >= 0 && info.days < 1);

  // billingDenominatorDays uses the average-month constant so prorated
  // subscription cost is tiny for one day (~$0.66/day for a $20/mo plan).
  assert.ok(info.billingDenominatorDays > 28 && info.billingDenominatorDays < 32);
});

test('today period at exactly local 00:00 yields days === 0', () => {
  // Construct a `now` that is exactly local midnight by going through Date.
  const ref = new Date(2026, 4, 27, 0, 0, 0, 0);
  const info = recapPeriodInfo('today', ref.getTime());
  assert.equal(info.startMs, ref.getTime());
  assert.equal(info.days, 0);
});

test('7d period boundaries unchanged: endMs = now, startMs = now - 7 days', () => {
  const now = 1_700_000_000_000;
  const info = recapPeriodInfo('7d', now);
  assert.equal(info.kind, '7d');
  assert.equal(info.endMs, now);
  assert.equal(info.startMs, now - 7 * DAY_MS);
  assert.equal(info.days, 7);
});

test('month period boundaries unchanged: startMs is first-of-month local 00:00', () => {
  const now = new Date(2026, 4, 15, 10, 0, 0, 0).getTime();
  const info = recapPeriodInfo('month', now);
  assert.equal(info.kind, 'month');
  const startDate = new Date(info.startMs);
  assert.equal(startDate.getDate(), 1);
  assert.equal(startDate.getMonth(), 4);
  assert.equal(startDate.getHours(), 0);
});

// ---------------------------------------------------------------------------
// Monthly nudge state machine
// ---------------------------------------------------------------------------

interface NudgeStateShape {
  observedResets: Record<string, number>;
  nudgedResets: Record<string, number>;
  lastAnyNudgeAt: number | null;
  lastMonthlyNudgeForMonth: string | null;
  active: unknown;
}

function makeTempDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vibemeter-recap-nudge-'));
  process.env.VIBEMETER_DATA_DIR = dir;
  return dir;
}

test('monthly nudge: state field starts null and only gets set on the 1st of the month', async () => {
  const dir = makeTempDataDir();
  try {
    // Fresh import per test scope so the in-process state is clean. Node's
    // ES module cache will still cache previous instances, but the modules
    // we import are stateless (state lives on disk).
    const { evaluateRecapNudge } = await import('../src/lib/recap-nudge.ts');
    const { readFileSync, existsSync } = await import('node:fs');

    // Call from a non-first-of-month date — no monthly nudge should be created.
    const may15 = new Date(2026, 4, 15, 12, 0, 0).getTime();
    const noNudge = evaluateRecapNudge({ generatedAt: may15, quotas: [] } as unknown as Parameters<typeof evaluateRecapNudge>[0], { now: may15, notify: false });
    assert.equal(noNudge, null);

    const statePath = path.join(dir, 'recap-nudge-state.json');
    assert.ok(existsSync(statePath));
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as NudgeStateShape;
    assert.equal(state.lastMonthlyNudgeForMonth, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('monthly nudge: does not fire when previous month has no data', async () => {
  const dir = makeTempDataDir();
  try {
    const { evaluateRecapNudge } = await import('../src/lib/recap-nudge.ts');
    const { readFileSync } = await import('node:fs');

    // First-of-month with empty DB — buildRecapCard will report no minimum
    // data, so the monthly trigger should bail out and leave the state
    // marker null (we want to retry later if data ever appears).
    const jun1 = new Date(2026, 5, 1, 9, 0, 0).getTime();
    const nudge = evaluateRecapNudge({ generatedAt: jun1, quotas: [] } as unknown as Parameters<typeof evaluateRecapNudge>[0], { now: jun1, notify: false });
    assert.equal(nudge, null);

    const statePath = path.join(dir, 'recap-nudge-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as NudgeStateShape;
    assert.equal(state.lastMonthlyNudgeForMonth, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('monthly nudge: pre-marking the state prevents a second nudge for the same month', async () => {
  const dir = makeTempDataDir();
  try {
    const { evaluateRecapNudge } = await import('../src/lib/recap-nudge.ts');
    const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs');

    // Pre-seed the state file as if we already nudged for May 2026. This is
    // the deduplication boundary the state machine guards against — even on
    // June 1st, re-invoking shouldn't fire a second monthly nudge.
    const statePath = path.join(dir, 'recap-nudge-state.json');
    mkdirSync(path.dirname(statePath), { recursive: true });
    const preState: NudgeStateShape = {
      observedResets: {},
      nudgedResets: {},
      lastAnyNudgeAt: null,
      lastMonthlyNudgeForMonth: '2026-05',
      active: null,
    };
    writeFileSync(statePath, JSON.stringify(preState, null, 2) + '\n');

    const jun1 = new Date(2026, 5, 1, 12, 0, 0).getTime();
    const nudge = evaluateRecapNudge({ generatedAt: jun1, quotas: [] } as unknown as Parameters<typeof evaluateRecapNudge>[0], { now: jun1, notify: false });
    assert.equal(nudge, null);

    const state = JSON.parse(readFileSync(statePath, 'utf8')) as NudgeStateShape;
    // Marker stays at May 2026 — we didn't bump it because we didn't fire.
    assert.equal(state.lastMonthlyNudgeForMonth, '2026-05');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

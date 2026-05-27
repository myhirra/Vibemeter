import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import path from 'node:path';
import { dataDir } from './data-dir';
import type { FloatStats } from './float-stats';
import { buildRecapCard } from './recap-card';
import { readRecapSettings } from './recap-settings';
import { sendNativeNotification } from './notify-installer';

export type RecapNudgeKind = 'weekly_reset' | 'monthly_recap';

export interface RecapNudge {
  id: string;
  createdAt: number;
  expiresAt: number;
  /** Source agent for quota-reset nudges; null for cadence-based nudges (monthly). */
  agent: 'claude-code' | 'codex' | null;
  /** Quota window for reset nudges; null for cadence-based nudges. */
  window: '5h' | 'weekly' | null;
  /** Quota reset timestamp for reset nudges; null for cadence-based nudges. */
  resetAt: number | null;
  headline: string;
  detail: string;
  kind: RecapNudgeKind;
  /** Which recap period this nudge is offering ('7d' or 'month'). */
  period: 'today' | '7d' | 'month';
}

interface RecapNudgeState {
  observedResets: Record<string, number>;
  nudgedResets: Record<string, number>;
  lastAnyNudgeAt: number | null;
  /**
   * YYYY-MM of the most recently nudged-for month (in user's local time).
   * Used by the monthly cadence trigger so we only fire once per calendar
   * month even if the dashboard rebuilds multiple times.
   */
  lastMonthlyNudgeForMonth: string | null;
  active: RecapNudge | null;
}

const EMPTY_STATE: RecapNudgeState = {
  observedResets: {},
  nudgedResets: {},
  lastAnyNudgeAt: null,
  lastMonthlyNudgeForMonth: null,
  active: null,
};

const ACTIVE_TTL_MS = 36 * 3_600_000;
const MIN_NUDGE_INTERVAL_MS = 6 * 3_600_000;

function statePath(): string {
  return path.join(dataDir(), 'recap-nudge-state.json');
}

function migrateActive(raw: Partial<RecapNudge> | null | undefined): RecapNudge | null {
  if (!raw || typeof raw !== 'object') return null;
  // Defensive: any pre-existing nudge persisted before kind/period existed
  // was always a weekly reset (the only kind that existed). Default both.
  const kind: RecapNudgeKind = raw.kind === 'monthly_recap' ? 'monthly_recap' : 'weekly_reset';
  const period: RecapNudge['period'] = raw.period === 'month' ? 'month'
    : raw.period === 'today' ? 'today'
    : '7d';
  if (
    typeof raw.id !== 'string'
    || typeof raw.createdAt !== 'number'
    || typeof raw.expiresAt !== 'number'
    || typeof raw.headline !== 'string'
    || typeof raw.detail !== 'string'
  ) return null;
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    agent: (raw.agent === 'claude-code' || raw.agent === 'codex') ? raw.agent : null,
    window: (raw.window === '5h' || raw.window === 'weekly') ? raw.window : null,
    resetAt: typeof raw.resetAt === 'number' ? raw.resetAt : null,
    headline: raw.headline,
    detail: raw.detail,
    kind,
    period,
  };
}

function readState(): RecapNudgeState {
  try {
    const file = statePath();
    if (!existsSync(file)) return { ...EMPTY_STATE, observedResets: {}, nudgedResets: {} };
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<RecapNudgeState> & {
      active?: Partial<RecapNudge> | null;
    };
    return {
      observedResets: raw.observedResets && typeof raw.observedResets === 'object' ? raw.observedResets : {},
      nudgedResets: raw.nudgedResets && typeof raw.nudgedResets === 'object' ? raw.nudgedResets : {},
      lastAnyNudgeAt: typeof raw.lastAnyNudgeAt === 'number' ? raw.lastAnyNudgeAt : null,
      lastMonthlyNudgeForMonth: typeof raw.lastMonthlyNudgeForMonth === 'string' ? raw.lastMonthlyNudgeForMonth : null,
      active: migrateActive(raw.active),
    };
  } catch {
    return { ...EMPTY_STATE, observedResets: {}, nudgedResets: {} };
  }
}

function writeState(state: RecapNudgeState): void {
  const file = statePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

function nudgeCopy(
  roi: number | null,
  valueUsd: number,
  scope: 'week' | 'month',
): { headline: string; detail: string } {
  const label = scope === 'month' ? 'Your month' : 'Your week';
  if (roi != null) {
    const roiLabel = roi >= 100 ? roi.toFixed(0) : roi.toFixed(1).replace(/\.0$/, '');
    return {
      headline: `${label}: ${roiLabel}x return`,
      detail: 'Make a shareable recap card?',
    };
  }
  return {
    headline: `${label}: $${valueUsd.toFixed(valueUsd >= 10 ? 1 : 2)} API-equivalent value`,
    detail: 'Make a shareable recap card?',
  };
}

function maybeNotify(nudge: RecapNudge): void {
  if (platform() !== 'darwin') return;
  const settings = readRecapSettings();
  if (!settings.nativeNudgeEnabled) return;
  const title = nudge.kind === 'monthly_recap' ? 'Vibemeter monthly recap' : 'Vibemeter weekly recap';
  sendNativeNotification(title, nudge.headline, 'vibemeter-recap');
}

/** YYYY-MM of the calendar month a timestamp falls inside, in user's local time. */
function monthKey(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** Local timestamp for the first millisecond of the calendar month a `ms` falls in. */
function firstOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local timestamp for the first millisecond of the previous calendar month. */
function firstOfPrevMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
}

export function readActiveRecapNudge(now = Date.now()): RecapNudge | null {
  const state = readState();
  if (!state.active) return null;
  if (state.active.expiresAt <= now) return null;
  return state.active;
}

export function dismissRecapNudge(id: string | null = null): RecapNudge | null {
  const state = readState();
  if (!state.active) return null;
  if (id && state.active.id !== id) return state.active;
  const dismissed = state.active;
  state.active = null;
  writeState(state);
  return dismissed;
}

export function evaluateRecapNudge(stats: FloatStats, opts: { notify?: boolean; now?: number } = {}): RecapNudge | null {
  const now = opts.now ?? Date.now();
  const settings = readRecapSettings();
  const state = readState();
  let created: RecapNudge | null = null;

  // ---------------------------------------------------------------
  // Monthly cadence trigger (sibling to the quota-reset weekly check).
  // Fires on the 1st of the month (user local time) when:
  //   - we haven't already nudged for the previous calendar month, AND
  //   - the previous-month recap has minimumData.ok === true.
  // The monthly card is built at the previous-month boundary so its
  // `period.startMs`/`endMs` line up cleanly with that full month.
  // ---------------------------------------------------------------
  const nowDate = new Date(now);
  const isFirstOfMonth = nowDate.getDate() === 1;
  if (isFirstOfMonth) {
    const prevMonthAnchor = firstOfPrevMonth(now);
    const prevMonthKey = monthKey(prevMonthAnchor);
    if (state.lastMonthlyNudgeForMonth !== prevMonthKey) {
      // Build a recap whose `now` sits inside the previous calendar month.
      // We pass the last instant of the previous month (firstOfMonth(now) - 1)
      // so `recapPeriodInfo('month', now)` resolves to the previous month.
      const lastInstantPrev = firstOfMonth(now) - 1;
      const monthlyCard = buildRecapCard({ period: 'month', now: lastInstantPrev, settings });
      if (monthlyCard.minimumData.ok && (monthlyCard.roiMultiplier != null || monthlyCard.valueAtApiRatesUsd > 0)) {
        const copy = nudgeCopy(monthlyCard.roiMultiplier, monthlyCard.valueAtApiRatesUsd, 'month');
        created = {
          id: `monthly:${prevMonthKey}`,
          createdAt: now,
          expiresAt: now + ACTIVE_TTL_MS,
          agent: null,
          window: null,
          resetAt: null,
          headline: copy.headline,
          detail: copy.detail,
          kind: 'monthly_recap',
          period: 'month',
        };
        state.active = created;
        state.lastMonthlyNudgeForMonth = prevMonthKey;
        state.lastAnyNudgeAt = now;
        if (opts.notify) maybeNotify(created);
      }
    }
  }

  if (!created) {
    for (const quota of stats.quotas) {
      const candidates: Array<{ window: '5h' | 'weekly'; resetAt: number | null }> = [
        { window: '5h', resetAt: quota.resetAt5h },
        { window: 'weekly', resetAt: quota.resetAtWeekly },
      ];
      for (const candidate of candidates) {
        if (candidate.resetAt == null) continue;
        const observedKey = `${quota.agent}:${candidate.window}`;
        const resetKey = `${observedKey}:${candidate.resetAt}`;
        const prev = state.observedResets[observedKey] ?? null;
        state.observedResets[observedKey] = candidate.resetAt;
        if (prev == null || prev === candidate.resetAt) continue;
        if (state.nudgedResets[resetKey]) continue;
        if (state.lastAnyNudgeAt != null && now - state.lastAnyNudgeAt < MIN_NUDGE_INTERVAL_MS) continue;

        const card = buildRecapCard({ period: '7d', now, settings });
        if (!card.minimumData.ok) continue;
        if (card.roiMultiplier == null && card.valueAtApiRatesUsd <= 0) continue;
        const copy = nudgeCopy(card.roiMultiplier, card.valueAtApiRatesUsd, 'week');
        created = {
          id: resetKey,
          createdAt: now,
          expiresAt: now + ACTIVE_TTL_MS,
          agent: quota.agent,
          window: candidate.window,
          resetAt: candidate.resetAt,
          headline: copy.headline,
          detail: copy.detail,
          kind: 'weekly_reset',
          period: '7d',
        };
        state.active = created;
        state.nudgedResets[resetKey] = now;
        state.lastAnyNudgeAt = now;
        if (opts.notify) maybeNotify(created);
        break;
      }
      if (created) break;
    }
  }

  writeState(state);
  return created ?? readActiveRecapNudge(now);
}

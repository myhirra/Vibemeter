// Single-process telemetry heartbeat. Started once by `instrumentation.ts`
// register() when the Next.js server boots (mirrors the alerts ticker). Sends
// one anonymous payload per local day — but ONLY if the user explicitly opts
// in via VIBEMETER_TELEMETRY=1. Off by default, so "no telemetry" holds for
// the default install.

import { buildTelemetryPayload } from './payload';
import { getLastSentDay, markSentDay } from './install-id';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly; only one send lands per day
const FIRST_TICK_DELAY_MS = 30_000; // let the server boot + DB settle before reading stats
const SEND_TIMEOUT_MS = 8_000;
const GLOBAL_KEY = '__vibemeter_telemetry_ticker__';

interface TickerHandle {
  timer: NodeJS.Timeout;
  startedAt: number;
}

type GlobalWithTicker = typeof globalThis & { [GLOBAL_KEY]?: TickerHandle };

function isEnabled(): boolean {
  const v = (process.env.VIBEMETER_TELEMETRY || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on';
}

function endpointUrl(): string {
  const env = process.env.VIBEMETER_TELEMETRY_URL;
  return env && env.length > 0 ? env : 'https://vibemeter.siney.top/v1/telemetry';
}

function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function sendOnce(): Promise<void> {
  const today = localDay();
  if (getLastSentDay() === today) return;

  const payload = await buildTelemetryPayload();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(endpointUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vibemeter-Telemetry': '1' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Any 2xx (the server replies 204) means accepted — record so we don't
    // re-send today. On failure we leave lastSentDay untouched and retry next tick.
    if (res.ok) markSentDay(today);
  } finally {
    clearTimeout(timeout);
  }
}

export function startTelemetryTicker(): void {
  const g = globalThis as GlobalWithTicker;
  if (g[GLOBAL_KEY]) return;

  // Opt-in only: stay completely silent unless the user turned it on, so the
  // default install sends nothing (and "no telemetry" stays true).
  if (!isEnabled()) return;

  // One-time disclosure of exactly what the opt-in heartbeat sends.
  console.error(
    '[vibemeter:telemetry] enabled via VIBEMETER_TELEMETRY — sending an anonymous daily '
    + 'heartbeat (random install id, version, platform, usage counts; no paths/projects/tokens).',
  );

  const tick = async () => {
    try {
      await sendOnce();
    } catch (err) {
      // Never let a flaky network tear the ticker (or the server) down.
      console.error('[vibemeter:telemetry] tick failed:', err instanceof Error ? err.message : err);
    }
  };

  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref?.();

  g[GLOBAL_KEY] = { timer, startedAt: Date.now() };
}

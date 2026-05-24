// Single-process ticker. Started once by `instrumentation.ts` register() when
// the Next.js server boots. Re-invocations are no-ops (idempotent under HMR).

import { runAlertsOnce } from './runner';

const TICK_INTERVAL_MS = 60_000;
const FIRST_TICK_DELAY_MS = 5_000; // let the server finish booting before the first quota read
const GLOBAL_KEY = '__vibemeter_alerts_ticker__';

interface TickerHandle {
  timer: NodeJS.Timeout;
  startedAt: number;
}

type GlobalWithTicker = typeof globalThis & { [GLOBAL_KEY]?: TickerHandle };

export function startAlertsTicker(): void {
  const g = globalThis as GlobalWithTicker;
  if (g[GLOBAL_KEY]) return;

  const tick = async () => {
    try {
      await runAlertsOnce();
    } catch (err) {
      // We swallow errors here so a flaky push or quota read never tears the
      // ticker down. The webhook URL is in the channel, not in this error,
      // so it's safe to log the message itself.
      console.error('[vibemeter:alerts] tick failed:', err instanceof Error ? err.message : err);
    }
  };

  const timer = setInterval(tick, TICK_INTERVAL_MS);
  // Allow the process to exit normally if everything else is done.
  if (typeof timer.unref === 'function') timer.unref();
  setTimeout(tick, FIRST_TICK_DELAY_MS).unref?.();

  g[GLOBAL_KEY] = { timer, startedAt: Date.now() };
}

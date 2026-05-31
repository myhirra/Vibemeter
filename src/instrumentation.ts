// Next.js instrumentation hook — runs once per server boot. Used to start
// the alerts ticker so quota thresholds and daily summaries fire even when
// no one is hitting the dashboard.

export async function register() {
  // Edge runtime has no setInterval/long-lived state; only boot the ticker
  // on the Node.js server runtime where the dashboard actually runs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startAlertsTicker } = await import('@/lib/alerts/ticker');
  startAlertsTicker();
  const { startTelemetryTicker } = await import('@/lib/telemetry/ticker');
  startTelemetryTicker();
}

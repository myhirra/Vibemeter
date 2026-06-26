export function normalizeQuotaWindow(
  usedPct: number | null,
  resetAt: number | null,
  windowMs: number,
  now = Date.now(),
  capturedAt: number | null = null,
): { used: number | null; remaining: number | null; resetAt: number | null; rolledOver: boolean; stale: boolean } {
  if (usedPct == null) {
    return { used: null, remaining: null, resetAt, rolledOver: false, stale: false };
  }

  // The snapshot itself hasn't been refreshed for longer than a full window
  // (e.g. Codex quota only updates when a Codex session actually runs). We have
  // no recent reading, so we must NOT fabricate a rollover to 0% with a fresh
  // "resets in Xh" countdown out of dead data — that makes a stale ring look
  // confidently current. Keep the last-known usage and flag it stale instead.
  if (capturedAt != null && now - capturedAt > windowMs) {
    const used = Math.max(0, Math.min(100, usedPct));
    return {
      used,
      remaining: Math.max(0, 100 - used),
      resetAt,
      rolledOver: false,
      stale: true,
    };
  }

  if (resetAt != null && resetAt <= now) {
    const elapsedWindows = Math.floor((now - resetAt) / windowMs) + 1;
    return {
      used: 0,
      remaining: 100,
      resetAt: resetAt + elapsedWindows * windowMs,
      rolledOver: true,
      stale: false,
    };
  }

  const used = Math.max(0, Math.min(100, usedPct));
  return {
    used,
    remaining: Math.max(0, 100 - used),
    resetAt,
    rolledOver: false,
    stale: false,
  };
}

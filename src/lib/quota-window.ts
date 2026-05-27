export function normalizeQuotaWindow(
  usedPct: number | null,
  resetAt: number | null,
  windowMs: number,
  now = Date.now(),
): { used: number | null; remaining: number | null; resetAt: number | null; rolledOver: boolean } {
  if (usedPct == null) {
    return { used: null, remaining: null, resetAt, rolledOver: false };
  }

  if (resetAt != null && resetAt <= now) {
    const elapsedWindows = Math.floor((now - resetAt) / windowMs) + 1;
    return {
      used: 0,
      remaining: 100,
      resetAt: resetAt + elapsedWindows * windowMs,
      rolledOver: true,
    };
  }

  const used = Math.max(0, Math.min(100, usedPct));
  return {
    used,
    remaining: Math.max(0, 100 - used),
    resetAt,
    rolledOver: false,
  };
}

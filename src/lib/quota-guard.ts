import type { FloatQuota, FloatStats } from './float-stats';

export type GuardStatus = 'safe' | 'watch' | 'risky' | 'wait' | 'unknown';

export interface GuardQuotaLine {
  agent: FloatQuota['agent'];
  label: string;
  accountLabel: string | null;
  remaining5h: number | null;
  remainingWeekly: number | null;
  resetAt5h: number | null;
  resetAtWeekly: number | null;
  pace5hExhaustMin: number | null;
  minRemaining: number | null;
}

export interface GuardDecision {
  status: GuardStatus;
  headline: string;
  detail: string;
  minRemaining: number | null;
  pace5hExhaustMin: number | null;
  generatedAt: number;
  quotas: GuardQuotaLine[];
}

function minKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length ? Math.min(...known) : null;
}

function quotaLine(quota: FloatQuota): GuardQuotaLine {
  return {
    agent: quota.agent,
    label: quota.label,
    accountLabel: quota.accountLabel,
    remaining5h: quota.remaining5h,
    remainingWeekly: quota.remainingWeekly,
    resetAt5h: quota.resetAt5h,
    resetAtWeekly: quota.resetAtWeekly,
    pace5hExhaustMin: quota.pace5hExhaustMin,
    minRemaining: minKnown([quota.remaining5h, quota.remainingWeekly]),
  };
}

export function decideQuotaGuard(stats: Pick<FloatStats, 'generatedAt' | 'quotas'>): GuardDecision {
  const quotas = stats.quotas.map(quotaLine);
  if (quotas.length === 0) {
    return {
      status: 'unknown',
      headline: 'No quota snapshot yet',
      detail: 'Run Claude Code or Codex once, then refresh Vibemeter before starting a long task.',
      minRemaining: null,
      pace5hExhaustMin: null,
      generatedAt: stats.generatedAt,
      quotas,
    };
  }

  const minRemaining = minKnown(quotas.map((quota) => quota.minRemaining));
  const paceValues = quotas
    .map((quota) => quota.pace5hExhaustMin)
    .filter((value): value is number => value != null);
  const pace5hExhaustMin = paceValues.length ? Math.min(...paceValues) : null;

  if ((minRemaining != null && minRemaining <= 10) || (pace5hExhaustMin != null && pace5hExhaustMin <= 20)) {
    return {
      status: 'wait',
      headline: 'Wait for reset',
      detail: 'Quota is too tight for a new agent run. Finish only small follow-ups or wait for the next reset.',
      minRemaining,
      pace5hExhaustMin,
      generatedAt: stats.generatedAt,
      quotas,
    };
  }

  if ((minRemaining != null && minRemaining <= 25) || (pace5hExhaustMin != null && pace5hExhaustMin <= 60)) {
    return {
      status: 'risky',
      headline: 'Avoid long tasks',
      detail: 'Short edits are fine, but a test-fixing or refactor loop may hit limits before it finishes.',
      minRemaining,
      pace5hExhaustMin,
      generatedAt: stats.generatedAt,
      quotas,
    };
  }

  if ((minRemaining != null && minRemaining <= 45) || (pace5hExhaustMin != null && pace5hExhaustMin <= 120)) {
    return {
      status: 'watch',
      headline: 'Short or medium tasks are OK',
      detail: 'Start with a bounded prompt, keep the task narrow, and refresh before a long multi-step run.',
      minRemaining,
      pace5hExhaustMin,
      generatedAt: stats.generatedAt,
      quotas,
    };
  }

  return {
    status: 'safe',
    headline: 'Safe to start',
    detail: 'Quota runway looks healthy for a long Claude Code or Codex task.',
    minRemaining,
    pace5hExhaustMin,
    generatedAt: stats.generatedAt,
    quotas,
  };
}


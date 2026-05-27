import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './data-dir';

export type RecapSubscriptionPlan = 'unset' | 'api' | 'pro' | 'max5x' | 'max20x' | 'custom';

export interface RecapSettings {
  subscriptionPlan: RecapSubscriptionPlan;
  customMonthlyUsd: number | null;
  nativeNudgeEnabled: boolean;
}

export interface ResolvedRecapPlan {
  kind: 'unset' | 'api' | 'subscription';
  label: string;
  monthlyUsd: number | null;
}

export const RECAP_PLAN_OPTIONS: Record<Exclude<RecapSubscriptionPlan, 'custom' | 'unset' | 'api'>, { label: string; monthlyUsd: number }> = {
  pro: { label: 'Pro', monthlyUsd: 20 },
  max5x: { label: 'Max 5x', monthlyUsd: 100 },
  max20x: { label: 'Max 20x', monthlyUsd: 200 },
};

export const DEFAULT_RECAP_SETTINGS: RecapSettings = {
  subscriptionPlan: 'unset',
  customMonthlyUsd: null,
  nativeNudgeEnabled: false,
};

function settingsPath(): string {
  return path.join(dataDir(), 'recap-settings.json');
}

function saneMonthly(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 10_000) return null;
  return Math.round(n * 100) / 100;
}

export function normalizeRecapSettings(input: unknown): RecapSettings {
  const obj = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const plan = obj.subscriptionPlan;
  const subscriptionPlan: RecapSubscriptionPlan =
    plan === 'api' || plan === 'pro' || plan === 'max5x' || plan === 'max20x' || plan === 'custom'
      ? plan
      : 'unset';

  return {
    subscriptionPlan,
    customMonthlyUsd: saneMonthly(obj.customMonthlyUsd),
    nativeNudgeEnabled: obj.nativeNudgeEnabled === true,
  };
}

export function readRecapSettings(): RecapSettings {
  try {
    const file = settingsPath();
    if (!existsSync(file)) return DEFAULT_RECAP_SETTINGS;
    return normalizeRecapSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return DEFAULT_RECAP_SETTINGS;
  }
}

export function writeRecapSettings(settings: RecapSettings): RecapSettings {
  const normalized = normalizeRecapSettings(settings);
  const file = settingsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(normalized, null, 2) + '\n');
  try { chmodSync(file, 0o600); } catch { /* best-effort */ }
  return normalized;
}

export function resolveRecapPlan(settings: RecapSettings): ResolvedRecapPlan {
  if (settings.subscriptionPlan === 'api') {
    return { kind: 'api', label: 'Pay-as-you-go API', monthlyUsd: null };
  }
  if (settings.subscriptionPlan === 'custom') {
    return settings.customMonthlyUsd != null
      ? { kind: 'subscription', label: 'Custom', monthlyUsd: settings.customMonthlyUsd }
      : { kind: 'unset', label: 'Not set', monthlyUsd: null };
  }
  if (settings.subscriptionPlan === 'pro' || settings.subscriptionPlan === 'max5x' || settings.subscriptionPlan === 'max20x') {
    const plan = RECAP_PLAN_OPTIONS[settings.subscriptionPlan];
    return { kind: 'subscription', label: plan.label, monthlyUsd: plan.monthlyUsd };
  }
  return { kind: 'unset', label: 'Not set', monthlyUsd: null };
}

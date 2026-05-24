// On-disk persistence for the alerts feature. Lives in <dataDir>/alerts.json
// (user-local, NEVER in the repo or shipped npm bundle). 0600 perms because
// the file contains webhook URLs that are effectively secrets.

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/data-dir';
import { EMPTY_CONFIG, EMPTY_STATE, type AlertConfig, type AlertState } from './types';

const CONFIG_FILE = 'alerts.json';
const STATE_FILE = 'alerts-state.json';

export function alertsConfigPath(): string {
  return path.join(dataDir(), CONFIG_FILE);
}

export function alertsStatePath(): string {
  return path.join(dataDir(), STATE_FILE);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown, secret: boolean) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  if (secret) {
    try { chmodSync(file, 0o600); } catch { /* best-effort */ }
  }
}

export function readAlertConfig(): AlertConfig {
  const raw = readJson<Partial<AlertConfig>>(alertsConfigPath(), EMPTY_CONFIG);
  const pushLocale = raw.pushLocale === 'en' || raw.pushLocale === 'zh' ? raw.pushLocale : 'zh';
  return {
    channels: Array.isArray(raw.channels) ? raw.channels : [],
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    pushLocale,
  };
}

export function writeAlertConfig(config: AlertConfig): void {
  writeJson(alertsConfigPath(), config, true);
}

export function readAlertState(): AlertState {
  const raw = readJson<Partial<AlertState>>(alertsStatePath(), EMPTY_STATE);
  return { rules: raw.rules ?? {} };
}

export function writeAlertState(state: AlertState): void {
  // State file doesn't contain secrets but mirror perms anyway.
  writeJson(alertsStatePath(), state, false);
}

// Masks the webhook so the value is safe to return from APIs and render in
// the Settings UI without leaking the secret. We keep just enough trailing
// chars to recognise which channel a row belongs to.
export function maskWebhook(webhook: string): string {
  if (!webhook) return '';
  if (webhook.length <= 12) return '••••';
  const tail = webhook.slice(-6);
  return `${webhook.slice(0, 8)}••••${tail}`;
}

// Sentinel passed from the UI on PUT when the user did not edit an existing
// webhook field. The API merges these back against the stored value so a
// round-trip GET→PUT never leaks the masked form into storage.
export const WEBHOOK_UNCHANGED_SENTINEL = '__VIBEMETER_WEBHOOK_UNCHANGED__';

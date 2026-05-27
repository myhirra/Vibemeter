/**
 * On-disk license storage.
 *
 *   • The raw license key lives in the macOS keychain (generic password,
 *     service `com.hirra.vibemeter.license`). On non-macOS systems or when
 *     the keychain is unavailable, we fall back to
 *     `<dataDir>/license-key.txt` chmod 0600.
 *
 *   • License metadata (provider, plan, status, masked key, instance id,
 *     timestamps, …) is non-secret and lives in
 *     `<dataDir>/license-state.json`. We still chmod 0600 because the
 *     instance id is technically identifying.
 *
 * All functions are synchronous and catch errors locally — callers get back
 * `null` or `false` rather than an exception.
 */

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { dataDir } from '@/lib/data-dir';
import { EMPTY_STATE, type LicenseState } from './provider';

const STATE_FILE = 'license-state.json';
const FALLBACK_KEY_FILE = 'license-key.txt';
const KEYCHAIN_SERVICE = 'com.hirra.vibemeter.license';
const KEYCHAIN_ACCOUNT = 'vibemeter';

export function licenseStatePath(): string {
  return path.join(dataDir(), STATE_FILE);
}

function fallbackKeyPath(): string {
  return path.join(dataDir(), FALLBACK_KEY_FILE);
}

function isDarwin(): boolean {
  // VIBEMETER_LICENSE_FORCE_FALLBACK is set by tests to skip the keychain.
  if (process.env.VIBEMETER_LICENSE_FORCE_FALLBACK === '1') return false;
  return os.platform() === 'darwin';
}

export function readState(): LicenseState {
  try {
    const file = licenseStatePath();
    if (!existsSync(file)) return EMPTY_STATE;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LicenseState>;
    return normalizeState(raw);
  } catch {
    return EMPTY_STATE;
  }
}

function normalizeState(raw: Partial<LicenseState>): LicenseState {
  return {
    provider: raw.provider === 'mock' ? 'mock' : 'lemonsqueezy',
    plan: raw.plan === 'pro' || raw.plan === 'team' ? raw.plan : 'free',
    status:
      raw.status === 'active' || raw.status === 'inactive' || raw.status === 'expired' || raw.status === 'disabled'
        ? raw.status
        : 'none',
    licenseKeyLast4: typeof raw.licenseKeyLast4 === 'string' ? raw.licenseKeyLast4 : null,
    instanceId: typeof raw.instanceId === 'string' ? raw.instanceId : null,
    instanceName: typeof raw.instanceName === 'string' ? raw.instanceName : null,
    activatedAt: typeof raw.activatedAt === 'number' ? raw.activatedAt : null,
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : null,
    lastValidatedAt: typeof raw.lastValidatedAt === 'number' ? raw.lastValidatedAt : null,
    validationGraceUntil: typeof raw.validationGraceUntil === 'number' ? raw.validationGraceUntil : null,
    productName: typeof raw.productName === 'string' ? raw.productName : null,
    variantName: typeof raw.variantName === 'string' ? raw.variantName : null,
  };
}

export function writeState(state: LicenseState): boolean {
  try {
    const file = licenseStatePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
    try { chmodSync(file, 0o600); } catch { /* best-effort */ }
    return true;
  } catch {
    return false;
  }
}

export function readKey(): string | null {
  if (isDarwin()) {
    const fromKeychain = readKeyFromKeychain();
    if (fromKeychain != null) return fromKeychain;
  }
  return readKeyFromFile();
}

function readKeyFromKeychain(): string | null {
  try {
    const r = spawnSync(
      '/usr/bin/security',
      ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8' },
    );
    if (r.status === 0) {
      const value = (r.stdout ?? '').replace(/\n$/, '');
      return value.length > 0 ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

function readKeyFromFile(): string | null {
  try {
    const file = fallbackKeyPath();
    if (!existsSync(file)) return null;
    const value = readFileSync(file, 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (isDarwin() && writeKeyToKeychain(trimmed)) return true;
  return writeKeyToFile(trimmed);
}

function writeKeyToKeychain(key: string): boolean {
  try {
    const r = spawnSync(
      '/usr/bin/security',
      ['add-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w', key, '-U'],
      { encoding: 'utf8' },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

function writeKeyToFile(key: string): boolean {
  try {
    const file = fallbackKeyPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, key + '\n');
    try { chmodSync(file, 0o600); } catch { /* best-effort */ }
    return true;
  } catch {
    return false;
  }
}

export function clearAll(): boolean {
  let ok = true;
  if (isDarwin()) {
    try {
      // Ignore exit status — keychain may already be empty.
      spawnSync('/usr/bin/security', ['delete-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE], {
        stdio: 'ignore',
      });
    } catch { ok = false; }
  }
  try {
    const f = fallbackKeyPath();
    if (existsSync(f)) unlinkSync(f);
  } catch { ok = false; }
  try {
    const f = licenseStatePath();
    if (existsSync(f)) unlinkSync(f);
  } catch { ok = false; }
  return ok;
}

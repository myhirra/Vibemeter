/**
 * Server-only helpers for the redact / demo mode.
 *
 * The toggle is stored as a cookie (`vibemeter:redact=1`) so a single
 * click + page reload is enough — no API roundtrip needed. The deterministic
 * salt lives at `<dataDir>/redact-salt` and is generated lazily the first
 * time redact mode is read on the server. Caching it on disk means the masked
 * project labels stay stable across server restarts.
 */
import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { dataDir } from './data-dir';

export const REDACT_COOKIE = 'vibemeter:redact';

/** Where the per-install random salt is persisted. */
function saltPath(): string {
  return path.join(dataDir(), 'redact-salt');
}

/**
 * Read the on-disk salt, generating it on first call. The salt is a 16-byte
 * random hex string — plenty for the small bucket space we mod into, and
 * stable across server restarts so screenshots taken on different days stay
 * visually consistent.
 */
export function getRedactSalt(): string {
  const file = saltPath();
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    // file missing — fall through to create it
  }
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, salt, { mode: 0o600 });
  } catch {
    // If we can't persist (read-only fs in some sandbox), still return the
    // salt — the screenshot will be consistent within this server lifetime.
  }
  return salt;
}

/** Read the redact cookie. Returns true when it is set to `1`. */
export async function isRedactEnabled(): Promise<boolean> {
  const store = await cookies();
  return store.get(REDACT_COOKIE)?.value === '1';
}

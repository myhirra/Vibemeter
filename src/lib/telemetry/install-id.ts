import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { dataDir } from '../data-dir';

// Anonymous, per-install identifier plus the day we last sent telemetry. Lives
// in ~/.vibemeter/telemetry-state.json (mirrors the recap-nudge state file).
// The id is a random UUID — no machine fingerprint, no PII. Deleting the file
// resets it. We keep `lastSentDay` here so the ticker only sends once per day
// even across server restarts.

interface TelemetryState {
  installId: string;
  lastSentDay: string | null;
}

function statePath(): string {
  return path.join(dataDir(), 'telemetry-state.json');
}

function readState(): TelemetryState | null {
  try {
    const file = statePath();
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<TelemetryState>;
    if (typeof raw.installId !== 'string' || raw.installId.length === 0) return null;
    return {
      installId: raw.installId,
      lastSentDay: typeof raw.lastSentDay === 'string' ? raw.lastSentDay : null,
    };
  } catch {
    return null;
  }
}

function writeState(state: TelemetryState): void {
  const file = statePath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

/** Get-or-create the anonymous install id, persisting a freshly minted one. */
export function getInstallId(): string {
  const existing = readState();
  if (existing) return existing.installId;
  const installId = randomUUID();
  writeState({ installId, lastSentDay: null });
  return installId;
}

/** The day (YYYY-MM-DD string) telemetry was last sent, or null. */
export function getLastSentDay(): string | null {
  return readState()?.lastSentDay ?? null;
}

/** Record that telemetry was sent for `day`, preserving the install id. */
export function markSentDay(day: string): void {
  const state = readState() ?? { installId: getInstallId(), lastSentDay: null };
  writeState({ installId: state.installId, lastSentDay: day });
}

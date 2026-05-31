import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getInstallId } from './install-id';
import { getFloatStats } from '../float-stats';

// Anonymous telemetry payload. Intentionally narrow: an opaque install id plus
// coarse environment + usage-intensity counters. No project names, paths, token
// counts, or session content ever leave the machine.
export interface TelemetryPayload {
  installId: string;
  version: string;
  platform: string;
  locale: 'zh' | 'en';
  /** Agents the user actually exercises (has a quota snapshot or sessions today). */
  agents: string[];
  /** Total sessions started today across all agents. */
  sessionsToday: number;
}

function readVersion(): string {
  const env = process.env.NEXT_PUBLIC_VIBEMETER_VERSION;
  if (env && env.length > 0) return env;
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through
  }
  return 'unknown';
}

function readLocale(): 'zh' | 'en' {
  const raw = (process.env.LC_ALL || process.env.LANG || process.env.LANGUAGE || '').toLowerCase();
  return raw.includes('zh') ? 'zh' : 'en';
}

export async function buildTelemetryPayload(): Promise<TelemetryPayload> {
  const stats = await getFloatStats();
  const fromQuotas = stats.quotas.map((q) => q.agent);
  const fromSessions = stats.sessionStatsByAgent
    .filter((s) => s.todaySessions > 0)
    .map((s) => s.agent);
  const agents = [...new Set([...fromQuotas, ...fromSessions])].sort();

  return {
    installId: getInstallId(),
    version: readVersion(),
    platform: process.platform,
    locale: readLocale(),
    agents,
    sessionsToday: stats.todaySessions,
  };
}

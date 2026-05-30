// Team rollup exchange format.
//
// This is the ONE unit two transports share: today a member writes it to a
// JSON file that a team lead collects; later a member can POST the exact same
// object to a self-hosted aggregator. Keeping the schema versioned and the
// validator strict means the file path and the future server path never drift.
//
// Privacy by construction: a member report carries *metrics only* — token
// counts, cost, cache hit rate, session/commit counts, and project labels that
// are already redacted when the member has redact mode on. No code, no
// transcripts, no prompts ever enter this object.

export const TEAM_REPORT_SCHEMA_VERSION = 1;

export interface TeamToolMetric {
  /** "claude-code" | "codex" | "cursor" | … — free-form so new tools don't break parsing. */
  tool: string;
  tokens: number;
  costUsd: number;
  sessions: number;
}

export interface TeamProjectMetric {
  /** Real name, or a `project-xxxxxx` label when the member exported with redact on. */
  project: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  /** null when the member has no cache-bearing sessions for this project. */
  cacheHitRatePct: number | null;
}

export interface TeamMemberReport {
  schemaVersion: number;
  /** Stable pseudonymous id (hash of machine id + salt). Never a real name. */
  memberId: string;
  /** Human-chosen display label, e.g. "alice" or a redacted handle. */
  memberLabel: string;
  /** epoch ms when this report was produced. */
  generatedAt: number;
  /** epoch ms — inclusive window the metrics cover. */
  periodStart: number;
  /** epoch ms — exclusive window end. */
  periodEnd: number;
  /** True when project labels are masked. */
  redacted: boolean;
  totals: {
    tokens: number;
    /** API-equivalent value in USD (same model the dashboard's "价值" card uses). */
    costUsd: number;
    sessions: number;
    /** null when the member has no cache-bearing sessions at all. */
    cacheHitRatePct: number | null;
    /** input tokens the member's cache saved over the window. */
    inputTokensSaved: number;
    /** sessions that were retried (rework signal). */
    retriedSessions: number;
    /** denominator for the retry rate. */
    totalSessionsForRetry: number;
  };
  byProject: TeamProjectMetric[];
  byTool: TeamToolMetric[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNullableNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

/**
 * Strict parse + validate. Used by BOTH the file importer and (later) the
 * self-hosted server's ingest endpoint, so a malformed or future-version
 * report is rejected the same way everywhere. Throws with a precise message.
 */
export function parseTeamMemberReport(raw: unknown, source = 'report'): TeamMemberReport {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${source}: not a JSON object`);
  }
  const r = raw as Record<string, unknown>;

  if (!isFiniteNumber(r.schemaVersion)) {
    throw new Error(`${source}: missing schemaVersion`);
  }
  if (r.schemaVersion > TEAM_REPORT_SCHEMA_VERSION) {
    throw new Error(
      `${source}: schemaVersion ${r.schemaVersion} is newer than this build supports (${TEAM_REPORT_SCHEMA_VERSION}); upgrade Vibemeter`,
    );
  }
  if (typeof r.memberId !== 'string' || !r.memberId) {
    throw new Error(`${source}: missing memberId`);
  }
  const totals = r.totals as Record<string, unknown> | undefined;
  if (!totals || typeof totals !== 'object') {
    throw new Error(`${source}: missing totals`);
  }
  if (!isFiniteNumber(totals.tokens) || !isFiniteNumber(totals.costUsd) || !isFiniteNumber(totals.sessions)) {
    throw new Error(`${source}: totals.tokens/costUsd/sessions must be numbers`);
  }
  // cacheHitRatePct is optional: a member with no cache-bearing sessions omits
  // it entirely. Only a present-but-wrong-typed value (e.g. a string) is an
  // error; absent/undefined normalizes to null below.
  if (totals.cacheHitRatePct !== undefined && !isNullableNumber(totals.cacheHitRatePct)) {
    throw new Error(`${source}: totals.cacheHitRatePct must be number or null`);
  }
  if (!Array.isArray(r.byProject) || !Array.isArray(r.byTool)) {
    throw new Error(`${source}: byProject and byTool must be arrays`);
  }

  // Normalize: fill optional fields with safe defaults so aggregation never
  // has to null-check. Anything missing becomes 0 / null, not undefined.
  return {
    schemaVersion: r.schemaVersion,
    memberId: r.memberId,
    memberLabel: typeof r.memberLabel === 'string' && r.memberLabel ? r.memberLabel : r.memberId,
    generatedAt: isFiniteNumber(r.generatedAt) ? r.generatedAt : Date.now(),
    periodStart: isFiniteNumber(r.periodStart) ? r.periodStart : 0,
    periodEnd: isFiniteNumber(r.periodEnd) ? r.periodEnd : Date.now(),
    redacted: r.redacted === true,
    totals: {
      tokens: totals.tokens,
      costUsd: totals.costUsd,
      sessions: totals.sessions,
      cacheHitRatePct: isFiniteNumber(totals.cacheHitRatePct) ? totals.cacheHitRatePct : null,
      inputTokensSaved: isFiniteNumber(totals.inputTokensSaved) ? totals.inputTokensSaved : 0,
      retriedSessions: isFiniteNumber(totals.retriedSessions) ? totals.retriedSessions : 0,
      totalSessionsForRetry: isFiniteNumber(totals.totalSessionsForRetry) ? totals.totalSessionsForRetry : 0,
    },
    byProject: (r.byProject as unknown[]).map((p, i) => parseProject(p, `${source}.byProject[${i}]`)),
    byTool: (r.byTool as unknown[]).map((t, i) => parseTool(t, `${source}.byTool[${i}]`)),
  };
}

function parseProject(raw: unknown, source: string): TeamProjectMetric {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.project !== 'string') throw new Error(`${source}: project must be a string`);
  return {
    project: p.project,
    tokens: isFiniteNumber(p.tokens) ? p.tokens : 0,
    costUsd: isFiniteNumber(p.costUsd) ? p.costUsd : 0,
    sessions: isFiniteNumber(p.sessions) ? p.sessions : 0,
    cacheHitRatePct: isNullableNumber(p.cacheHitRatePct) ? (p.cacheHitRatePct as number | null) : null,
  };
}

function parseTool(raw: unknown, source: string): TeamToolMetric {
  const t = (raw ?? {}) as Record<string, unknown>;
  if (typeof t.tool !== 'string') throw new Error(`${source}: tool must be a string`);
  return {
    tool: t.tool,
    tokens: isFiniteNumber(t.tokens) ? t.tokens : 0,
    costUsd: isFiniteNumber(t.costUsd) ? t.costUsd : 0,
    sessions: isFiniteNumber(t.sessions) ? t.sessions : 0,
  };
}

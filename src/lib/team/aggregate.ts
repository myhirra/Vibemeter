// Pure team aggregation. Takes an array of validated member reports and folds
// them into one team summary. It does NOT know or care where the reports came
// from — a directory of JSON files today, a self-hosted ingest table later.
// That transport-agnostic boundary is the whole point: the file path and the
// future server path call this exact function with the same input.

import type { TeamMemberReport, TeamToolMetric } from './schema.ts';

/** Cache hit rate below this is flagged as a savings opportunity. */
export const LOW_CACHE_THRESHOLD_PCT = 70;
/** Retry (rework) rate above this is flagged. */
export const HIGH_RETRY_THRESHOLD_PCT = 25;

export interface TeamMemberRollup {
  memberId: string;
  memberLabel: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  cacheHitRatePct: number | null;
  /** retriedSessions / totalSessionsForRetry * 100, or null when no denominator. */
  retryRatePct: number | null;
  generatedAt: number;
}

export interface TeamProjectRollup {
  project: string;
  tokens: number;
  costUsd: number;
  sessions: number;
  /** how many distinct members touched this project. */
  memberCount: number;
}

export interface TeamWasteSignals {
  /** Members under the cache threshold (most savings headroom first). */
  lowCacheMembers: { memberLabel: string; cacheHitRatePct: number }[];
  /** Members over the retry threshold (worst first). */
  highRetryMembers: { memberLabel: string; retryRatePct: number }[];
  /**
   * Rough sunk cost from reruns: per member, costUsd * retryRate. This is a
   * deliberately conservative proxy, not a precise figure — surfaced so the
   * team sees an order of magnitude, labeled as an estimate in the UI.
   */
  estimatedReworkUsd: number;
}

export interface TeamSummary {
  generatedAt: number;
  memberCount: number;
  /** Distinct schema versions seen — for diagnosing mixed-version rollups. */
  schemaVersions: number[];
  /** True if any member exported with redact off (project names are real). */
  anyUnredacted: boolean;
  periodStart: number | null;
  periodEnd: number | null;
  totals: {
    tokens: number;
    costUsd: number;
    sessions: number;
    /** session-weighted average across members with a known rate. */
    cacheHitRatePct: number | null;
    inputTokensSaved: number;
  };
  members: TeamMemberRollup[];
  byProject: TeamProjectRollup[];
  byTool: TeamToolMetric[];
  waste: TeamWasteSignals;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function retryRatePct(report: TeamMemberReport): number | null {
  const { retriedSessions, totalSessionsForRetry } = report.totals;
  if (totalSessionsForRetry <= 0) return null;
  return (retriedSessions / totalSessionsForRetry) * 100;
}

export function aggregateTeamReports(reports: TeamMemberReport[]): TeamSummary {
  // De-dup by memberId, keeping the most recent report per member so a folder
  // with yesterday's and today's export for the same person doesn't double-count.
  const latestByMember = new Map<string, TeamMemberReport>();
  for (const r of reports) {
    const existing = latestByMember.get(r.memberId);
    if (!existing || r.generatedAt > existing.generatedAt) {
      latestByMember.set(r.memberId, r);
    }
  }
  const members = [...latestByMember.values()];

  let tokens = 0;
  let costUsd = 0;
  let sessions = 0;
  let inputTokensSaved = 0;
  let cacheWeightedSum = 0;
  let cacheWeightDenom = 0;
  let estimatedReworkUsd = 0;
  let anyUnredacted = false;
  let periodStart: number | null = null;
  let periodEnd: number | null = null;
  const schemaVersions = new Set<number>();

  const projectMap = new Map<string, TeamProjectRollup>();
  const toolMap = new Map<string, TeamToolMetric>();
  const lowCache: { memberLabel: string; cacheHitRatePct: number }[] = [];
  const highRetry: { memberLabel: string; retryRatePct: number }[] = [];

  const memberRollups: TeamMemberRollup[] = members.map((r) => {
    tokens += r.totals.tokens;
    costUsd += r.totals.costUsd;
    sessions += r.totals.sessions;
    inputTokensSaved += r.totals.inputTokensSaved;
    schemaVersions.add(r.schemaVersion);
    if (!r.redacted) anyUnredacted = true;

    periodStart = periodStart == null ? r.periodStart : Math.min(periodStart, r.periodStart);
    periodEnd = periodEnd == null ? r.periodEnd : Math.max(periodEnd, r.periodEnd);

    // Session-weighted cache average so a member with 2 sessions doesn't sway
    // the team rate as much as one with 200.
    if (r.totals.cacheHitRatePct != null && r.totals.sessions > 0) {
      cacheWeightedSum += r.totals.cacheHitRatePct * r.totals.sessions;
      cacheWeightDenom += r.totals.sessions;
    }

    const rr = retryRatePct(r);
    if (rr != null) {
      estimatedReworkUsd += r.totals.costUsd * (rr / 100);
      if (rr > HIGH_RETRY_THRESHOLD_PCT) {
        highRetry.push({ memberLabel: r.memberLabel, retryRatePct: round2(rr) });
      }
    }
    if (r.totals.cacheHitRatePct != null && r.totals.cacheHitRatePct < LOW_CACHE_THRESHOLD_PCT) {
      lowCache.push({ memberLabel: r.memberLabel, cacheHitRatePct: round2(r.totals.cacheHitRatePct) });
    }

    for (const p of r.byProject) {
      const cur = projectMap.get(p.project) ?? {
        project: p.project,
        tokens: 0,
        costUsd: 0,
        sessions: 0,
        memberCount: 0,
      };
      cur.tokens += p.tokens;
      cur.costUsd += p.costUsd;
      cur.sessions += p.sessions;
      cur.memberCount += 1;
      projectMap.set(p.project, cur);
    }
    for (const t of r.byTool) {
      const cur = toolMap.get(t.tool) ?? { tool: t.tool, tokens: 0, costUsd: 0, sessions: 0 };
      cur.tokens += t.tokens;
      cur.costUsd += t.costUsd;
      cur.sessions += t.sessions;
      toolMap.set(t.tool, cur);
    }

    return {
      memberId: r.memberId,
      memberLabel: r.memberLabel,
      tokens: r.totals.tokens,
      costUsd: round2(r.totals.costUsd),
      sessions: r.totals.sessions,
      cacheHitRatePct: r.totals.cacheHitRatePct,
      retryRatePct: rr == null ? null : round2(rr),
      generatedAt: r.generatedAt,
    };
  });

  memberRollups.sort((a, b) => b.costUsd - a.costUsd);
  lowCache.sort((a, b) => a.cacheHitRatePct - b.cacheHitRatePct);
  highRetry.sort((a, b) => b.retryRatePct - a.retryRatePct);

  const byProject = [...projectMap.values()]
    .map((p) => ({ ...p, costUsd: round2(p.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const byTool = [...toolMap.values()]
    .map((t) => ({ ...t, costUsd: round2(t.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    generatedAt: Date.now(),
    memberCount: members.length,
    schemaVersions: [...schemaVersions].sort((a, b) => a - b),
    anyUnredacted,
    periodStart,
    periodEnd,
    totals: {
      tokens,
      costUsd: round2(costUsd),
      sessions,
      cacheHitRatePct: cacheWeightDenom > 0 ? round2(cacheWeightedSum / cacheWeightDenom) : null,
      inputTokensSaved,
    },
    members: memberRollups,
    byProject,
    byTool,
    waste: {
      lowCacheMembers: lowCache,
      highRetryMembers: highRetry,
      estimatedReworkUsd: round2(estimatedReworkUsd),
    },
  };
}

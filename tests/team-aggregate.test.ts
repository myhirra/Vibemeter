import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTeamReports, LOW_CACHE_THRESHOLD_PCT } from '../src/lib/team/aggregate.ts';
import { parseTeamMemberReport, TEAM_REPORT_SCHEMA_VERSION } from '../src/lib/team/schema.ts';
import type { TeamMemberReport } from '../src/lib/team/schema.ts';

function member(overrides: Partial<TeamMemberReport> & { memberId: string }): TeamMemberReport {
  return {
    schemaVersion: TEAM_REPORT_SCHEMA_VERSION,
    memberLabel: overrides.memberId,
    generatedAt: 1_000,
    periodStart: 0,
    periodEnd: 7 * 86_400_000,
    redacted: true,
    totals: {
      tokens: 0,
      costUsd: 0,
      sessions: 0,
      cacheHitRatePct: null,
      inputTokensSaved: 0,
      retriedSessions: 0,
      totalSessionsForRetry: 0,
    },
    byProject: [],
    byTool: [],
    ...overrides,
  };
}

test('aggregate sums tokens, cost and sessions across members', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'a', totals: { tokens: 100, costUsd: 10, sessions: 4, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'b', totals: { tokens: 250, costUsd: 25, sessions: 6, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  assert.equal(summary.memberCount, 2);
  assert.equal(summary.totals.tokens, 350);
  assert.equal(summary.totals.costUsd, 35);
  assert.equal(summary.totals.sessions, 10);
});

test('members are sorted by cost descending', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'cheap', totals: { tokens: 1, costUsd: 5, sessions: 1, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'pricey', totals: { tokens: 1, costUsd: 50, sessions: 1, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  assert.deepEqual(summary.members.map((m) => m.memberId), ['pricey', 'cheap']);
});

test('duplicate member reports keep only the most recent by generatedAt', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'a', generatedAt: 100, totals: { tokens: 10, costUsd: 1, sessions: 1, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'a', generatedAt: 200, totals: { tokens: 999, costUsd: 99, sessions: 9, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  assert.equal(summary.memberCount, 1);
  assert.equal(summary.totals.tokens, 999, 'should keep the newer report, not sum both');
});

test('cache hit rate is session-weighted across members', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'a', totals: { tokens: 0, costUsd: 0, sessions: 100, cacheHitRatePct: 90, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'b', totals: { tokens: 0, costUsd: 0, sessions: 100, cacheHitRatePct: 50, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  // Equal session counts → simple average of 90 and 50 = 70.
  assert.equal(summary.totals.cacheHitRatePct, 70);
});

test('a 2-session member sways the team rate far less than a 200-session member', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'big', totals: { tokens: 0, costUsd: 0, sessions: 200, cacheHitRatePct: 90, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'small', totals: { tokens: 0, costUsd: 0, sessions: 2, cacheHitRatePct: 0, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  // (90*200 + 0*2) / 202 ≈ 89.11, much closer to 90 than to a flat 45.
  assert.ok(summary.totals.cacheHitRatePct! > 88 && summary.totals.cacheHitRatePct! < 90);
});

test('low-cache members are flagged below threshold, sorted worst-first', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'fine', totals: { tokens: 0, costUsd: 0, sessions: 10, cacheHitRatePct: LOW_CACHE_THRESHOLD_PCT + 5, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'leaky', totals: { tokens: 0, costUsd: 0, sessions: 10, cacheHitRatePct: 40, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
    member({ memberId: 'worst', totals: { tokens: 0, costUsd: 0, sessions: 10, cacheHitRatePct: 20, inputTokensSaved: 0, retriedSessions: 0, totalSessionsForRetry: 0 } }),
  ]);
  assert.deepEqual(summary.waste.lowCacheMembers.map((m) => m.memberLabel), ['worst', 'leaky']);
});

test('high-retry members flagged above threshold and rework cost estimated', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'churner', totals: { tokens: 0, costUsd: 100, sessions: 10, cacheHitRatePct: null, inputTokensSaved: 0, retriedSessions: 5, totalSessionsForRetry: 10 } }),
  ]);
  // 50% retry > threshold → flagged; rework ≈ 100 * 0.5 = 50.
  assert.equal(summary.waste.highRetryMembers.length, 1);
  assert.equal(summary.waste.highRetryMembers[0].retryRatePct, 50);
  assert.equal(summary.waste.estimatedReworkUsd, 50);
});

test('projects aggregate across members with a member count', () => {
  const summary = aggregateTeamReports([
    member({ memberId: 'a', byProject: [{ project: 'project-abc', tokens: 100, costUsd: 10, sessions: 2, cacheHitRatePct: 80 }] }),
    member({ memberId: 'b', byProject: [{ project: 'project-abc', tokens: 200, costUsd: 20, sessions: 3, cacheHitRatePct: 60 }] }),
  ]);
  assert.equal(summary.byProject.length, 1);
  assert.equal(summary.byProject[0].project, 'project-abc');
  assert.equal(summary.byProject[0].tokens, 300);
  assert.equal(summary.byProject[0].costUsd, 30);
  assert.equal(summary.byProject[0].memberCount, 2);
});

test('anyUnredacted is true when at least one member exported with redact off', () => {
  const redacted = aggregateTeamReports([member({ memberId: 'a', redacted: true })]);
  assert.equal(redacted.anyUnredacted, false);
  const mixed = aggregateTeamReports([member({ memberId: 'a', redacted: true }), member({ memberId: 'b', redacted: false })]);
  assert.equal(mixed.anyUnredacted, true);
});

test('empty input yields a zeroed summary, not a crash', () => {
  const summary = aggregateTeamReports([]);
  assert.equal(summary.memberCount, 0);
  assert.equal(summary.totals.costUsd, 0);
  assert.equal(summary.totals.cacheHitRatePct, null);
  assert.equal(summary.periodStart, null);
  assert.deepEqual(summary.byProject, []);
});

// ── schema validation (shared by file import and the future server ingest) ──

test('parseTeamMemberReport rejects a non-object', () => {
  assert.throws(() => parseTeamMemberReport(null), /not a JSON object/);
});

test('parseTeamMemberReport rejects a newer schema version', () => {
  assert.throws(
    () => parseTeamMemberReport({ schemaVersion: TEAM_REPORT_SCHEMA_VERSION + 1, memberId: 'a', totals: { tokens: 0, costUsd: 0, sessions: 0 }, byProject: [], byTool: [] }),
    /newer than this build supports/,
  );
});

test('parseTeamMemberReport requires memberId and totals', () => {
  assert.throws(() => parseTeamMemberReport({ schemaVersion: 1, totals: {}, byProject: [], byTool: [] }), /missing memberId/);
  assert.throws(() => parseTeamMemberReport({ schemaVersion: 1, memberId: 'a', byProject: [], byTool: [] }), /missing totals/);
});

test('parseTeamMemberReport fills optional fields with safe defaults', () => {
  const parsed = parseTeamMemberReport({
    schemaVersion: 1,
    memberId: 'a',
    totals: { tokens: 5, costUsd: 1, sessions: 2 },
    byProject: [],
    byTool: [],
  });
  assert.equal(parsed.memberLabel, 'a', 'defaults label to id');
  assert.equal(parsed.totals.inputTokensSaved, 0);
  assert.equal(parsed.totals.retriedSessions, 0);
  assert.equal(parsed.redacted, false);
});

test('a parsed report flows straight into aggregation', () => {
  const parsed = parseTeamMemberReport({
    schemaVersion: 1,
    memberId: 'a',
    memberLabel: 'alice',
    totals: { tokens: 100, costUsd: 12.5, sessions: 3, cacheHitRatePct: 65 },
    byProject: [{ project: 'project-xyz', tokens: 100, costUsd: 12.5, sessions: 3, cacheHitRatePct: 65 }],
    byTool: [{ tool: 'claude-code', tokens: 100, costUsd: 12.5, sessions: 3 }],
  });
  const summary = aggregateTeamReports([parsed]);
  assert.equal(summary.totals.costUsd, 12.5);
  assert.equal(summary.byTool[0].tool, 'claude-code');
  assert.equal(summary.waste.lowCacheMembers[0].memberLabel, 'alice', '65% < 70% threshold');
});

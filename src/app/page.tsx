export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { Dashboard } from '@/components/Dashboard';
import Link from 'next/link';
import { activityStreak, burndownPoints, fileHotspots, spendingStats, dayTimeline, achievements, sessionInsight, cacheStats } from '@/lib/stats';
import { commitCountsBySession } from '@/lib/git/scan';
import type { SessionRow } from '@/lib/schema';
import { getCodexAccounts } from '@/lib/codex-auth';
import { getLatestUsageSnapshot } from '@/lib/usage-snapshots';
import { MarketingPage } from '@/components/MarketingPage';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { OpenFloatButton } from '@/components/OpenFloatButton';
import { DashboardPricingLink } from '@/components/DashboardPricingLink';
import { getServerLocale } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import { getFloatStats } from '@/lib/float-stats';
import { decideQuotaGuard } from '@/lib/quota-guard';
import { DEMO_PROJECTS, DEMO_TITLES, deterministicBucket, redactProject, redactSession } from '@/lib/redact';
import { getRedactSalt, isRedactEnabled } from '@/lib/redact-server';
import { buildRecapCard, type RecapCardData } from '@/lib/recap-card';
import { readRecapSettings } from '@/lib/recap-settings';
import { evaluateRecapNudge, readActiveRecapNudge } from '@/lib/recap-nudge';

/**
 * Demo path masking — used when `?demo=1` is on so the marketing screenshot
 * has fake-but-plausible project names. We keep the local `Map` indirection
 * (instead of routing through `redactSession`) because the demo path also
 * needs stable indexing across the synthesized cursor sessions injected
 * below; the salt-based redact path is for user-facing screenshots.
 */
function anonymize<T extends { cwd: string | null; ai_title: string | null; id: string }>(
  rows: T[],
): T[] {
  const projectMap = new Map<string, string>();
  return rows.map((s, i) => {
    if (!s.cwd) return s;
    const base = s.cwd.split('/').filter(Boolean).pop() ?? '';
    if (!projectMap.has(base)) {
      projectMap.set(base, DEMO_PROJECTS[projectMap.size % DEMO_PROJECTS.length]);
    }
    return {
      ...s,
      cwd: `/Users/demo/code/${projectMap.get(base)}`,
      ai_title: s.ai_title ? DEMO_TITLES[i % DEMO_TITLES.length] : null,
    };
  });
}

function injectMockCursorSessions<T extends { id: string; tool: string; started_at: number; ended_at: number | null; cwd: string | null; confidence: string; summary: string | null; ai_title: string | null; tags: string | null }>(
  rows: T[],
): T[] {
  const now = Date.now();
  const extra: T[] = [];
  for (let i = 0; i < 160; i++) {
    const proj = DEMO_PROJECTS[i % DEMO_PROJECTS.length];
    const start = now - (i * 2 + 1) * 2_700_000 - Math.random() * 3_600_000;
    const dur = (15 + Math.random() * 80) * 60_000;
    extra.push({
      id: `demo-cursor-${i}`,
      tool: 'cursor',
      started_at: Math.round(start),
      ended_at: Math.round(start + dur),
      cwd: `/Users/demo/code/${proj}`,
      confidence: 'high',
      summary: null,
      ai_title: DEMO_TITLES[i % DEMO_TITLES.length],
      tags: null,
    } as T);
  }
  return [...rows, ...extra].sort((a, b) => b.started_at - a.started_at);
}

function redactRecap(card: RecapCardData, salt: string): RecapCardData {
  return {
    ...card,
    topProjects: card.topProjects.map((p) => ({
      ...p,
      project: redactProject(p.project, salt),
    })),
  };
}

const AGENTS = new Set(['all', 'claude-code', 'codex', 'cursor']);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ demo?: string; agent?: string; codexAccount?: string; project?: string; focus?: string }> }) {
  if (process.env.VIBEMETER_SITE === 'marketing') {
    return <MarketingPage />;
  }

  const locale = await getServerLocale();
  const params = await searchParams;
  const demo = params.demo === '1' || params.demo === 'true';
  const redact = await isRedactEnabled();
  const redactSalt = redact ? getRedactSalt() : '';
  const initialAgent = AGENTS.has(params.agent ?? '') ? params.agent as 'all' | 'claude-code' | 'codex' | 'cursor' : 'all';
  const initialProject = typeof params.project === 'string' && params.project.length > 0 ? params.project : null;
  const initialFocusCurrent = params.focus === 'current';

  const db = getDb();
  const codexAccounts = await getCodexAccounts();
  const requestedCodexAccountId = params.codexAccount ?? null;
  const selectedCodexAccountId =
    requestedCodexAccountId && codexAccounts.some((account) => account.accountId === requestedCodexAccountId)
      ? requestedCodexAccountId
      : null;

  let sessions = db.prepare(`
    SELECT id, tool, started_at, ended_at, cwd, confidence, summary, ai_title, tags
    FROM sessions
    ORDER BY started_at DESC
  `).all() as Pick<SessionRow, 'id' | 'tool' | 'started_at' | 'ended_at' | 'cwd' | 'confidence' | 'summary' | 'ai_title' | 'tags'>[];

  if (demo) {
    sessions = anonymize(sessions);
    sessions = injectMockCursorSessions(sessions);
  }
  // Redact mode is independent of demo mode. We mask after demo-injection so a
  // user who somehow has both flags on still sees a coherent table — the
  // marketing demo fixtures are already harmless, the redact pass just gives
  // them a slightly different cosmetic skin.
  if (redact) {
    sessions = sessions.map((s) => redactSession(s, redactSalt));
  }

  const commitCounts = demo ? new Map<string, number>() : commitCountsBySession(db);
  const sessionsWithCommits = sessions.map((s) => ({
    ...s,
    commit_count: commitCounts.get(s.id) ?? 0,
  }));

  const claudeUsageRow = getLatestUsageSnapshot(db, 'statusline');
  const codexUsageRow = selectedCodexAccountId
    ? getLatestUsageSnapshot(db, 'codex', selectedCodexAccountId)
    : getLatestUsageSnapshot(db, 'codex');

  const toUsageInfo = (row: typeof claudeUsageRow) => row ? {
    window_5h_used_pct: row.window_5h_used_pct,
    window_weekly_used_pct: row.window_weekly_used_pct,
    reset_at_5h: row.reset_at_5h,
    reset_at_weekly: row.reset_at_weekly,
  } : null;

  // Build the "can I keep coding?" decision card. We reuse getFloatStats so the
  // popover and the dashboard agree, and feed its quotas into decideQuotaGuard.
  // In demo mode we synthesise a safe-looking guard so the marketing screenshot
  // still has the new top card.
  let runwayGuard: ReturnType<typeof decideQuotaGuard>;
  let runwayContextPct: number | null = null;
  let runwayWeekly: number | null = null;
  let runwayWindow5h: { usedPct: number | null; resetAt: number | null } | null = null;
  let floatStats: Awaited<ReturnType<typeof getFloatStats>> | null = null;
  // API mode detection: Claude API-key users have cost data but no rate_limits.
  // When detected we swap the runway card to show $ spent today / 7d instead
  // of the meaningless empty 5h ring.
  let runwayApiMode: { costToday: number; cost7d: number } | null = null;
  if (demo) {
    // Server component, no render-purity concern; demo path runs once per SSR.
    // eslint-disable-next-line react-hooks/purity
    const demoNow = Date.now();
    runwayGuard = {
      status: 'safe',
      headline: 'Safe to start',
      detail: 'Quota runway looks healthy for a long task.',
      minRemaining: 82,
      pace5hExhaustMin: null,
      generatedAt: demoNow,
      quotas: [],
    };
    runwayWindow5h = { usedPct: 18, resetAt: demoNow + 90 * 60_000 };
  } else {
    floatStats = await getFloatStats();
    runwayGuard = decideQuotaGuard({ generatedAt: floatStats.generatedAt, quotas: floatStats.quotas });
    runwayContextPct = floatStats.activeContext?.pct ?? null;
    runwayWeekly = floatStats.primary?.remainingWeekly ?? null;
    if (floatStats.primary) {
      runwayWindow5h = {
        usedPct: floatStats.primary.used5h ?? (floatStats.primary.remaining5h != null ? 100 - floatStats.primary.remaining5h : null),
        resetAt: floatStats.primary.resetAt5h,
      };
    }
    // Claude API-mode detection: a Claude quota exists but has no rate-limit
    // numbers (subscription-only fields), AND the spending data shows real $
    // burn. That combo only happens when the user is authenticated via
    // ANTHROPIC_API_KEY rather than a Pro/Max login.
    const claudeQuota = floatStats.quotas.find((q) => q.agent === 'claude-code');
    const claudeHasRateLimits = (claudeQuota?.remaining5h ?? null) != null
      || (claudeQuota?.remainingWeekly ?? null) != null;
    const sp = spendingStats();
    if (!claudeHasRateLimits && sp.claudeTotalUsd > 0) {
      const todayKey = new Date().toISOString().slice(0, 10);
      // eslint-disable-next-line react-hooks/purity
      const cutoff = Date.now() - 7 * 86_400_000;
      const costToday = sp.daily.find((d) => d.date === todayKey)?.claudeUsd ?? 0;
      const cost7d = sp.daily
        .filter((d) => new Date(d.date).getTime() >= cutoff)
        .reduce((acc, d) => acc + d.claudeUsd, 0);
      runwayApiMode = { costToday, cost7d };
    }
    evaluateRecapNudge(floatStats, { notify: false });
  }

  // For demo, also fabricate a "today's timeline" mostly populated with cursor work
  let timeline = dayTimeline(0);
  if (demo) {
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const mockToday = [
      { id: 'demo-t1', tool: 'cursor',      project: 'kanban-board',  startMs: dayStart + 9 * 3_600_000,             endMs: dayStart + 10 * 3_600_000 + 30 * 60_000,  aiTitle: 'add drag-drop sorting' },
      { id: 'demo-t2', tool: 'claude-code', project: 'note-vault',    startMs: dayStart + 10 * 3_600_000 + 45 * 60_000, endMs: dayStart + 12 * 3_600_000 + 15 * 60_000, aiTitle: 'wire markdown export' },
      { id: 'demo-t3', tool: 'cursor',      project: 'pomodoro',      startMs: dayStart + 13 * 3_600_000,            endMs: dayStart + 14 * 3_600_000 + 50 * 60_000,  aiTitle: 'fix timer drift' },
      { id: 'demo-t4', tool: 'codex',       project: 'recipe-box',    startMs: dayStart + 15 * 3_600_000,            endMs: dayStart + 17 * 3_600_000,                aiTitle: 'design ingredient parser' },
      { id: 'demo-t5', tool: 'cursor',      project: 'habit-tracker', startMs: dayStart + 17 * 3_600_000 + 10 * 60_000, endMs: dayStart + 19 * 3_600_000,             aiTitle: 'streak animation polish' },
      { id: 'demo-t6', tool: 'cursor',      project: 'budget-app',    startMs: dayStart + 20 * 3_600_000,            endMs: dayStart + 21 * 3_600_000 + 30 * 60_000,  aiTitle: 'csv import wizard' },
    ];
    timeline = { dateLabel: new Date().toISOString().slice(0, 10), sessions: mockToday };
  }

  // Apply redact masking to every surface that surfaces a real project name
  // or session title. We keep aggregate numbers (tokens, cache hit rate, $)
  // untouched — the whole point of redact mode is to screenshot the numbers
  // while hiding which repos they came from.
  const hotspotsList = fileHotspots(8);
  const insight = sessionInsight();
  const cache = cacheStats();
  const recapSettings = readRecapSettings();
  const recapCards = {
    today: buildRecapCard({ period: 'today', settings: recapSettings }),
    weekly: buildRecapCard({ period: '7d', settings: recapSettings }),
    monthly: buildRecapCard({ period: 'month', settings: recapSettings }),
  };
  const recapNudge = readActiveRecapNudge();
  let redactedTimeline = timeline;
  let redactedHotspots = hotspotsList;
  let redactedInsight = insight;
  let redactedCache = cache;
  let redactedRecapCards = recapCards;
  if (redact) {
    redactedTimeline = {
      dateLabel: timeline.dateLabel,
      sessions: timeline.sessions.map((s) => ({
        ...s,
        project: redactProject(s.project, redactSalt),
        // ai_title is masked deterministically per session id so the same row
        // always shows the same generic title across reloads.
        aiTitle: s.aiTitle
          ? DEMO_TITLES[deterministicBucket(s.id, redactSalt) % DEMO_TITLES.length]
          : null,
      })),
    };
    // FileHotspots renders dirpart/basename — collapse to a masked path so the
    // dir hint can't leak which repo this file lives in.
    redactedHotspots = hotspotsList.map((h, i) => ({
      ...h,
      path: `${redactProject(`hotspot-${i}`, redactSalt)}/file-${i + 1}`,
    }));
    redactedInsight = {
      ...insight,
      topExpensive: insight.topExpensive.map((s) => {
        const maskedProject = redactProject(s.project, redactSalt);
        return {
          ...s,
          project: maskedProject,
          cwd: s.cwd ? `~/projects/${maskedProject}` : s.cwd,
          aiTitle: s.aiTitle
            ? DEMO_TITLES[deterministicBucket(s.id, redactSalt) % DEMO_TITLES.length]
            : null,
          // Disable the "open transcript" button in redact mode by stripping
          // the path; the button renders only when transcriptPath is truthy.
          transcriptPath: null,
        };
      }),
    };
    redactedCache = {
      ...cache,
      topProjects: cache.topProjects.map((p) => ({
        ...p,
        project: redactProject(p.project, redactSalt),
      })),
      worstSessions: cache.worstSessions.map((s) => {
        const maskedProject = redactProject(s.project, redactSalt);
        return {
          ...s,
          project: maskedProject,
          aiTitle: s.aiTitle
            ? DEMO_TITLES[deterministicBucket(s.id, redactSalt) % DEMO_TITLES.length]
            : null,
          transcriptPath: null,
        };
      }),
    };
    redactedRecapCards = {
      today: redactRecap(recapCards.today, redactSalt),
      weekly: redactRecap(recapCards.weekly, redactSalt),
      monthly: redactRecap(recapCards.monthly, redactSalt),
    };
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter
            </h1>
            <p className="text-zinc-600 text-xs mt-1">{t(locale, 'header.tagline')}</p>
          </div>
          <div className="flex items-center gap-2">
            <OpenFloatButton />
            <DashboardPricingLink label={t(locale, 'pricing.headerLink')} />
            <LocaleSwitcher />
            <Link
              href="/settings"
              className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              {t(locale, 'common.settings')}
            </Link>
            <Link
              href="/admin"
              className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              {t(locale, 'common.admin')}
            </Link>
          </div>
        </div>

        <Dashboard
          sessions={sessionsWithCommits}
          streak={activityStreak()}
          allBurndown={burndownPoints(168)}
          claudeBurndown={burndownPoints(168, 'statusline')}
          codexBurndown={burndownPoints(168, 'codex', selectedCodexAccountId)}
          hotspots={redactedHotspots}
          spending={spendingStats()}
          timeline={redactedTimeline}
          achievements={achievements()}
          insight={redactedInsight}
          cache={redactedCache}
          recapCards={redactedRecapCards}
          recapNudge={recapNudge}
          claudeUsage={toUsageInfo(claudeUsageRow)}
          codexUsage={toUsageInfo(codexUsageRow)}
          codexAccounts={codexAccounts}
          selectedCodexAccountId={selectedCodexAccountId}
          initialToolFilter={initialAgent}
          runway={{
            guard: runwayGuard,
            contextPct: runwayContextPct,
            weeklyRemaining: runwayWeekly,
            window5h: runwayWindow5h,
            apiMode: runwayApiMode,
          }}
          initialProjectFilter={initialProject}
          initialFocusCurrent={initialFocusCurrent}
          redact={redact}
        />
      </div>
    </div>
  );
}

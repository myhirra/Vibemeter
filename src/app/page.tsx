export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { Dashboard } from '@/components/Dashboard';
import Link from 'next/link';
import { activityStreak, burndownPoints, fileHotspots, spendingStats, dayTimeline, achievements } from '@/lib/stats';
import type { SessionRow } from '@/lib/schema';
import { getCodexAccounts } from '@/lib/codex-auth';
import { getLatestUsageSnapshot } from '@/lib/usage-snapshots';
import { MarketingPage } from '@/components/MarketingPage';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { getServerLocale } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';

const DEMO_PROJECTS = [
  'kanban-board', 'pomodoro', 'weather-widget', 'recipe-box', 'mood-journal',
  'habit-tracker', 'flashcards', 'spelling-bee', 'budget-app', 'markdown-blog',
  'todo-cli', 'music-player', 'photo-gallery', 'note-vault', 'expense-split',
];

const DEMO_TITLES = [
  'add dark mode toggle',
  'refactor router boundaries',
  'fix mobile layout overflow',
  'wire up websocket reconnect',
  'optimize image lazy loading',
  'migrate to server components',
  'tighten type signatures',
  'investigate flaky e2e tests',
  'add keyboard shortcuts',
  'improve empty states',
];

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

const AGENTS = new Set(['all', 'claude-code', 'codex', 'cursor']);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ demo?: string; agent?: string; codexAccount?: string }> }) {
  if (process.env.VIBEMETER_SITE === 'marketing') {
    return <MarketingPage />;
  }

  const locale = await getServerLocale();
  const params = await searchParams;
  const demo = params.demo === '1' || params.demo === 'true';
  const initialAgent = AGENTS.has(params.agent ?? '') ? params.agent as 'all' | 'claude-code' | 'codex' | 'cursor' : 'all';

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
          sessions={sessions}
          streak={activityStreak()}
          allBurndown={burndownPoints(168)}
          claudeBurndown={burndownPoints(168, 'statusline')}
          codexBurndown={burndownPoints(168, 'codex', selectedCodexAccountId)}
          hotspots={fileHotspots(8)}
          spending={spendingStats()}
          timeline={timeline}
          achievements={achievements()}
          claudeUsage={toUsageInfo(claudeUsageRow)}
          codexUsage={toUsageInfo(codexUsageRow)}
          codexAccounts={codexAccounts}
          selectedCodexAccountId={selectedCodexAccountId}
          initialToolFilter={initialAgent}
        />
      </div>
    </div>
  );
}

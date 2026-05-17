export const dynamic = 'force-dynamic';

import { getDb } from '@/lib/db';
import { importSessions } from '@/lib/collectors/session-importer';
import { Dashboard } from '@/components/Dashboard';
import { activityStreak, burndownPoints, fileHotspots, spendingStats, dayTimeline, achievements } from '@/lib/stats';
import type { SessionRow, UsageSnapshotRow } from '@/lib/schema';

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
  for (let i = 0; i < 90; i++) {
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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const params = await searchParams;
  const demo = params.demo === '1' || params.demo === 'true';

  importSessions();
  const db = getDb();

  let sessions = db.prepare(`
    SELECT id, tool, started_at, ended_at, cwd, confidence, summary, ai_title, tags
    FROM sessions
    ORDER BY started_at DESC
  `).all() as Pick<SessionRow, 'id' | 'tool' | 'started_at' | 'ended_at' | 'cwd' | 'confidence' | 'summary' | 'ai_title' | 'tags'>[];

  if (demo) {
    sessions = anonymize(sessions);
    sessions = injectMockCursorSessions(sessions);
  }

  type UsageRow = Pick<UsageSnapshotRow, 'window_5h_used_pct' | 'window_weekly_used_pct' | 'reset_at_5h' | 'reset_at_weekly'>;
  const usageBySource = (source: string) => db.prepare(`
    SELECT window_5h_used_pct, window_weekly_used_pct, reset_at_5h, reset_at_weekly
    FROM usage_snapshots WHERE source = ? ORDER BY captured_at DESC LIMIT 1
  `).get(source) as UsageRow | undefined;

  const toUsageInfo = (row: UsageRow | undefined) => row ? {
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
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
            <span className="text-violet-400">Vibe</span>meter
          </h1>
          <p className="text-zinc-600 text-xs mt-1">measure your AI coding vibe · local-first · data never leaves this machine</p>
        </div>

        <Dashboard
          sessions={sessions}
          streak={activityStreak()}
          claudeBurndown={burndownPoints(168, 'statusline')}
          codexBurndown={burndownPoints(168, 'codex')}
          hotspots={fileHotspots(8)}
          spending={spendingStats()}
          timeline={timeline}
          achievements={achievements()}
          claudeUsage={toUsageInfo(usageBySource('statusline'))}
          codexUsage={toUsageInfo(usageBySource('codex'))}
        />
      </div>
    </div>
  );
}

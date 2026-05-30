import { NextResponse } from 'next/server';
import { buildRecapCard, type RecapCardData, type RecapPeriod, type RecapToolFilter } from '@/lib/recap-card';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { readRecapSettings } from '@/lib/recap-settings';
import { getRedactSalt, isRedactEnabled } from '@/lib/redact-server';
import { redactProject } from '@/lib/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePeriod(value: string | null): RecapPeriod {
  if (value === 'all') return 'all';
  if (value === 'month') return 'month';
  if (value === '30d') return '30d';
  if (value === 'today') return 'today';
  return '7d';
}

function parseTool(value: string | null): RecapToolFilter {
  if (value === 'claude-code' || value === 'codex' || value === 'cursor') return value;
  return 'all';
}

function maybeRedact(card: RecapCardData, redact: boolean, salt: string): RecapCardData {
  if (!redact) return card;
  return {
    ...card,
    topProjects: card.topProjects.map((project) => ({
      ...project,
      project: redactProject(project.project, salt),
    })),
    cacheSummary: {
      ...card.cacheSummary,
      topProjects: card.cacheSummary.topProjects.map((project) => ({
        ...project,
        project: redactProject(project.project, salt),
      })),
    },
  };
}

export async function GET(request: Request) {
  importUsageSnapshots();
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get('period'));
  const tool = parseTool(url.searchParams.get('tool'));
  const redact = await isRedactEnabled();
  const card = buildRecapCard({ period, tool, settings: readRecapSettings() });
  return NextResponse.json({
    card: maybeRedact(card, redact, redact ? getRedactSalt() : ''),
  });
}

import { buildRecapCard, type RecapCardData, type RecapHeroKind, type RecapPeriod, type RecapVariant } from '@/lib/recap-card';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { readRecapSettings } from '@/lib/recap-settings';
import { renderRecapSvg } from '@/lib/recap-card-render';
import { getRedactSalt, isRedactEnabled } from '@/lib/redact-server';
import { redactProject } from '@/lib/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePeriod(value: string | null): RecapPeriod {
  if (value === 'month') return 'month';
  if (value === 'today') return 'today';
  return '7d';
}

function parseVariant(value: string | null): RecapVariant {
  return value === 'square' ? 'square' : 'landscape';
}

function parseHero(value: string | null): RecapHeroKind | undefined {
  if (value === 'roi' || value === 'value' || value === 'cache' || value === 'sessions') return value;
  return undefined;
}

function maybeRedact(card: RecapCardData, redact: boolean, salt: string): RecapCardData {
  if (!redact) return card;
  return {
    ...card,
    topProjects: card.topProjects.map((project) => ({
      ...project,
      project: redactProject(project.project, salt),
    })),
  };
}

export async function GET(request: Request) {
  importUsageSnapshots();
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get('period'));
  const variant = parseVariant(url.searchParams.get('variant'));
  const heroOverride = parseHero(url.searchParams.get('hero'));
  const redact = await isRedactEnabled();
  const card = buildRecapCard({ period, settings: readRecapSettings() });
  const svg = renderRecapSvg(maybeRedact(card, redact, redact ? getRedactSalt() : ''), variant, { heroOverride });
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

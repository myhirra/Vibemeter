import { createHash } from 'node:crypto';
import { buildRecapCard, type RecapCardData, type RecapHeroKind, type RecapPeriod, type RecapStyle, type RecapToolFilter, type RecapVariant } from '@/lib/recap-card';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { readRecapSettings } from '@/lib/recap-settings';
import { DEFAULT_RECAP_STYLE, renderRecapSvg } from '@/lib/recap-card-render';
import { getRedactSalt, isRedactEnabled } from '@/lib/redact-server';
import { redactProject } from '@/lib/redact';
import { getServerLocale } from '@/lib/i18n/server';

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

function parseVariant(value: string | null): RecapVariant {
  return value === 'square' ? 'square' : 'landscape';
}

function parseHero(value: string | null): RecapHeroKind | undefined {
  if (value === 'roi' || value === 'value' || value === 'tokens' || value === 'cache' || value === 'sessions') return value;
  return undefined;
}

function parseStyle(value: string | null): RecapStyle {
  if (value === 'hero') return 'hero';
  if (value === 'grid') return 'grid';
  return DEFAULT_RECAP_STYLE;
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
  const variant = parseVariant(url.searchParams.get('variant'));
  const heroOverride = parseHero(url.searchParams.get('hero'));
  const style = parseStyle(url.searchParams.get('style'));
  const redact = await isRedactEnabled();
  const locale = await getServerLocale();
  const card = buildRecapCard({ period, tool, settings: readRecapSettings() });
  const svg = renderRecapSvg(maybeRedact(card, redact, redact ? getRedactSalt() : ''), variant, { heroOverride, style, locale });
  // 短缓存 + ETag：同一张卡 5 分钟内被浏览器/unfurl 反复拉取时不重复传内容；
  // ETag 随 SVG 内容（含 generatedAt）变化自动失效。
  const etag = `"${createHash('sha1').update(svg).digest('hex').slice(0, 16)}"`;
  const cacheHeaders = {
    'Cache-Control': 'private, max-age=300',
    ETag: etag,
  };
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders });
  }
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      ...cacheHeaders,
    },
  });
}

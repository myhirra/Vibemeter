import { NextResponse } from 'next/server';
import { getFloatStats } from '@/lib/float-stats';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Shields.io-ish flat badge. Two pills: label (dark) and value (color).
function renderBadge(label: string, value: string, color: string): string {
  const charW = 6.2; // approx px per char for 11px DejaVu
  const labelW = Math.max(40, Math.round(label.length * charW + 14));
  const valueW = Math.max(40, Math.round(value.length * charW + 14));
  const total = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="m"><rect width="${total}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW / 2}" y="14">${esc(label)}</text>
    <text x="${labelW + valueW / 2}" y="14">${esc(value)}</text>
  </g>
</svg>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function colorFor(remaining: number | null): string {
  if (remaining == null) return '#9f9f9f';
  if (remaining >= 60) return '#4c1';   // bright green
  if (remaining >= 35) return '#a4a61d'; // yellow-green
  if (remaining >= 20) return '#dfb317'; // yellow
  if (remaining >= 10) return '#fe7d37'; // orange
  return '#e05d44';                       // red
}

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  importUsageSnapshots();
  const stats = await getFloatStats();
  const claude = stats.quotas.find((q) => q.agent === 'claude-code');
  const codex = stats.quotas.find((q) => q.agent === 'codex');

  let label = 'vibemeter';
  let value = '--';
  let color = '#9f9f9f';

  switch (slug) {
    case 'claude-5h.svg': {
      label = 'claude 5h';
      const r = claude?.remaining5h ?? null;
      value = r == null ? '—' : `${r}% left`;
      color = colorFor(r);
      break;
    }
    case 'claude-weekly.svg': {
      label = 'claude week';
      const r = claude?.remainingWeekly ?? null;
      value = r == null ? '—' : `${r}% left`;
      color = colorFor(r);
      break;
    }
    case 'codex-5h.svg': {
      label = 'codex 5h';
      const r = codex?.remaining5h ?? null;
      value = r == null ? '—' : `${r}% left`;
      color = colorFor(r);
      break;
    }
    case 'sessions-today.svg': {
      label = 'sessions today';
      value = String(stats.todaySessions);
      color = '#4c1';
      break;
    }
    case 'sessions-total.svg': {
      label = 'sessions';
      value = String(stats.totalSessions);
      color = '#4c1';
      break;
    }
    default:
      return NextResponse.json({ error: 'unknown badge', available: ['claude-5h.svg', 'claude-weekly.svg', 'codex-5h.svg', 'sessions-today.svg', 'sessions-total.svg'] }, { status: 404 });
  }

  const svg = renderBadge(label, value, color);
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

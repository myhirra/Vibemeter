'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { useEntitlement } from '@/lib/entitlements-client';
import type { WeeklyReport } from '@/lib/report/weekly';
import { isoWeekFromDate, isoWeekWindow, shiftIsoWeek } from '@/lib/report/iso-week';

interface Props {
  /**
   * The server-rendered current-week report. The card reuses this on first
   * paint so the headline lands instantly; switching weeks triggers a fetch
   * to `/api/report/weekly?week=…`.
   */
  initial: WeeklyReport;
}

interface WeekOption {
  iso: string;
  /** Human-friendly label, e.g. "2026-W22 · Jun 1 – Jun 7". */
  label: string;
}

function buildWeekOptions(): WeekOption[] {
  const now = new Date();
  const here = isoWeekFromDate(now);
  const out: WeekOption[] = [];
  for (let i = 0; i < 8; i++) {
    const shifted = i === 0 ? here : shiftIsoWeek(here.year, here.week, -i);
    const window = isoWeekWindow(shifted.year, shifted.week);
    const start = new Date(window.startMs);
    const end = new Date(window.endMs - 86_400_000); // inclusive last day
    const fmt = (d: Date) =>
      `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
    out.push({
      iso: shifted.iso,
      label: `${shifted.iso} · ${fmt(start)} – ${fmt(end)}`,
    });
  }
  return out;
}

/**
 * Phase 2 weekly report card. Free tier sees the headline only (blurred body
 * + upgrade CTA); Pro tier sees the full paragraphs, week picker, image
 * export, and recommendations.
 *
 * The image-export plumbing reuses the RecapShareButton pattern (SVG → PNG
 * via canvas) — we render a self-contained SVG inline here rather than
 * piggy-backing on the recap-card variants, which are tied to a different
 * data shape and visual identity.
 */
export function WeeklyReportCard({ initial }: Props) {
  const t = useT();
  const hasFull = useEntitlement('dashboard.weeklyReportFull');

  const options = useMemo(() => buildWeekOptions(), []);
  const [weekIso, setWeekIso] = useState<string>(initial.weekIso);
  const [report, setReport] = useState<WeeklyReport>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportState, setExportState] = useState<'idle' | 'rendering' | 'error'>('idle');

  useEffect(() => {
    // Skip the fetch when the picker matches what we already have (e.g.
    // initial mount, or user clicked the same option twice).
    if (weekIso === report.weekIso) return;
    let cancelled = false;
    // The Pro user just picked a new week — switching to a controlled fetch
    // state here is the canonical "trigger setState from effect" case, so we
    // opt out of the React 19 lint that flags it. The catch / cancellation
    // guard above keeps the cascading-render risk in check.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetch(`/api/report/weekly?week=${encodeURIComponent(weekIso)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<WeeklyReport>;
      })
      .then((payload) => {
        if (cancelled) return;
        setReport(payload);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'load failed');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [weekIso, report.weekIso]);

  async function exportImage() {
    setExportState('rendering');
    try {
      const svg = renderReportSvg(report);
      const blob = await svgToPngBlob(svg, 1200, 675);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibemeter-weekly-${report.weekIso}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportState('idle');
    } catch {
      setExportState('error');
    }
  }

  // Body = paragraphs joined; on free tier we only ever show the FIRST one
  // (blurred). On pro we show all of them stacked.
  const bodyParagraphs = report.paragraphs;
  const firstParagraph = bodyParagraphs[0];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            {t('report.card.title')}
          </p>
          <p className="text-[11px] text-zinc-600">{t('report.card.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFull && (
            <>
              <label htmlFor="weekly-report-week" className="sr-only">
                {t('report.card.weekPicker')}
              </label>
              <select
                id="weekly-report-week"
                value={weekIso}
                onChange={(event) => setWeekIso(event.target.value)}
                disabled={loading}
                className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none transition-colors hover:border-zinc-500 focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {options.map((opt) => (
                  <option key={opt.iso} value={opt.iso}>{opt.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={exportImage}
                disabled={exportState === 'rendering'}
                className="rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('report.card.exportImage')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-2 text-xs text-rose-300">{error}</p>
      )}

      {/* Headline — always visible (FREE TIER) */}
      {report.metrics.totalSessions === 0 && report.paragraphs.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('report.card.empty')}</p>
      ) : (
        <p className="text-lg font-medium leading-snug text-zinc-100">
          {report.headline}
        </p>
      )}

      {/* Body — Pro: all paragraphs stacked. Free: first paragraph blurred
          with a CTA overlay. */}
      {hasFull ? (
        bodyParagraphs.length > 0 && (
          <div className="mt-3 space-y-2 text-sm leading-relaxed text-zinc-300">
            {bodyParagraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )
      ) : (
        firstParagraph && (
          <div className="relative mt-3">
            <p
              aria-hidden
              className="select-none text-sm leading-relaxed text-zinc-300"
              style={{ filter: 'blur(4px)' }}
            >
              {firstParagraph}
            </p>
            <div className="absolute inset-0 -m-2 flex flex-col items-center justify-center gap-2 rounded-md bg-zinc-900/40 px-3 py-4 text-center backdrop-blur-[1px]">
              <p className="text-xs font-medium text-zinc-100">
                {t('report.card.proLock.title')}
              </p>
              <p className="max-w-md text-[11px] text-zinc-400">
                {t('report.card.proLock.body')}
              </p>
              <Link
                href="/pricing"
                className="mt-1 rounded-md border border-violet-500/60 bg-violet-500/20 px-3 py-1 text-[11px] text-violet-100 transition-colors hover:bg-violet-500/30"
              >
                {t('report.card.proLock.cta')}
              </Link>
            </div>
          </div>
        )
      )}

      {/* Recommendations — Pro only */}
      {hasFull && report.recommendations.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
            {t('report.card.recommendations')}
          </p>
          <ul className="space-y-1 text-sm text-zinc-300">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="text-violet-400">→</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Image export ───────────────────────────────────────────────────────────
// Self-contained SVG → PNG pipeline. We deliberately *don't* piggy-back on
// RecapShareButton's renderRecapSvg path because that one is shape-locked to
// the recap-card data and would bloat with a new variant. The Pro user wants
// a clean text-and-numbers report image, not the recap card with extra fields.

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + (line ? ' ' : '') + w).length > maxChars) {
      if (line) out.push(line);
      line = w;
    } else {
      line = line + (line ? ' ' : '') + w;
    }
  }
  if (line) out.push(line);
  return out;
}

function renderReportSvg(report: WeeklyReport): string {
  const width = 1200;
  const height = 675;
  const padding = 64;
  const lineHeight = 30;
  const headlineLines = wrapText(report.headline, 60);
  const bodyParts = report.paragraphs.flatMap((p) => [...wrapText(p, 80), '']);

  const bgColor = '#0a0a0a';
  const accent = '#a78bfa';
  const textPrimary = '#fafafa';
  const textSecondary = '#a1a1aa';
  const textMuted = '#71717a';

  let y = padding;
  const lines: string[] = [];

  lines.push(
    `<text x="${padding}" y="${y}" fill="${accent}" font-family="monospace" font-size="14" letter-spacing="2">VIBEMETER · ${esc(report.weekIso)}</text>`,
  );
  y += 50;

  for (const line of headlineLines) {
    lines.push(
      `<text x="${padding}" y="${y}" fill="${textPrimary}" font-family="system-ui, sans-serif" font-size="34" font-weight="600">${esc(line)}</text>`,
    );
    y += 44;
  }
  y += 16;

  for (const part of bodyParts) {
    if (part === '') { y += 12; continue; }
    lines.push(
      `<text x="${padding}" y="${y}" fill="${textSecondary}" font-family="system-ui, sans-serif" font-size="18">${esc(part)}</text>`,
    );
    y += lineHeight;
  }

  if (report.recommendations.length > 0) {
    y += 12;
    lines.push(
      `<text x="${padding}" y="${y}" fill="${textMuted}" font-family="system-ui, sans-serif" font-size="12" letter-spacing="2">RECOMMENDED ACTIONS</text>`,
    );
    y += 28;
    for (const rec of report.recommendations) {
      const recLines = wrapText(rec, 70);
      for (let i = 0; i < recLines.length; i++) {
        const prefix = i === 0 ? '→ ' : '   ';
        lines.push(
          `<text x="${padding}" y="${y}" fill="${textSecondary}" font-family="system-ui, sans-serif" font-size="17">${esc(prefix + recLines[i])}</text>`,
        );
        y += 26;
      }
      y += 4;
    }
  }

  lines.push(
    `<text x="${padding}" y="${height - 30}" fill="${textMuted}" font-family="monospace" font-size="11">made with Vibemeter · vibemeter.siney.top</text>`,
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <rect width="${width}" height="${height}" fill="${bgColor}"/>`,
    ...lines,
    `</svg>`,
  ].join('\n');
}

function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) reject(new Error('PNG render failed'));
          else resolve(blob);
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG render failed'));
    };
    img.src = url;
  });
}

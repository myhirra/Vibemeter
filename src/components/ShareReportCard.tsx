'use client';

import { useEffect, useRef, useState, type Ref } from 'react';
import { useLocale } from '@/lib/i18n/client';
import type { ShareReport } from '@/lib/share-report';

type LoadState = 'loading' | 'ready' | 'error';

const CARD_WIDTH = 1200;
const CARD_HEIGHT = 675;

function formatUsd(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${trimDecimal(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function multiplierText(report: ShareReport): string {
  const { apiEquivalentUsd, multiplier } = report.shareCard;
  if (apiEquivalentUsd > 0 && multiplier < 1) return '<1×';
  return `${multiplier}×`;
}

async function renderSvgToPng(svg: SVGSVGElement): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('width', String(CARD_WIDTH));
  clone.setAttribute('height', String(CARD_HEIGHT));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const svgText = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image render failed'));
    });
    image.src = url;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('png export failed'));
      }, 'image/png');
    });
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function ShareCardSvg({ report, svgRef }: { report: ShareReport; svgRef?: Ref<SVGSVGElement> }) {
  const card = report.shareCard;
  const gradientId = 'vm-share-hero-gradient';
  const glowId = 'vm-share-hero-glow';
  const dotId = 'vm-share-dot-grid';
  const washId = 'vm-share-purple-wash';
  const mono = '"SF Mono", "JetBrains Mono", ui-monospace, Menlo, Monaco, Consolas, monospace';
  const sans = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const proofUsd = `$${formatUsd(card.apiEquivalentUsd)}`;
  const planUsd = `$${Math.round(card.planWeeklyUsd)}/wk ${card.planLabel}`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}
      role="img"
      aria-label="Vibemeter weekly return share card"
      className="block h-auto w-full"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <defs>
        <pattern id={dotId} width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.4" cy="1.4" r="1.15" fill="#8b5cf6" opacity="0.16" />
        </pattern>
        <radialGradient id={washId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(216 356) rotate(20) scale(460 390)">
          <stop stopColor="#7c3aed" stopOpacity="0.34" />
          <stop offset="0.58" stopColor="#7c3aed" stopOpacity="0.12" />
          <stop offset="1" stopColor="#05050b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={gradientId} x1="82" y1="250" x2="470" y2="390" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c4b5fd" />
          <stop offset="0.62" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <filter id={glowId} x="-20%" y="-35%" width="140%" height="170%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.54 0 0 0 0 0.35 0 0 0 0 1 0 0 0 0.52 0" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x="12" y="12" width="1176" height="651" rx="28" fill="#06060d" />
      <rect x="12" y="12" width="1176" height="651" rx="28" fill={`url(#${washId})`} />
      <rect x="12" y="12" width="1176" height="651" rx="28" fill={`url(#${dotId})`} opacity="0.78" />
      <rect x="12" y="12" width="1176" height="651" rx="28" fill="none" stroke="#a78bfa" strokeOpacity="0.36" strokeWidth="1.4" />

      <rect x="93" y="68" width="15" height="15" rx="2" fill="#9b7cff" transform="rotate(45 100.5 75.5)" />
      <text x="124" y="83" fill="#f4f4f7" fontFamily={mono} fontSize="22" fontWeight="800" letterSpacing="7">VIBEMETER</text>
      <text x="1118" y="82" fill="#838194" fontFamily={mono} fontSize="18" fontWeight="500" letterSpacing="5" textAnchor="end">{card.weekLabel}</text>

      <text x="94" y="190" fill="#8f8b9f" fontFamily={mono} fontSize="19" fontWeight="500" letterSpacing="9">{card.eyebrow}</text>
      <text x="93" y="405" fill={`url(#${gradientId})`} filter={`url(#${glowId})`} fontFamily={mono} fontSize="168" fontWeight="900" letterSpacing="0">{multiplierText(report)}</text>

      <text x="96" y="462" fill="#d7d3df" fontFamily={sans} fontSize="26" fontWeight="650">
        <tspan fill="#ffffff" fontWeight="850">{proofUsd}</tspan>
        <tspan> of usage at API rates · {planUsd}</tspan>
      </text>

      <line x1="94" y1="518" x2="1118" y2="518" stroke="#342956" strokeOpacity="0.82" />

      <text x="96" y="585" fill="#f7f7fb" fontFamily={mono} fontSize="48" fontWeight="850">{formatCompact(card.totalTokens)}</text>
      <text x="96" y="622" fill="#89869b" fontFamily={mono} fontSize="15" fontWeight="600" letterSpacing="6">TOKENS</text>

      <text x="462" y="585" fill="#9b7cff" fontFamily={mono} fontSize="48" fontWeight="850">{card.cacheHitPct}%</text>
      <text x="462" y="622" fill="#89869b" fontFamily={mono} fontSize="15" fontWeight="600" letterSpacing="6">SERVED FROM CACHE</text>

      <text x="836" y="585" fill="#f7f7fb" fontFamily={sans} fontSize="34" fontWeight="820">{truncate(card.topProject, 22)}</text>
      <text x="836" y="622" fill="#89869b" fontFamily={mono} fontSize="15" fontWeight="600" letterSpacing="6">TOP PROJECT</text>

      <circle cx="97" cy="649" r="3.5" fill="#9b7cff" />
      <text x="112" y="654" fill="#777386" fontFamily={mono} fontSize="15" fontWeight="500">made with Vibemeter · vibemeter.siney.top</text>
    </svg>
  );
}

export function ShareReportCard() {
  const locale = useLocale();
  const localeEn = locale === 'en';
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [report, setReport] = useState<ShareReport | null>(null);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [imageState, setImageState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');

  async function load() {
    setState('loading');
    try {
      const response = await fetch('/api/report', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'report failed');
      setReport(payload.report);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/report', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'report failed');
        if (!active) return;
        setReport(payload.report);
        setState('ready');
      } catch {
        if (active) setState('error');
      }
    })();
    return () => { active = false; };
  }, []);

  async function copyMarkdown() {
    if (!report) return;
    await navigator.clipboard?.writeText(report.markdown);
    setCopiedMarkdown(true);
    window.setTimeout(() => setCopiedMarkdown(false), 1500);
  }

  async function copyImage() {
    if (!svgRef.current) return;
    setImageState('copying');
    try {
      const blob = await renderSvgToPng(svgRef.current);
      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      } else {
        downloadBlob(blob, 'vibemeter-week.png');
      }
      setImageState('copied');
      window.setTimeout(() => setImageState('idle'), 1500);
    } catch {
      setImageState('error');
      window.setTimeout(() => setImageState('idle'), 1800);
    }
  }

  async function downloadImage() {
    if (!svgRef.current) return;
    const blob = await renderSvgToPng(svgRef.current);
    downloadBlob(blob, 'vibemeter-week.png');
  }

  const title = localeEn ? 'Share card' : '分享卡片';
  const refresh = localeEn ? 'Refresh' : '刷新';
  const copyImageLabel = imageState === 'copying'
    ? (localeEn ? 'Rendering...' : '生成中...')
    : imageState === 'copied'
      ? (localeEn ? 'Copied PNG' : '已复制 PNG')
      : imageState === 'error'
        ? (localeEn ? 'Copy failed' : '复制失败')
        : (localeEn ? 'Copy PNG' : '复制 PNG');
  const copyMarkdownLabel = copiedMarkdown
    ? (localeEn ? 'Copied' : '已复制')
    : (localeEn ? 'Copy Markdown' : '复制 Markdown');

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500">{title}</p>
        <button
          type="button"
          onClick={load}
          disabled={state === 'loading'}
          className="shrink-0 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
        >
          {refresh}
        </button>
      </div>

      {state === 'loading' && (
        <p className="text-sm text-zinc-500">{localeEn ? 'Building report...' : '正在生成报告...'}</p>
      )}

      {state === 'error' && (
        <p className="text-sm text-red-300">{localeEn ? 'Report unavailable.' : '报告暂不可用。'}</p>
      )}

      {state === 'ready' && report && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[18px] border border-violet-400/30 bg-black shadow-2xl shadow-violet-950/30">
            <ShareCardSvg report={report} svgRef={svgRef} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={copyImage}
              disabled={imageState === 'copying'}
              className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
            >
              {copyImageLabel}
            </button>
            <button
              type="button"
              onClick={downloadImage}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              {localeEn ? 'Download PNG' : '下载 PNG'}
            </button>
            <button
              type="button"
              onClick={copyMarkdown}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
            >
              {copyMarkdownLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

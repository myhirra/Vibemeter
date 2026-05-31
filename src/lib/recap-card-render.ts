import type { RecapCardData, RecapHeroKind, RecapStyle, RecapVariant } from './recap-card';
import { DEFAULT_LOCALE, type Locale } from './i18n/types';

export const DEFAULT_RECAP_STYLE: RecapStyle = 'grid';

export interface RecapDimensions {
  width: number;
  height: number;
}

export interface RecapRenderOptions {
  /**
   * Override which hero angle the card leads with. The angle is only honored
   * if `availableHeroAngles(card)` lists it as available — otherwise the
   * renderer falls back to `card.heroKind`. This lets the modal cycle through
   * "different angle" variants without rebuilding the underlying card data.
   */
  heroOverride?: RecapHeroKind;
  /**
   * Visual style. `hero` is the classic single-big-number layout; `grid` is
   * the 2x2 dashboard-style layout (icon + label + number per cell), modeled
   * after Chinese LLM platform usage panels that have proven to be highly
   * screenshot-shareable.
   */
  style?: RecapStyle;
  locale?: Locale;
}

export function recapDimensions(variant: RecapVariant): RecapDimensions {
  return variant === 'square'
    ? { width: 1080, height: 1080 }
    : { width: 1200, height: 675 };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value: number): string {
  if (value >= 1000) {
    // $1,180 etc. — insert thousands separators while keeping integer formatting
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) {
    // Whole numbers (e.g. $46) read better without the trailing .0
    return Number.isInteger(value) ? `$${value.toFixed(0)}` : `$${value.toFixed(1)}`;
  }
  return Number.isInteger(value) ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

function compact(value: number): string {
  if (value >= 1_000_000_000) return `${Math.round(value / 100_000_000) / 10}B`;
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(Math.round(value));
}

function compactTokens(value: number): string {
  return compact(value);
}

function duration(ms: number, locale: Locale): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  if (locale === 'zh') {
    if (hours <= 0) return `${minutes} 分钟`;
    return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  }
  if (hours <= 0) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

function shortDate(d: Date, locale: Locale): string {
  return locale === 'zh' ? `${d.getMonth() + 1}/${d.getDate()}` : `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function rangeDate(start: Date, end: Date, locale: Locale): string {
  if (locale === 'zh') return `${shortDate(start, locale)}-${shortDate(end, locale)}`;
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}-${end.getDate()}`;
  }
  return `${shortDate(start, locale)} - ${shortDate(end, locale)}`;
}

function periodName(card: RecapCardData, locale: Locale): string {
  const kind = card.period.kind;
  if (locale === 'zh') {
    if (kind === 'today') return '今天';
    if (kind === '7d') return '近 7 天';
    if (kind === '30d') return '近 30 天';
    if (kind === 'month') return '本月';
    return '全部时间';
  }
  if (kind === 'today') return 'TODAY';
  if (kind === '7d') return 'WEEK';
  if (kind === '30d') return '30 DAYS';
  if (kind === 'month') return 'MONTH';
  return 'ALL TIME';
}

function toolName(card: RecapCardData, locale: Locale): string {
  if (card.tool === 'claude-code') return 'Claude Code';
  if (card.tool === 'codex') return 'Codex';
  if (card.tool === 'cursor') return 'Cursor';
  return locale === 'zh' ? '全部 Agent' : 'All agents';
}

function valueCoverage(locale: Locale): string {
  return locale === 'zh' ? 'Claude Code + Codex API 等价估算' : 'Claude Code + Codex API equivalent estimate';
}

function watermark(locale: Locale): string {
  return locale === 'zh' ? '由 Vibemeter 生成 · vibemeter.siney.top' : 'made with Vibemeter · vibemeter.siney.top';
}

function periodLabel(card: RecapCardData, locale: Locale): string {
  const period = card.period;
  if (period.kind === 'all') return periodName(card, locale);
  if (period.kind === 'today') {
    const d = new Date(period.startMs);
    return locale === 'zh' ? `今天 · ${shortDate(d, locale)}` : `TODAY · ${shortDate(d, locale)}`;
  }
  if (period.kind === 'month') {
    const d = new Date(period.startMs);
    return locale === 'zh' ? `本月 · ${d.getMonth() + 1}月 ${d.getFullYear()}` : `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }
  const start = new Date(period.startMs);
  const end = new Date(period.endMs);
  const name = periodName(card, locale);
  return locale === 'zh' ? `${name} · ${rangeDate(start, end, locale)}` : `${name} · ${rangeDate(start, end, locale)}`;
}

function tagline(card: RecapCardData, hero: RecapHeroKind, locale: Locale): string {
  if (hero === 'not_enough_data') return locale === 'zh' ? '等待更多数据' : 'WAITING FOR DATA';
  if (card.tool === 'all') return locale === 'zh' ? '可计量汇总' : 'METERED TOTAL';
  return locale === 'zh' ? `${toolName(card, locale)} 汇总` : `${toolName(card, locale).toUpperCase()} TOTAL`;
}

/**
 * Returns hero angles that have enough data to render meaningfully. Used by
 * the "different angle" cycler in `RecapShareButton` so we never show e.g. a
 * cache angle when the user has zero cached sessions analyzed.
 */
export function availableHeroAngles(card: RecapCardData): RecapHeroKind[] {
  if (!card.minimumData.ok) return ['not_enough_data'];
  const angles: RecapHeroKind[] = [];
  if (card.roiMultiplier != null && card.subscriptionCostUsd != null) angles.push('roi');
  if (card.valueAtApiRatesUsd > 0) angles.push('value');
  if (card.totalTokens.total > 0) angles.push('tokens');
  if (card.cacheSessionsAnalyzed > 0) angles.push('cache');
  if (card.totalSessions > 0) angles.push('sessions');
  if (angles.length === 0) angles.push('value');
  return angles;
}

/** Resolve the effective hero angle given an optional override. */
function resolveHero(card: RecapCardData, override: RecapHeroKind | undefined): RecapHeroKind {
  if (!override) return card.heroKind;
  const available = availableHeroAngles(card);
  return available.includes(override) ? override : card.heroKind;
}

interface HeroDisplay {
  big: string;
  subline: string;
  accent: string;
}

function heroDisplay(card: RecapCardData, hero: RecapHeroKind, locale: Locale): HeroDisplay {
  if (hero === 'roi' && card.roiMultiplier != null && card.subscriptionCostUsd != null) {
    const roi = card.roiMultiplier >= 100
      ? card.roiMultiplier.toFixed(0)
      : card.roiMultiplier.toFixed(1).replace(/\.0$/, '');
    // "×" is the literal MULTIPLICATION SIGN U+00D7 (not the ASCII letter x).
    const planLabel = card.subscriptionPlanLabel ?? 'subscription';
    const perPeriod = locale === 'zh'
      ? card.period.kind === 'month' ? '/月' : card.period.kind === 'today' ? '/天' : '/周'
      : card.period.kind === 'month' ? '/mo' : card.period.kind === 'today' ? '/day' : '/wk';
    // ROI numerator is Claude-only (subscription is Claude); show Claude $
    // instead of the combined value here so the ratio is visibly consistent.
    return {
      big: `${roi}×`,
      subline: locale === 'zh'
        ? `${money(card.claudeValueUsd)} Claude API 等价    ${money(card.subscriptionCostUsd)}${perPeriod} ${planLabel}`
        : `${money(card.claudeValueUsd)} Claude usage at API rates    ${money(card.subscriptionCostUsd)}${perPeriod} ${planLabel} plan`,
      accent: '#f4f4f5',
    };
  }
  if (hero === 'cache' && card.cacheSessionsAnalyzed > 0) {
    return {
      big: `${card.cacheHitRatePct}%`,
      subline: locale === 'zh'
        ? `来自缓存    复读节省 ${compactTokens(card.cacheSummary.inputTokensSaved)} tokens`
        : `served from cache    ${compactTokens(card.cacheSummary.inputTokensSaved)} tokens saved from re-reads`,
      accent: '#34d399',
    };
  }
  if (hero === 'sessions' && card.totalSessions > 0) {
    const totalMs = card.topProjects.reduce((acc, p) => acc + p.totalMs, 0);
    const durLabel = totalMs > 0 ? duration(totalMs, locale) : '—';
    return {
      big: `${card.totalSessions}`,
      subline: locale === 'zh' ? `AI 编码会话    ${durLabel} 专注时间` : `AI coding sessions    ${durLabel} of focused work`,
      accent: '#fbbf24',
    };
  }
  if (hero === 'tokens' && card.totalTokens.total > 0) {
    return {
      big: compactTokens(card.totalTokens.total),
      subline: locale === 'zh'
        ? `Token 消耗量 · ${toolName(card, locale)}`
        : `token usage · ${toolName(card, locale)}`,
      accent: '#a78bfa',
    };
  }
  if (hero === 'value' || hero === 'roi') {
    // roi fallback when subscription wasn't set: show $ value
    return {
      big: money(card.valueAtApiRatesUsd),
      subline: `${compactTokens(card.totalTokens.total)} tokens · ${valueCoverage(locale)}`,
      accent: '#f4f4f5',
    };
  }
  return {
    big: '—',
    subline: locale === 'zh' ? '先跑几次 AI 编码会话，再生成卡片。' : 'Run a few AI coding sessions, then make the card.',
    accent: '#a78bfa',
  };
}

interface Layout {
  width: number;
  height: number;
  pad: number;
  topY: number;       // brand baseline y
  taglineY: number;   // tagline baseline y
  heroY: number;      // big number baseline y
  sublineY: number;   // hero sub-row baseline y
  ruleY: number;      // horizontal rule y
  metricsY: number;   // metric strip baseline (label) y
  metricsValueY: number; // metric strip value y
  footerY: number;    // watermark baseline y
  heroFontPx: number;
  taglineFontPx: number;
}

function layoutFor(variant: RecapVariant): Layout {
  if (variant === 'square') {
    const width = 1080;
    const height = 1080;
    const pad = 80;
    return {
      width, height, pad,
      topY: 130,
      taglineY: 270,
      heroY: 540,
      sublineY: 620,
      ruleY: 720,
      metricsY: 790,
      metricsValueY: 880,
      footerY: height - 56,
      heroFontPx: 220,
      taglineFontPx: 60,
    };
  }
  const width = 1200;
  const height = 675;
  const pad = 70;
  return {
    width, height, pad,
    topY: 92,
    taglineY: 188,
    heroY: 372,
    sublineY: 442,
    ruleY: 484,
    metricsY: 520,
    metricsValueY: 568,
    footerY: height - 30,
    heroFontPx: 170,
    taglineFontPx: 52,
  };
}

/**
 * Reasonable horizontal width for the big hero number so it doesn't overflow
 * when the value is wider than expected (e.g. "$1,180" vs "25×"). We shrink
 * the font on long strings instead of letting it spill across the card.
 */
function heroFontSize(big: string, baseFontPx: number): number {
  if (big.length <= 3) return baseFontPx;
  if (big.length <= 5) return Math.round(baseFontPx * 0.85);
  if (big.length <= 7) return Math.round(baseFontPx * 0.72);
  return Math.round(baseFontPx * 0.6);
}

export function renderRecapSvg(
  card: RecapCardData,
  variant: RecapVariant = 'landscape',
  options: RecapRenderOptions = {},
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  if (options.style === 'grid') {
    return renderRecapSvgGrid(card, variant, locale);
  }
  const layout = layoutFor(variant);
  const { width, height, pad } = layout;
  const hero = resolveHero(card, options.heroOverride);
  const display = heroDisplay(card, hero, locale);
  const heroFontPx = heroFontSize(display.big, layout.heroFontPx);
  const periodCaption = periodLabel(card, locale);
  const taglineText = tagline(card, hero, locale);

  const tokenMetric = {
    value: compactTokens(card.totalTokens.total),
    label: locale === 'zh' ? 'TOKEN 消耗量' : 'TOKENS',
    color: '#a78bfa',
    className: 'metric-value',
  };
  const valueMetric = {
    value: money(card.valueAtApiRatesUsd),
    label: locale === 'zh' ? '价值' : 'VALUE',
    color: '#f4f4f5',
    className: 'metric-value',
  };
  const cacheMetric = {
    value: card.cacheSessionsAnalyzed > 0 ? `${card.cacheHitRatePct}%` : '—',
    label: locale === 'zh' ? 'CACHE 命中' : 'SERVED FROM CACHE',
    color: '#34d399',
    className: 'metric-value',
  };
  const topProject = card.topProjects[0];
  const topProjectName = topProject ? truncate(topProject.project, 18) : locale === 'zh' ? '暂无项目' : 'no project';
  const projectMetric = {
    value: topProjectName,
    label: locale === 'zh' ? 'TOP 项目' : 'TOP PROJECT',
    color: '#f4f4f5',
    className: 'metric-value-text',
  };
  const metricStrip = hero === 'value' || hero === 'roi'
    ? [tokenMetric, cacheMetric, projectMetric]
    : hero === 'tokens'
      ? [valueMetric, cacheMetric, projectMetric]
      : hero === 'cache'
        ? [tokenMetric, valueMetric, projectMetric]
        : [tokenMetric, valueMetric, cacheMetric];

  // Three columns of the bottom strip, evenly distributed across the usable width
  const col1X = pad;
  const col2X = pad + Math.round((width - pad * 2) * 0.34);
  const col3X = pad + Math.round((width - pad * 2) * 0.68);

  const diamondX = pad;
  const diamondY = layout.topY - 14;
  const diamondSize = 14;

  const bulletX = pad;
  const bulletY = layout.footerY - 6;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Vibemeter recap card">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a10"/>
      <stop offset="55%" stop-color="#101018"/>
      <stop offset="100%" stop-color="#0a1410"/>
    </linearGradient>
    <style>
      .brand { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 22px; font-weight: 800; letter-spacing: 4px; fill: #f4f4f5; }
      .period { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 18px; font-weight: 700; letter-spacing: 4px; fill: #a1a1aa; }
      .tagline { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: ${layout.taglineFontPx}px; font-weight: 800; letter-spacing: 2px; fill: #f4f4f5; }
      .hero-big { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: ${heroFontPx}px; font-weight: 900; fill: ${display.accent}; }
      .hero-subline { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 22px; font-weight: 500; fill: #d4d4d8; letter-spacing: 0.4px; }
      .metric-value { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 42px; font-weight: 900; }
      .metric-value-text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 28px; font-weight: 800; fill: #f4f4f5; }
      .metric-label { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; font-weight: 700; letter-spacing: 3px; fill: #71717a; }
      .footer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 16px; font-weight: 500; fill: #a1a1aa; letter-spacing: 0.5px; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>

  <!-- Top row: brand mark + period caption -->
  <rect x="${diamondX}" y="${diamondY}" width="${diamondSize}" height="${diamondSize}" transform="rotate(45 ${diamondX + diamondSize / 2} ${diamondY + diamondSize / 2})" fill="#a78bfa"/>
  <text x="${diamondX + diamondSize + 16}" y="${layout.topY}" class="brand">VIBEMETER</text>
  <text x="${width - pad}" y="${layout.topY}" class="period" text-anchor="end">${esc(periodCaption)}</text>

  <!-- Tagline (large secondary headline) -->
  <text x="${pad}" y="${layout.taglineY}" class="tagline">${esc(taglineText)}</text>

  <!-- Hero big number -->
  <text x="${pad}" y="${layout.heroY}" class="hero-big">${esc(display.big)}</text>

  <!-- Hero subline -->
  <text x="${pad}" y="${layout.sublineY}" class="hero-subline">${esc(display.subline)}</text>

  <!-- Horizontal rule -->
  <path d="M${pad} ${layout.ruleY} H${width - pad}" stroke="#27272f" stroke-width="1"/>

  <!-- Bottom strip: three columns -->
  <text x="${col1X}" y="${layout.metricsValueY}" class="${metricStrip[0].className}" fill="${metricStrip[0].color}">${esc(metricStrip[0].value)}</text>
  <text x="${col1X}" y="${layout.metricsValueY + 32}" class="metric-label">${esc(metricStrip[0].label)}</text>

  <text x="${col2X}" y="${layout.metricsValueY}" class="${metricStrip[1].className}" fill="${metricStrip[1].color}">${esc(metricStrip[1].value)}</text>
  <text x="${col2X}" y="${layout.metricsValueY + 32}" class="metric-label">${esc(metricStrip[1].label)}</text>

  <text x="${col3X}" y="${layout.metricsValueY}" class="${metricStrip[2].className}" fill="${metricStrip[2].color}">${esc(metricStrip[2].value)}</text>
  <text x="${col3X}" y="${layout.metricsValueY + 32}" class="metric-label">${esc(metricStrip[2].label)}</text>

  <!-- Footer -->
  <circle cx="${bulletX + 5}" cy="${bulletY - 5}" r="5" fill="#a78bfa"/>
  <text x="${bulletX + 20}" y="${layout.footerY}" class="footer">${esc(watermark(locale))}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Grid style (2x2 dashboard) — inspired by Chinese LLM platform usage panels.
// Four metric cards: VALUE / TOKENS / CACHE / SESSIONS. Each cell has a
// colored circular icon, a small label, and a large number. Sparklines are
// reserved for a future iteration once daily series are wired through
// RecapCardData; first pass is static for fast visual validation.
// ---------------------------------------------------------------------------

interface GridCell {
  label: string;
  value: string;
  iconChar: string;
  iconBg: string;
  iconFg: string;
  valueColor: string;
  /** Raw daily series for the sparkline. Null/empty/length<2 → no line drawn. */
  series: number[];
  /** Stroke color for the sparkline; defaults to the icon background. */
  sparkColor: string;
}

function gridCellsFor(card: RecapCardData, locale: Locale): GridCell[] {
  const valueStr = money(card.valueAtApiRatesUsd);
  const tokensStr = compactTokens(card.totalTokens.total);
  const cacheStr = card.cacheSessionsAnalyzed > 0 ? `${card.cacheHitRatePct}%` : '—';
  const promptsStr = card.promptCount > 0 ? compact(card.promptCount) : '—';
  // Mark the VALUE label when Codex (a blended estimate) contributes — the
  // hero subline already discloses this, but the grid layout has no subline
  // per cell, so the label is the only spot to flag it.
  const valueLabel = card.codexValueUsd > 0
    ? (locale === 'zh' ? '价值（含估算）' : 'VALUE (API + est.)')
    : (locale === 'zh' ? '价值' : 'VALUE (API)');

  return [
    {
      label: valueLabel,
      value: valueStr,
      iconChar: '$',
      iconBg: '#fbbf24',
      iconFg: '#1c1917',
      valueColor: '#fde68a',
      series: card.series.value,
      sparkColor: '#fbbf24',
    },
    {
      label: locale === 'zh' ? 'TOKEN 消耗量' : 'TOKENS',
      value: tokensStr,
      iconChar: 'T',
      iconBg: '#f472b6',
      iconFg: '#1c1917',
      valueColor: '#fbcfe8',
      series: card.series.tokens,
      sparkColor: '#f472b6',
    },
    {
      label: locale === 'zh' ? 'CACHE 命中率' : 'CACHE',
      value: cacheStr,
      iconChar: '%',
      iconBg: '#60a5fa',
      iconFg: '#0c1424',
      valueColor: '#bfdbfe',
      series: card.series.cacheHit,
      sparkColor: '#60a5fa',
    },
    {
      label: locale === 'zh' ? 'PROMPT 数' : 'PROMPTS',
      value: promptsStr,
      iconChar: 'P',
      iconBg: '#fb923c',
      iconFg: '#1c1917',
      valueColor: '#fed7aa',
      series: card.series.prompts,
      sparkColor: '#fb923c',
    },
  ];
}

/**
 * Build a polyline path string for a sparkline. Returns an empty string when
 * the series has fewer than 2 points (in which case the caller should skip
 * rendering). Normalizes each value into [0, sparkH], inverted so larger
 * values sit higher on the card (smaller y).
 */
function sparklinePath(series: number[], x0: number, y0: number, w: number, h: number): string {
  if (!series || series.length < 2) return '';
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min;
  const step = w / (series.length - 1);
  // Flat series → render a horizontal line at the vertical midpoint so the
  // sparkline area still reads as "we have data" instead of looking broken.
  if (range === 0) {
    return `M${x0.toFixed(1)} ${(y0 + h / 2).toFixed(1)} H${(x0 + w).toFixed(1)}`;
  }
  const parts: string[] = [];
  for (let i = 0; i < series.length; i++) {
    const norm = (series[i] - min) / range;
    const x = x0 + i * step;
    const y = y0 + h - norm * h;
    parts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(' ');
}

/**
 * Pick a value font size that fits the cell. Long token counts like
 * "124,541,619" need to shrink so they don't bleed past the cell's right edge.
 */
function gridValueFontSize(value: string, cellWidth: number): number {
  // Rough monospace width estimate: 0.55em per char at the base size.
  const baseSize = 88;
  const usable = cellWidth - 80; // 32 inset on both sides + icon space allowance
  const fits = usable / Math.max(1, value.length) / 0.55;
  return Math.max(36, Math.min(baseSize, Math.floor(fits)));
}

function renderRecapSvgGrid(card: RecapCardData, variant: RecapVariant, locale: Locale): string {
  const isSquare = variant === 'square';
  const width = isSquare ? 1080 : 1200;
  const height = isSquare ? 1080 : 675;
  const pad = isSquare ? 60 : 50;
  const gap = isSquare ? 24 : 20;

  const brandY = isSquare ? 100 : 80;
  const titleY = isSquare ? 192 : 152;
  const gridTop = isSquare ? 260 : 200;
  const footerY = height - (isSquare ? 50 : 36);
  const gridBottom = footerY - (isSquare ? 40 : 30);

  const cellW = (width - pad * 2 - gap) / 2;
  const cellH = (gridBottom - gridTop - gap) / 2;
  const titleFontPx = isSquare ? 56 : 44;

  const periodCaption = periodLabel(card, locale);
  const titleText = card.minimumData.ok
    ? tagline(card, card.heroKind, locale)
    : locale === 'zh' ? '等待更多数据' : 'WAITING FOR DATA';

  const cells = gridCellsFor(card, locale);

  const cellSvgs = cells.map((cell, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = pad + col * (cellW + gap);
    const y = gridTop + row * (cellH + gap);
    const inset = isSquare ? 32 : 26;
    const iconSize = isSquare ? 56 : 46;
    const labelFontPx = isSquare ? 18 : 16;
    const valueFontPx = gridValueFontSize(cell.value, cellW);

    const iconCx = x + inset + iconSize / 2;
    const iconCy = y + inset + iconSize / 2;
    const labelX = x + inset + iconSize + 16;
    const labelY = iconCy + 6;
    const valueY = y + cellH - inset - 8;

    // Sparkline sits in the top-right of the cell, vertically centered on the
    // icon/label band. Putting it here (instead of next to the big number)
    // guarantees long values like "124,541,619" never collide with the line.
    const sparkW = Math.round(cellW * (isSquare ? 0.34 : 0.30));
    const sparkH = iconSize - 4;
    const sparkX = x + cellW - inset - sparkW;
    const sparkY = iconCy - sparkH / 2;
    const sparkPath = sparklinePath(cell.series, sparkX, sparkY, sparkW, sparkH);

    const sparkMarkup = sparkPath
      ? `
  <path d="${sparkPath}" fill="none" stroke="${cell.sparkColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
      : '';

    return `
  <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="24" ry="24" fill="#16161e" stroke="#27272f" stroke-width="1"/>
  <circle cx="${iconCx}" cy="${iconCy}" r="${iconSize / 2}" fill="${cell.iconBg}"/>
  <text x="${iconCx}" y="${iconCy + 8}" class="grid-icon" fill="${cell.iconFg}" text-anchor="middle">${esc(cell.iconChar)}</text>
  <text x="${labelX}" y="${labelY}" class="grid-label" style="font-size:${labelFontPx}px">${esc(cell.label)}</text>${sparkMarkup}
  <text x="${x + inset}" y="${valueY}" class="grid-value" style="font-size:${valueFontPx}px" fill="${cell.valueColor}">${esc(cell.value)}</text>`;
  }).join('');

  const diamondX = pad;
  const diamondY = brandY - 14;
  const diamondSize = 14;
  const footerBulletX = pad;
  const footerBulletY = footerY - 6;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Vibemeter recap grid card">
  <defs>
    <linearGradient id="bg-grid" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a10"/>
      <stop offset="55%" stop-color="#101018"/>
      <stop offset="100%" stop-color="#0a1410"/>
    </linearGradient>
    <style>
      .brand { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 22px; font-weight: 800; letter-spacing: 4px; fill: #f4f4f5; }
      .period { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 18px; font-weight: 700; letter-spacing: 4px; fill: #a1a1aa; }
      .grid-title { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: ${titleFontPx}px; font-weight: 800; letter-spacing: 2px; fill: #f4f4f5; }
      .grid-icon { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 26px; font-weight: 900; }
      .grid-label { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 700; letter-spacing: 3px; fill: #a1a1aa; }
      .grid-value { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 900; letter-spacing: 0.5px; }
      .footer { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 16px; font-weight: 500; fill: #a1a1aa; letter-spacing: 0.5px; }
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg-grid)"/>

  <!-- Top row: brand mark + period caption -->
  <rect x="${diamondX}" y="${diamondY}" width="${diamondSize}" height="${diamondSize}" transform="rotate(45 ${diamondX + diamondSize / 2} ${diamondY + diamondSize / 2})" fill="#a78bfa"/>
  <text x="${diamondX + diamondSize + 16}" y="${brandY}" class="brand">VIBEMETER</text>
  <text x="${width - pad}" y="${brandY}" class="period" text-anchor="end">${esc(periodCaption)}</text>

  <!-- Title -->
  <text x="${pad}" y="${titleY}" class="grid-title">${esc(titleText)}</text>

  <!-- 2x2 grid of metric cells -->
  ${cellSvgs}

  <!-- Footer -->
  <circle cx="${footerBulletX + 5}" cy="${footerBulletY - 5}" r="5" fill="#a78bfa"/>
  <text x="${footerBulletX + 20}" y="${footerY}" class="footer">${esc(watermark(locale))}</text>
</svg>`;
}

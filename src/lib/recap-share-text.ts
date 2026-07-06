import type { RecapCardData, RecapPeriod } from './recap-card';
import type { Locale } from './i18n';

/**
 * 分享文案里的回流链接。src 参数是官网 nginx 日志里唯一的传播归因手段
 * （卡片是静态图片，只有随图文案里的链接可点、可统计）。
 */
export const RECAP_SHARE_URL = 'https://vibemeter.siney.top/?src=recap-card';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function fmtRoi(n: number): string {
  return n >= 10 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '');
}

const PERIOD_TEXT: Record<RecapPeriod, { zh: string; en: string }> = {
  today: { zh: '今天', en: 'Today' },
  '7d': { zh: '过去 7 天', en: 'My last 7 days of AI coding' },
  '30d': { zh: '过去 30 天', en: 'My last 30 days of AI coding' },
  month: { zh: '本月', en: 'This month of AI coding' },
  all: { zh: '至今', en: 'My AI coding, all time' },
};

/** 随卡片图片一起发出去的配文：核心数字 + 可点击的归因链接。 */
export function buildRecapShareText(card: RecapCardData, locale: Locale): string {
  const p = PERIOD_TEXT[card.period.kind] ?? PERIOD_TEXT['7d'];
  const tokens = fmtTokens(card.totalTokens.total);
  const value = fmtUsd(card.valueAtApiRatesUsd);
  const roi = card.roiMultiplier != null && card.roiMultiplier >= 2 ? fmtRoi(card.roiMultiplier) : null;

  if (locale === 'zh') {
    const roiPart = roi ? `，订阅回本 ${roi}×` : '';
    return `${p.zh}我用 AI 编码跑了 ${tokens} tokens、${card.totalSessions} 个会话，API 等值 ${value}${roiPart}。Vibemeter 本地统计，零上传 → ${RECAP_SHARE_URL}`;
  }
  const roiPart = roi ? ` · ${roi}× my subscription` : '';
  return `${p.en}: ${tokens} tokens · ${card.totalSessions} sessions · ${value} at API rates${roiPart}. Tracked locally with Vibemeter → ${RECAP_SHARE_URL}`;
}

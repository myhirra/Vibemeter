// Markdown formatters for alert messages. Both Chinese and English variants
// live here side by side — the user's `pushLocale` setting picks which one
// to render. Independent of UI locale because push targets (group chats)
// may have a different language audience than the dashboard viewer.

import type { FloatQuota, FloatStats } from '@/lib/float-stats';
import type { AlertMetric, AlertRule, PushLocale, ResetMetric } from './types';

function pct(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function shortTimeUntil(target: number | null | undefined, locale: PushLocale): string {
  if (!target) return '—';
  const diff = target - Date.now();
  if (diff <= 0) return locale === 'en' ? 'just now' : '已重置';
  const mins = Math.round(diff / 60_000);
  if (locale === 'en') {
    if (mins < 60) return `in ${mins} min`;
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return r === 0 ? `in ${h}h` : `in ${h}h ${r}m`;
  }
  if (mins < 60) return `${mins} 分钟后`;
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return r === 0 ? `${h} 小时后` : `${h} 小时 ${r} 分后`;
}

function clockTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const METRIC_LABELS: Record<PushLocale, Record<AlertMetric, string>> = {
  zh: {
    claude_5h_remaining_pct: 'Claude Code · 5h 剩余',
    claude_weekly_remaining_pct: 'Claude Code · 本周剩余',
    codex_5h_remaining_pct: 'Codex · 5h 剩余',
    codex_weekly_remaining_pct: 'Codex · 本周剩余',
  },
  en: {
    claude_5h_remaining_pct: 'Claude Code · 5h remaining',
    claude_weekly_remaining_pct: 'Claude Code · weekly remaining',
    codex_5h_remaining_pct: 'Codex · 5h remaining',
    codex_weekly_remaining_pct: 'Codex · weekly remaining',
  },
};

const RESET_LABELS: Record<PushLocale, Record<ResetMetric, string>> = {
  zh: {
    claude_5h: 'Claude Code · 5h 窗口',
    claude_weekly: 'Claude Code · 本周窗口',
    codex_5h: 'Codex · 5h 窗口',
    codex_weekly: 'Codex · 本周窗口',
  },
  en: {
    claude_5h: 'Claude Code · 5h window',
    claude_weekly: 'Claude Code · weekly window',
    codex_5h: 'Codex · 5h window',
    codex_weekly: 'Codex · weekly window',
  },
};

function quotaLine(q: FloatQuota | null, label: string, locale: PushLocale): string | null {
  if (!q) return null;
  const segments: string[] = [];
  if (q.remaining5h != null) {
    segments.push(locale === 'en'
      ? `5h: ${pct(q.remaining5h)} left (resets ${clockTime(q.resetAt5h)})`
      : `5h 剩 ${pct(q.remaining5h)} (重置 ${clockTime(q.resetAt5h)})`);
  }
  if (q.remainingWeekly != null) {
    segments.push(locale === 'en'
      ? `weekly: ${pct(q.remainingWeekly)} left (resets ${clockTime(q.resetAtWeekly)})`
      : `本周剩 ${pct(q.remainingWeekly)} (重置 ${clockTime(q.resetAtWeekly)})`);
  }
  if (segments.length === 0) return null;
  return `- **${label}**：${segments.join(' · ')}`;
}

function quotasMarkdown(stats: FloatStats, locale: PushLocale): string {
  const lines = stats.quotas
    .map((q) => quotaLine(q, q.accountLabel ? `${q.label} · ${q.accountLabel}` : q.label, locale))
    .filter((l): l is string => !!l);
  return lines.length
    ? lines.join('\n')
    : locale === 'en'
      ? '(no readable quota data)'
      : '（暂无可读取的额度信息）';
}

export function formatDailySummary(stats: FloatStats, locale: PushLocale = 'zh'): { title: string; body: string } {
  const dateLabel = new Date().toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
  const title = locale === 'en' ? `Vibemeter · ${dateLabel} quota summary` : `Vibemeter · ${dateLabel} 额度摘要`;
  const lines = [
    quotasMarkdown(stats, locale),
    '',
    locale === 'en'
      ? `Sessions today: ${stats.todaySessions} · cumulative: ${stats.totalSessions}`
      : `今日会话：${stats.todaySessions} · 累计会话：${stats.totalSessions}`,
  ];
  if (stats.lastSession) {
    lines.push(
      locale === 'en'
        ? `Latest: ${stats.lastSession.tool} · ${stats.lastSession.project}${stats.lastSession.title ? ` · ${stats.lastSession.title}` : ''}`
        : `最近：${stats.lastSession.tool} · ${stats.lastSession.project}${stats.lastSession.title ? ` · ${stats.lastSession.title}` : ''}`,
    );
  }
  return { title, body: lines.join('\n') };
}

export function formatThresholdAlert(
  rule: Extract<AlertRule, { kind: 'threshold' }>,
  currentValue: number,
  stats: FloatStats,
  locale: PushLocale = 'zh',
): { title: string; body: string } {
  const metricLabel = METRIC_LABELS[locale][rule.metric];
  const title = locale === 'en'
    ? `⚠️ Vibemeter · ${metricLabel} is ${pct(currentValue)}`
    : `⚠️ Vibemeter · ${metricLabel} 已 ${pct(currentValue)}`;
  const body = locale === 'en'
    ? [
        `**${metricLabel}** crossed the threshold (< ${rule.below}%); currently ${pct(currentValue)}.`,
        '',
        'Current quota across channels:',
        quotasMarkdown(stats, locale),
      ].join('\n')
    : [
        `**${metricLabel}** 跌破阈值（< ${rule.below}%），当前 ${pct(currentValue)}。`,
        '',
        '当前各通道额度：',
        quotasMarkdown(stats, locale),
      ].join('\n');
  return { title, body };
}

export function formatResetReminder(
  rule: Extract<AlertRule, { kind: 'reset_reminder' }>,
  quota: FloatQuota,
  remaining: number | null,
  resetAt: number | null,
  locale: PushLocale = 'zh',
): { title: string; body: string } {
  void quota;
  const label = RESET_LABELS[locale][rule.metric];
  const title = locale === 'en'
    ? `⏰ ${label} resets ${shortTimeUntil(resetAt, locale)} · ${pct(remaining)} unused`
    : `⏰ ${label} ${shortTimeUntil(resetAt, locale)}重置 · 还剩 ${pct(remaining)}`;
  const body = locale === 'en'
    ? [
        `**${label}** resets ${shortTimeUntil(resetAt, locale)}.`,
        `${pct(remaining)} is still unused — burn it before it expires.`,
        '',
        `Resets at: ${clockTime(resetAt)}`,
      ].join('\n')
    : [
        `**${label}** 即将重置（${shortTimeUntil(resetAt, locale)}）。`,
        `当前还剩 ${pct(remaining)} 未用 —— 趁额度作废前用掉它。`,
        '',
        `重置时间：${clockTime(resetAt)}`,
      ].join('\n');
  return { title, body };
}

export function formatVendorEvent(
  rule: Extract<AlertRule, { kind: 'vendor_event' }>,
  pctBefore: number,
  newResetAt: number,
  locale: PushLocale = 'zh',
): { title: string; body: string } {
  const label = RESET_LABELS[locale][rule.metric];
  const nextResetLocal = new Date(newResetAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const title = locale === 'en'
    ? `🎁 ${label} was reset by vendor · was ${pct(pctBefore)}`
    : `🎁 ${label} 被官方提前重置 · 重置前 ${pct(pctBefore)}`;
  const body = locale === 'en'
    ? [
        `**${label}** just dropped to 0% before its scheduled reset — looks like a vendor-initiated bulk reset.`,
        `Last reading before the drop: ${pct(pctBefore)} used.`,
        '',
        `New reset window ends: ${nextResetLocal}`,
      ].join('\n')
    : [
        `**${label}** 在原定重置时间之前突然归零 —— 看起来是官方批量重置了配额。`,
        `归零前最后读数：已用 ${pct(pctBefore)}。`,
        '',
        `新窗口截止：${nextResetLocal}`,
      ].join('\n');
  return { title, body };
}

export function formatTestMessage(locale: PushLocale = 'zh'): { title: string; body: string } {
  return locale === 'en'
    ? {
        title: 'Vibemeter · push channel test',
        body: [
          `This is a test push from Vibemeter, sent at ${new Date().toLocaleString('en-US')}.`,
          '',
          'Getting this means your webhook is wired up correctly. You can now configure thresholds, daily summaries, and reset reminders.',
        ].join('\n'),
      }
    : {
        title: 'Vibemeter · 推送通道测试',
        body: [
          `这是一条来自 Vibemeter 的测试推送，发送时间：${new Date().toLocaleString('zh-CN')}`,
          '',
          '收到这条消息说明 webhook 配置无误。可以放心配置阈值 / 每日 / 重置规则了。',
        ].join('\n'),
      };
}

// Alert settings API. Webhook secrets are masked on GET and never echoed
// to logs. PUT accepts the sentinel `WEBHOOK_UNCHANGED_SENTINEL` to preserve
// an existing webhook without the UI having to round-trip the plaintext.

import { NextResponse } from 'next/server';
import { dispatch } from '@/lib/alerts/dispatch';
import { formatDailySummary, formatTestMessage } from '@/lib/alerts/format';
import { getFloatStats } from '@/lib/float-stats';
import { runAlertsOnce } from '@/lib/alerts/runner';
import {
  alertsConfigPath,
  maskWebhook,
  readAlertConfig,
  readAlertState,
  WEBHOOK_UNCHANGED_SENTINEL,
  writeAlertConfig,
} from '@/lib/alerts/storage';
import type { AlertChannel, AlertConfig, AlertRule, PushLocale } from '@/lib/alerts/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function maskConfig(config: AlertConfig): AlertConfig {
  return {
    channels: config.channels.map((c) => ({ ...c, webhook: maskWebhook(c.webhook) })),
    rules: config.rules,
    pushLocale: config.pushLocale ?? 'zh',
  };
}

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Alert settings operation failed' },
    { status },
  );
}

function validateChannel(c: unknown): AlertChannel {
  if (!c || typeof c !== 'object') throw new Error('Invalid channel');
  const obj = c as Record<string, unknown>;
  const id = String(obj.id ?? '').trim();
  const type = obj.type;
  if (type !== 'wxwork' && type !== 'generic') throw new Error('Unknown channel type');
  const label = String(obj.label ?? '').trim() || 'channel';
  const webhook = String(obj.webhook ?? '');
  if (!id) throw new Error('Channel id required');
  const headers = obj.headers && typeof obj.headers === 'object' && !Array.isArray(obj.headers)
    ? Object.fromEntries(Object.entries(obj.headers as Record<string, unknown>).map(([k, v]) => [String(k), String(v)]))
    : undefined;
  return { id, type, label, webhook, headers };
}

function validateRule(r: unknown): AlertRule {
  if (!r || typeof r !== 'object') throw new Error('Invalid rule');
  const obj = r as Record<string, unknown>;
  const id = String(obj.id ?? '').trim();
  if (!id) throw new Error('Rule id required');
  const channelIds = Array.isArray(obj.channelIds) ? obj.channelIds.map(String) : [];
  const enabled = obj.enabled !== false;
  const label = obj.label != null ? String(obj.label) : undefined;
  if (obj.kind === 'threshold') {
    const metric = String(obj.metric ?? '');
    const below = Number(obj.below);
    if (!Number.isFinite(below) || below <= 0 || below > 100) throw new Error('threshold.below must be 0-100');
    const allowed = ['claude_5h_remaining_pct', 'claude_weekly_remaining_pct', 'codex_5h_remaining_pct', 'codex_weekly_remaining_pct'] as const;
    if (!allowed.includes(metric as (typeof allowed)[number])) {
      throw new Error('threshold.metric invalid');
    }
    return { id, kind: 'threshold', label, metric: metric as (typeof allowed)[number], below, channelIds, enabled };
  }
  if (obj.kind === 'daily') {
    const hour = Number(obj.hour);
    const minute = Number(obj.minute);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('daily.hour 0-23');
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error('daily.minute 0-59');
    return { id, kind: 'daily', label, hour, minute, channelIds, enabled };
  }
  if (obj.kind === 'reset_reminder') {
    const metric = String(obj.metric ?? '');
    const minutesBefore = Number(obj.minutesBefore);
    const remainingPctAbove = Number(obj.remainingPctAbove);
    const allowedReset = ['claude_5h', 'claude_weekly', 'codex_5h', 'codex_weekly'] as const;
    if (!allowedReset.includes(metric as (typeof allowedReset)[number])) throw new Error('reset_reminder.metric invalid');
    if (!Number.isFinite(minutesBefore) || minutesBefore <= 0 || minutesBefore > 14 * 24 * 60) throw new Error('reset_reminder.minutesBefore 1-20160');
    if (!Number.isFinite(remainingPctAbove) || remainingPctAbove < 0 || remainingPctAbove > 100) throw new Error('reset_reminder.remainingPctAbove 0-100');
    return { id, kind: 'reset_reminder', label, metric: metric as (typeof allowedReset)[number], minutesBefore, remainingPctAbove, channelIds, enabled };
  }
  if (obj.kind === 'budget') {
    const period = String(obj.period ?? '');
    const amountUsd = Number(obj.amountUsd);
    const allowedPeriods = ['today', '7d', 'month'] as const;
    if (!allowedPeriods.includes(period as (typeof allowedPeriods)[number])) throw new Error('budget.period invalid');
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('budget.amountUsd must be > 0');
    return { id, kind: 'budget', label, period: period as (typeof allowedPeriods)[number], amountUsd, channelIds, enabled };
  }
  throw new Error(`Unknown rule.kind: ${String(obj.kind)}`);
}

function mergeWebhooks(incoming: AlertChannel[], existing: AlertChannel[]): AlertChannel[] {
  const byId = new Map(existing.map((c) => [c.id, c.webhook] as const));
  return incoming.map((c) => {
    const prev = byId.get(c.id);
    const webhook = c.webhook === WEBHOOK_UNCHANGED_SENTINEL && prev != null ? prev : c.webhook;
    return { ...c, webhook };
  });
}

export async function GET() {
  try {
    const config = readAlertConfig();
    return NextResponse.json({
      config: maskConfig(config),
      state: readAlertState(),
      configPath: alertsConfigPath(),
      hasAnyChannel: config.channels.length > 0,
    });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { config?: AlertConfig } | null;
    if (!body?.config) return errorResponse(new Error('config required'));

    const channels = (body.config.channels ?? []).map(validateChannel);
    const rules = (body.config.rules ?? []).map(validateRule);
    const pushLocale: PushLocale = body.config.pushLocale === 'en' ? 'en' : 'zh';

    const existing = readAlertConfig();
    const merged: AlertConfig = {
      channels: mergeWebhooks(channels, existing.channels),
      rules,
      pushLocale,
    };
    writeAlertConfig(merged);
    return NextResponse.json({ config: maskConfig(merged) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string; channelId?: string };

    if (body.action === 'test') {
      if (!body.channelId) return errorResponse(new Error('channelId required'));
      const config = readAlertConfig();
      const channel = config.channels.find((c) => c.id === body.channelId);
      if (!channel) return errorResponse(new Error('channel not found'), 404);
      const msg = formatTestMessage(config.pushLocale);
      const result = await dispatch(channel, msg.title, msg.body);
      return NextResponse.json({ result });
    }

    if (body.action === 'send-now') {
      if (!body.channelId) return errorResponse(new Error('channelId required'));
      const config = readAlertConfig();
      const channel = config.channels.find((c) => c.id === body.channelId);
      if (!channel) return errorResponse(new Error('channel not found'), 404);
      const stats = await getFloatStats();
      const msg = formatDailySummary(stats, config.pushLocale);
      const result = await dispatch(channel, msg.title, msg.body);
      return NextResponse.json({ result });
    }

    if (body.action === 'run-now') {
      const report = await runAlertsOnce();
      return NextResponse.json({ report });
    }

    return errorResponse(new Error('Unsupported action'));
  } catch (error) {
    return errorResponse(error);
  }
}

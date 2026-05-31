'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_ANNOUNCEMENT_PREFS,
  readAnnouncementPrefs,
  writeAnnouncementPrefs,
  type AnnouncementPrefs,
} from '@/lib/announcements';

// Mirror server types loosely so the panel can import without dragging in
// node-only modules. Webhooks come back masked from GET and are sent back
// as the sentinel on save if the user hasn't edited the field.
const WEBHOOK_UNCHANGED_SENTINEL = '__VIBEMETER_WEBHOOK_UNCHANGED__';

type ChannelType = 'wxwork' | 'generic';
type AlertMetric = 'claude_5h_remaining_pct' | 'claude_weekly_remaining_pct' | 'codex_5h_remaining_pct' | 'codex_weekly_remaining_pct';
type ResetMetric = 'claude_5h' | 'claude_weekly' | 'codex_5h' | 'codex_weekly';

interface Channel {
  id: string;
  type: ChannelType;
  label: string;
  webhook: string;
  headers?: Record<string, string>;
}

type Rule =
  | { id: string; kind: 'threshold'; label?: string; metric: AlertMetric; below: number; channelIds: string[]; enabled: boolean }
  | { id: string; kind: 'daily'; label?: string; hour: number; minute: number; channelIds: string[]; enabled: boolean }
  | { id: string; kind: 'reset_reminder'; label?: string; metric: ResetMetric; minutesBefore: number; remainingPctAbove: number; channelIds: string[]; enabled: boolean }
  | { id: string; kind: 'vendor_event'; label?: string; metric: ResetMetric; minUsedPctBefore: number; maxUsedPctAfter: number; channelIds: string[]; enabled: boolean };

type PushLocale = 'zh' | 'en';
interface Config { channels: Channel[]; rules: Rule[]; pushLocale?: PushLocale }

const METRIC_KEYS: AlertMetric[] = ['claude_5h_remaining_pct', 'claude_weekly_remaining_pct', 'codex_5h_remaining_pct', 'codex_weekly_remaining_pct'];
const RESET_METRIC_KEYS: ResetMetric[] = ['claude_5h', 'claude_weekly', 'codex_5h', 'codex_weekly'];

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return (crypto as Crypto).randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function newChannel(type: ChannelType, defaultLabel: string): Channel {
  return {
    id: newId(),
    type,
    label: defaultLabel,
    webhook: '',
    headers: type === 'generic' ? {} : undefined,
  };
}

function newRule(kind: Rule['kind'], firstChannelId: string | null): Rule {
  const channelIds = firstChannelId ? [firstChannelId] : [];
  if (kind === 'threshold') {
    return { id: newId(), kind, metric: 'claude_5h_remaining_pct', below: 20, channelIds, enabled: true };
  }
  if (kind === 'daily') {
    return { id: newId(), kind, hour: 9, minute: 0, channelIds, enabled: true };
  }
  if (kind === 'vendor_event') {
    return { id: newId(), kind, metric: 'claude_weekly', minUsedPctBefore: 5, maxUsedPctAfter: 1, channelIds, enabled: true };
  }
  return { id: newId(), kind: 'reset_reminder', metric: 'claude_5h', minutesBefore: 60, remainingPctAbove: 50, channelIds, enabled: true };
}

interface Props {
  initialConfig: Config;
  initialConfigPath: string;
}

export function SettingsAlertsPanel({ initialConfig, initialConfigPath }: Props) {
  const t = useT();
  const [config, setConfig] = useState<Config>(initialConfig);
  const [dirtyWebhooks, setDirtyWebhooks] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configPath] = useState<string>(initialConfigPath);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/alerts');
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'load failed');
      setConfig({ channels: payload.config.channels ?? [], rules: payload.config.rules ?? [] });
      setDirtyWebhooks({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    }
  }, []);

  function updateChannel(id: string, patch: Partial<Channel>) {
    setConfig((c) => ({ ...c, channels: c.channels.map((ch) => (ch.id === id ? { ...ch, ...patch } : ch)) }));
  }
  function removeChannel(id: string) {
    setConfig((c) => ({
      channels: c.channels.filter((ch) => ch.id !== id),
      rules: c.rules.map((r) => ({ ...r, channelIds: r.channelIds.filter((cid) => cid !== id) })),
    }));
  }
  function addChannel(type: ChannelType) {
    const ch = newChannel(type, type === 'wxwork' ? t('alerts.defaultLabelWxwork') : t('alerts.defaultLabelGeneric'));
    setConfig((c) => ({ ...c, channels: [...c.channels, ch] }));
    setDirtyWebhooks((d) => ({ ...d, [ch.id]: true }));
  }

  function updateRule(id: string, patch: Partial<Rule>) {
    setConfig((c) => ({
      ...c,
      rules: c.rules.map((r) => (r.id === id ? ({ ...r, ...patch } as Rule) : r)),
    }));
  }
  function removeRule(id: string) {
    setConfig((c) => ({ ...c, rules: c.rules.filter((r) => r.id !== id) }));
  }
  function addRule(kind: Rule['kind']) {
    setConfig((c) => ({ ...c, rules: [...c.rules, newRule(kind, c.channels[0]?.id ?? null)] }));
  }

  async function save() {
    setPending('save');
    setMessage(null);
    setError(null);
    try {
      const payload: Config = {
        ...config,
        channels: config.channels.map((c) => ({
          ...c,
          webhook: dirtyWebhooks[c.id] ? c.webhook : WEBHOOK_UNCHANGED_SENTINEL,
        })),
      };
      const res = await fetch('/api/settings/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'save failed');
      setMessage(t('alerts.savedHint'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setPending(null);
    }
  }

  async function runChannelAction(action: 'test' | 'send-now', channelId: string) {
    setPending(`${action}:${channelId}`);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/settings/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, channelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'request failed');
      if (data.result?.success) {
        const key = action === 'test' ? 'alerts.testSuccess' : 'alerts.summarySuccess';
        setMessage(t(key, { channel: data.result.channel, attempts: data.result.attempts ?? 1 }));
      } else {
        setError(t('alerts.pushFail', { message: data.result?.message ?? t('alerts.pushFailUnknown') }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setPending(null);
    }
  }

  async function runAllRulesNow() {
    setPending('run-now');
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/settings/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-now' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'run failed');
      const fired = data.report?.fired ?? [];
      setMessage(t('alerts.evalDone', { fired: fired.length, evaluated: data.report?.evaluated ?? 0 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'run failed');
    } finally {
      setPending(null);
    }
  }

  const channelOptions = useMemo(() => config.channels.map((c) => ({ id: c.id, label: `${c.label} · ${c.type}` })), [config.channels]);

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{t('alerts.title')}</h2>
          <p className="text-zinc-500 text-xs mt-1">
            {t('alerts.subtitle', { path: configPath, warn: '' })}
            <strong className="text-amber-300">{t('alerts.subtitleWarn')}</strong>
          </p>
        </div>
      </div>

      {/* Channels */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">{t('alerts.sectionChannels')}</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => addChannel('wxwork')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addChannelWxwork')}
            </button>
            <button type="button" onClick={() => addChannel('generic')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addChannelGeneric')}
            </button>
          </div>
        </div>
        {config.channels.length === 0 ? (
          <p className="text-xs text-zinc-600 italic py-2">{t('alerts.noChannels')}</p>
        ) : (
          <div className="space-y-3">
            {config.channels.map((ch) => (
              <div key={ch.id} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">{ch.type}</span>
                    <input
                      type="text"
                      value={ch.label}
                      onChange={(e) => updateChannel(ch.id, { label: e.target.value })}
                      className="bg-transparent text-xs text-zinc-100 outline-none border-b border-transparent hover:border-zinc-700 focus:border-violet-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => runChannelAction('test', ch.id)}
                      disabled={pending !== null || dirtyWebhooks[ch.id]}
                      title={dirtyWebhooks[ch.id] ? t('alerts.editFirst') : ''}
                      className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                    >
                      {pending === `test:${ch.id}` ? t('alerts.testing') : t('alerts.testBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => runChannelAction('send-now', ch.id)}
                      disabled={pending !== null || dirtyWebhooks[ch.id]}
                      className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
                    >
                      {pending === `send-now:${ch.id}` ? t('alerts.sending') : t('alerts.sendNow')}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeChannel(ch.id)}
                      className="rounded border border-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:border-red-700"
                    >
                      {t('alerts.delete')}
                    </button>
                  </div>
                </div>
                <label className="block text-[11px] text-zinc-500 mb-1">
                  {t('alerts.webhookLabel')}{' '}
                  {ch.type === 'wxwork' && <span className="text-zinc-600">{t('alerts.webhookHintWxwork')}</span>}
                </label>
                <input
                  type="text"
                  value={ch.webhook}
                  onFocus={() => {
                    if (!dirtyWebhooks[ch.id]) {
                      updateChannel(ch.id, { webhook: '' });
                      setDirtyWebhooks((d) => ({ ...d, [ch.id]: true }));
                    }
                  }}
                  onChange={(e) => updateChannel(ch.id, { webhook: e.target.value })}
                  placeholder={dirtyWebhooks[ch.id] ? t('alerts.webhookPlaceholderEdit') : t('alerts.webhookPlaceholderClick')}
                  className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 font-mono outline-none focus:border-violet-500"
                />
                {!dirtyWebhooks[ch.id] && ch.webhook && (
                  <p className="mt-1 text-[10px] text-zinc-600">{t('alerts.webhookStored')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rules */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-zinc-500">{t('alerts.sectionRules')}</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => addRule('threshold')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addRuleThreshold')}
            </button>
            <button type="button" onClick={() => addRule('daily')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addRuleDaily')}
            </button>
            <button type="button" onClick={() => addRule('reset_reminder')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addRuleReset')}
            </button>
            <button type="button" onClick={() => addRule('vendor_event')} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500">
              {t('alerts.addRuleVendor')}
            </button>
          </div>
        </div>
        {config.rules.length === 0 ? (
          <p className="text-xs text-zinc-600 italic py-2">{t('alerts.noRules')}</p>
        ) : (
          <div className="space-y-3">
            {config.rules.map((r) => (
              <RuleRow
                key={r.id}
                rule={r}
                channelOptions={channelOptions}
                onChange={(patch) => updateRule(r.id, patch)}
                onDelete={() => removeRule(r.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* Announcement fan-out preferences */}
      <AnnouncementPrefsSection hasAnyChannel={config.channels.length > 0} />

      {/* Push language */}
      <div className="mb-4 flex items-center gap-3 text-xs">
        <span className="text-zinc-500">{t('alerts.pushLocale')}</span>
        <select
          value={config.pushLocale ?? 'zh'}
          onChange={(e) => setConfig((c) => ({ ...c, pushLocale: (e.target.value === 'en' ? 'en' : 'zh') as PushLocale }))}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
        >
          <option value="zh">{t('alerts.pushLocaleZh')}</option>
          <option value="en">{t('alerts.pushLocaleEn')}</option>
        </select>
        <span className="text-zinc-600 text-[10px]">{t('alerts.pushLocaleHint')}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-800">
        <button
          type="button"
          onClick={save}
          disabled={pending !== null}
          className="rounded-md bg-violet-600 px-3 py-2 text-xs text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending === 'save' ? t('alerts.saving') : t('alerts.saveBtn')}
        </button>
        <button
          type="button"
          onClick={runAllRulesNow}
          disabled={pending !== null}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
        >
          {pending === 'run-now' ? t('alerts.evaluating') : t('alerts.runAllNow')}
        </button>
      </div>

      {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </section>
  );
}

function RuleRow({
  rule,
  channelOptions,
  onChange,
  onDelete,
  t,
}: {
  rule: Rule;
  channelOptions: { id: string; label: string }[];
  onChange: (patch: Partial<Rule>) => void;
  onDelete: () => void;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const kindLabel = rule.kind === 'threshold'
    ? t('alerts.kindThreshold')
    : rule.kind === 'daily'
      ? t('alerts.kindDaily')
      : rule.kind === 'vendor_event'
        ? t('alerts.kindVendor')
        : t('alerts.kindReset');

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">{kindLabel}</span>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="h-3.5 w-3.5 accent-violet-500"
            />
            <span>{t('alerts.enabled')}</span>
          </label>
        </div>
        <button type="button" onClick={onDelete} className="rounded border border-red-900/50 px-2 py-1 text-[11px] text-red-300 hover:border-red-700">
          {t('alerts.delete')}
        </button>
      </div>

      {rule.kind === 'threshold' && (
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.metric')}</span>
            <select
              value={rule.metric}
              onChange={(e) => onChange({ metric: e.target.value as AlertMetric })}
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            >
              {METRIC_KEYS.map((v) => (
                <option key={v} value={v}>{t(`alerts.metric.${v}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.below')}</span>
            <input
              type="number" min={1} max={100} value={rule.below}
              onChange={(e) => onChange({ below: Number(e.target.value) })}
              className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            />
            <span className="text-zinc-500">%</span>
          </label>
        </div>
      )}

      {rule.kind === 'daily' && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500 w-16 shrink-0">{t('alerts.pushTime')}</span>
          <input
            type="number" min={0} max={23} value={rule.hour}
            onChange={(e) => onChange({ hour: Number(e.target.value) })}
            className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
          />
          <span className="text-zinc-500">:</span>
          <input
            type="number" min={0} max={59} value={rule.minute}
            onChange={(e) => onChange({ minute: Number(e.target.value) })}
            className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
          />
          <span className="text-zinc-600 text-[10px] ml-2">{t('alerts.pushTimeHint')}</span>
        </div>
      )}

      {rule.kind === 'vendor_event' && (
        <div className="grid sm:grid-cols-3 gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.window')}</span>
            <select
              value={rule.metric}
              onChange={(e) => onChange({ metric: e.target.value as ResetMetric })}
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            >
              {RESET_METRIC_KEYS.map((v) => (
                <option key={v} value={v}>{t(`alerts.resetMetric.${v}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-20 shrink-0">{t('alerts.vendorMinBefore')}</span>
            <input
              type="number" min={0} max={100} value={rule.minUsedPctBefore}
              onChange={(e) => onChange({ minUsedPctBefore: Number(e.target.value) })}
              className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            />
            <span className="text-zinc-500">%</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-20 shrink-0">{t('alerts.vendorMaxAfter')}</span>
            <input
              type="number" min={0} max={100} value={rule.maxUsedPctAfter}
              onChange={(e) => onChange({ maxUsedPctAfter: Number(e.target.value) })}
              className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            />
            <span className="text-zinc-500">%</span>
          </label>
        </div>
      )}

      {rule.kind === 'reset_reminder' && (
        <div className="grid sm:grid-cols-3 gap-2 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.window')}</span>
            <select
              value={rule.metric}
              onChange={(e) => onChange({ metric: e.target.value as ResetMetric })}
              className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            >
              {RESET_METRIC_KEYS.map((v) => (
                <option key={v} value={v}>{t(`alerts.resetMetric.${v}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.minutesBefore')}</span>
            <input
              type="number" min={1} max={20160} value={rule.minutesBefore}
              onChange={(e) => onChange({ minutesBefore: Number(e.target.value) })}
              className="w-24 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            />
            <span className="text-zinc-500 text-[10px]">{t('alerts.minutesBeforeHint')}</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{t('alerts.remainingAbove')}</span>
            <input
              type="number" min={0} max={100} value={rule.remainingPctAbove}
              onChange={(e) => onChange({ remainingPctAbove: Number(e.target.value) })}
              className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-violet-500"
            />
            <span className="text-zinc-500 text-[10px]">{t('alerts.remainingAboveHint')}</span>
          </label>
        </div>
      )}

      <div className="mt-2 text-xs">
        <p className="text-zinc-500 mb-1">{t('alerts.pushTo')}</p>
        {channelOptions.length === 0 ? (
          <p className="text-zinc-600 italic">{t('alerts.addChannelFirst')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {channelOptions.map((c) => {
              const on = rule.channelIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    const next = on ? rule.channelIds.filter((id) => id !== c.id) : [...rule.channelIds, c.id];
                    onChange({ channelIds: next });
                  }}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    on
                      ? 'border-violet-500/60 bg-violet-500/10 text-violet-100'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Announcement fan-out preferences ────────────────────────────────────────
// Routes curated upstream items (Claude outage, Codex reset, etc.) to system
// notifications + webhook channels. The toggles below decide *what* fires; the
// channels themselves come from the same Channels list above (so this section
// "just works" once the user has wired up at least one channel).

type NotificationPermissionState = 'unsupported' | 'default' | 'granted' | 'denied';

function readNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  return window.Notification.permission as NotificationPermissionState;
}

function AnnouncementPrefsSection({ hasAnyChannel }: { hasAnyChannel: boolean }) {
  const t = useT();
  const [prefs, setPrefs] = useState<AnnouncementPrefs>(DEFAULT_ANNOUNCEMENT_PREFS);
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');
  // Hydrate once on mount — both localStorage and Notification.permission are
  // browser-only, so the SSR pass renders with defaults and we sync up here.
  useEffect(() => {
    // Hydration sync — both reads are browser-only (localStorage, Notification).
    /* eslint-disable react-hooks/set-state-in-effect */
    setPrefs(readAnnouncementPrefs());
    setPermission(readNotificationPermission());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const update = (patch: Partial<AnnouncementPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeAnnouncementPrefs(next);
  };

  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
    } catch {
      // Browser denied programmatic prompt — leave the badge alone.
    }
  };

  return (
    <div className="mb-6 mt-2 rounded border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-100">{t('ann.prefs.title')}</h3>
      </div>
      <p className="mb-3 text-[11px] text-zinc-500">{t('ann.prefs.subtitle')}</p>

      <div className="space-y-2 text-xs text-zinc-300">
        <PrefRow
          label={t('ann.prefs.urgentSystem')}
          hint={t('ann.prefs.urgentLocked')}
          checked
          locked
          onChange={() => { /* locked */ }}
        />
        <PrefRow
          label={t('ann.prefs.urgentWebhook')}
          checked={prefs.urgentWebhook}
          onChange={(v) => update({ urgentWebhook: v })}
        />
        <PrefRow
          label={t('ann.prefs.warnSystem')}
          checked={prefs.warnSystem}
          onChange={(v) => update({ warnSystem: v })}
        />
        <PrefRow
          label={t('ann.prefs.warnWebhook')}
          checked={prefs.warnWebhook}
          onChange={(v) => update({ warnWebhook: v })}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/70 pt-3 text-[11px] text-zinc-500">
        <span>
          {t('ann.prefs.permissionLabel')}:{' '}
          {permission === 'granted' && (
            <span className="text-emerald-400">{t('ann.prefs.permissionGranted')}</span>
          )}
          {permission === 'denied' && (
            <span className="text-amber-300">{t('ann.prefs.permissionDenied')}</span>
          )}
          {permission === 'default' && (
            <span className="text-zinc-400">{t('ann.prefs.permissionDefault')}</span>
          )}
          {permission === 'unsupported' && (
            <span className="text-zinc-600">{t('ann.prefs.permissionUnsupported')}</span>
          )}
        </span>
        {permission === 'default' && (
          <button
            type="button"
            onClick={requestPermission}
            className="rounded border border-violet-500/50 bg-violet-500/10 px-2 py-1 text-[11px] text-violet-100 transition-colors hover:border-violet-400 hover:bg-violet-500/20"
          >
            {t('ann.prefs.enableSystem')}
          </button>
        )}
      </div>

      {!hasAnyChannel && (
        <p className="mt-2 text-[11px] text-amber-300/90">
          {t('ann.prefs.noChannelHint')}
        </p>
      )}
    </div>
  );
}

function PrefRow({
  label,
  hint,
  checked,
  onChange,
  locked,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  locked?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
      />
      <span className="flex-1">
        {label}
        {hint && <span className="ml-2 text-[10px] text-zinc-600">{hint}</span>}
      </span>
    </label>
  );
}

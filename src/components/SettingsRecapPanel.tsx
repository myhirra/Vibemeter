'use client';

import { useState } from 'react';
import type { RecapSettings, RecapSubscriptionPlan } from '@/lib/recap-settings';
import { useLocale } from '@/lib/i18n/client';

const PLAN_OPTIONS: Array<{ value: RecapSubscriptionPlan; label: string }> = [
  { value: 'unset', label: 'Not set' },
  { value: 'api', label: 'Pay-as-you-go API' },
  { value: 'pro', label: 'Pro · $20/mo' },
  { value: 'max5x', label: 'Max 5x · $100/mo' },
  { value: 'max20x', label: 'Max 20x · $200/mo' },
  { value: 'custom', label: 'Custom monthly price' },
];

export function SettingsRecapPanel({ initialSettings }: { initialSettings: RecapSettings }) {
  const locale = useLocale();
  const [settings, setSettings] = useState<RecapSettings>(initialSettings);
  const [customText, setCustomText] = useState(initialSettings.customMonthlyUsd?.toString() ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const copy = locale === 'zh'
    ? {
        title: '分享卡片',
        subtitle: '订阅价格只保存在本机，用于计算 recap 的 ROI。',
        plan: '订阅计划',
        custom: '每月价格',
        native: '窗口重置后显示 macOS 提醒',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        error: '保存失败',
      }
    : {
        title: 'Share card',
        subtitle: 'Subscription price stays local and only powers recap ROI.',
        plan: 'Plan',
        custom: 'Monthly price',
        native: 'Show macOS recap nudge after a reset',
        save: 'Save',
        saving: 'Saving...',
        saved: 'Saved',
        error: 'Save failed',
      };

  function nextSettings(): RecapSettings {
    const customMonthlyUsd = Number(customText);
    return {
      ...settings,
      customMonthlyUsd: Number.isFinite(customMonthlyUsd) && customMonthlyUsd > 0
        ? Math.round(customMonthlyUsd * 100) / 100
        : null,
    };
  }

  async function save() {
    setState('saving');
    try {
      const payload = nextSettings();
      const response = await fetch('/api/settings/recap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'save failed');
      setSettings(data.settings);
      setState('saved');
      window.setTimeout(() => setState('idle'), 1400);
    } catch {
      setState('error');
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{copy.title}</h2>
          <p className="mt-1 text-xs text-zinc-500">{copy.subtitle}</p>
        </div>
        {state === 'saved' && <span className="text-xs text-emerald-300">{copy.saved}</span>}
        {state === 'error' && <span className="text-xs text-rose-300">{copy.error}</span>}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_160px]">
        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{copy.plan}</span>
          <select
            value={settings.subscriptionPlan}
            onChange={(event) => setSettings((current) => ({ ...current, subscriptionPlan: event.target.value as RecapSubscriptionPlan }))}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors hover:border-zinc-500 focus:border-violet-500"
          >
            {PLAN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{copy.custom}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            disabled={settings.subscriptionPlan !== 'custom'}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-500 focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="20"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={settings.nativeNudgeEnabled}
            onChange={(event) => setSettings((current) => ({ ...current, nativeNudgeEnabled: event.target.checked }))}
            className="size-4 accent-violet-500"
          />
          <span>{copy.native}</span>
        </label>
        <button
          type="button"
          onClick={save}
          disabled={state === 'saving'}
          className="rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-600/30 disabled:text-violet-100/70"
        >
          {state === 'saving' ? copy.saving : copy.save}
        </button>
      </div>
    </section>
  );
}

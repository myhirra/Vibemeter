'use client';

import { startTransition, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';

const STORAGE_KEY = 'vibemeter:feature-vote';
const OTHER_ID = 'other';
const CUSTOM_MAX_LENGTH = 80;

const OPTIONS = [
  { id: 'gemini',       labelEn: 'Gemini CLI support',     labelZh: 'Gemini CLI 接入' },
  { id: 'aider',        labelEn: 'Aider support',          labelZh: 'Aider 接入' },
  { id: 'windows',      labelEn: 'Windows widget',         labelZh: 'Windows 浮窗' },
  { id: 'linux',        labelEn: 'Linux widget',           labelZh: 'Linux 浮窗' },
  { id: 'per-project',  labelEn: 'Per-project budget',     labelZh: '按项目预算' },
  { id: 'pricing',      labelEn: 'Pricing-change alerts',  labelZh: '定价变动提醒' },
  { id: 'team-sync',    labelEn: 'Team sync (opt-in)',     labelZh: '团队同步（可选）' },
  { id: 'ide',          labelEn: 'IDE status-bar plugin',  labelZh: 'IDE 状态栏插件' },
];

type StoredVote = { id: string; at: number; custom?: string };

export function FeatureVoteCard() {
  const locale = useLocale();
  const t = useT();
  const [vote, setVote] = useState<StoredVote | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) startTransition(() => setVote(JSON.parse(raw)));
    } catch { /* localStorage unavailable */ }
  }, []);

  function submit() {
    const custom = customText.trim();
    if (!selected || (selected === OTHER_ID && !custom)) return;
    const next: StoredVote = selected === OTHER_ID
      ? { id: OTHER_ID, custom, at: Date.now() }
      : { id: selected, at: Date.now() };
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setVote(next);
  }

  function copy() {
    if (!vote) return;
    const payload = JSON.stringify(vote);
    navigator.clipboard?.writeText(payload).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  if (dismissed) return null;

  const localeEn = locale === 'en';
  const custom = customText.trim();
  const canSubmit = Boolean(selected && (selected !== OTHER_ID || custom));
  const voteLabel = vote
    ? vote.id === OTHER_ID
      ? vote.custom ? `${t('vote.other')}: ${vote.custom}` : t('vote.other')
      : OPTIONS.find((o) => o.id === vote.id)?.[localeEn ? 'labelEn' : 'labelZh'] ?? vote.id
    : '';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-zinc-500 uppercase tracking-wider">{t('vote.title')}</p>
        {!vote && (
          <button type="button" onClick={() => setDismissed(true)} className="text-[10px] text-zinc-600 hover:text-zinc-400">
            {t('vote.dismiss')}
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-zinc-600">{t('vote.sub')}</p>

      {vote ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-emerald-300">{t('vote.thanks')}</p>
          <p className="text-xs text-zinc-400">
            → {voteLabel}
          </p>
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
          >
            {copied ? '✓' : t('vote.export')}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <ul className="space-y-1.5">
            {OPTIONS.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-950">
                  <input
                    type="radio"
                    name="vibemeter-vote"
                    value={o.id}
                    checked={selected === o.id}
                    onChange={() => setSelected(o.id)}
                    className="accent-violet-400"
                  />
                  <span>{localeEn ? o.labelEn : o.labelZh}</span>
                </label>
              </li>
            ))}
            <li>
              <div className="rounded-md border border-transparent px-2 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:bg-zinc-950">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="vibemeter-vote"
                    value={OTHER_ID}
                    checked={selected === OTHER_ID}
                    onChange={() => setSelected(OTHER_ID)}
                    className="accent-violet-400"
                  />
                  <span>{t('vote.other')}</span>
                </label>
                {selected === OTHER_ID && (
                  <input
                    type="text"
                    value={customText}
                    onChange={(event) => setCustomText(event.target.value)}
                    maxLength={CUSTOM_MAX_LENGTH}
                    autoFocus
                    placeholder={t('vote.otherPlaceholder')}
                    className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500/60"
                  />
                )}
              </div>
            </li>
          </ul>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-2 w-full rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:opacity-50"
          >
            {t('vote.submit')}
          </button>
        </div>
      )}
    </div>
  );
}

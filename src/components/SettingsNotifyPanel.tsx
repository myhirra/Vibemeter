'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

type SoundMode = 'voice' | 'beep' | 'off';

type NotifyStatus = {
  scriptPath: string;
  scriptExists: boolean;
  claudeSettingsPath: string;
  codexConfigPath: string;
  claudeStop: boolean;
  claudeNotification: boolean;
  codex: boolean;
  codexForeign: string | null;
  codexConfigExists: boolean;
  soundMode: SoundMode;
};

interface Props {
  initialStatus: NotifyStatus;
}

export function SettingsNotifyPanel({ initialStatus }: Props) {
  const t = useT();
  const [status, setStatus] = useState<NotifyStatus>(initialStatus);
  const [includeStop, setIncludeStop] = useState(true);
  const [includeNotification, setIncludeNotification] = useState(initialStatus.claudeNotification);
  const [includeCodex, setIncludeCodex] = useState(true);
  const [soundMode, setSoundMode] = useState<SoundMode>(initialStatus.soundMode);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = status.claudeStop || status.claudeNotification || status.codex;

  async function run(action: 'install' | 'uninstall') {
    setPending(action);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/settings/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          stop: includeStop,
          notification: includeNotification,
          codex: includeCodex,
          soundMode,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Operation failed');
      setStatus(payload.status);
      if (action === 'install') {
        const r = payload.result;
        const notes: string[] = [];
        if (r.codexSkipped === 'no-config') notes.push(t('notify.skipNoCodex'));
        if (r.codexSkipped === 'foreign-notify') notes.push(t('notify.skipForeign', { cmd: r.codexForeign }));
        setMessage(notes.length ? t('notify.updated', { notes: notes.join('. ') }) : t('notify.enabledMsg'));
      } else {
        setMessage(t('notify.disabledMsg'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">{t('notify.title')}</h2>
          <p className="text-zinc-500 text-xs mt-1">
            {t('notify.subtitle', { tool: 'Claude / Codex', project: '{project}' })}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider ${
            enabled ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
          }`}
        >
          {enabled ? t('notify.on') : t('notify.off')}
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <StatusPill label={t('notify.claudeStop')} on={status.claudeStop} />
        <StatusPill label={t('notify.claudeNotification')} on={status.claudeNotification} />
        <StatusPill
          label={t('notify.codexComplete')}
          on={status.codex}
          warn={!!status.codexForeign}
          warnText={status.codexForeign ? t('notify.foreignWarn') : undefined}
        />
      </div>

      <div className="space-y-2 mb-5 text-xs text-zinc-300">
        <Toggle label={t('notify.hookStop')} checked={includeStop} onChange={setIncludeStop} />
        <Toggle label={t('notify.hookNotification')} checked={includeNotification} onChange={setIncludeNotification} />
        <Toggle
          label={t('notify.hookCodex', { state: status.codexConfigExists ? t('notify.hookCodexConfigFound') : t('notify.hookCodexConfigMissing') })}
          checked={includeCodex}
          onChange={setIncludeCodex}
          disabled={!status.codexConfigExists}
        />
      </div>

      <div className="mb-5">
        <div className="text-xs text-zinc-400 mb-2">{t('notify.soundLabel')}</div>
        <div className="inline-flex rounded-md border border-zinc-800 overflow-hidden text-xs">
          {(['voice', 'beep', 'off'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSoundMode(mode)}
              className={`px-3 py-1.5 transition-colors ${
                soundMode === mode
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t(`notify.sound.${mode}`)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-600">{t(`notify.soundHint.${soundMode}`)}</p>
      </div>

      {status.codexForeign && (
        <div className="mb-4 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          {t('notify.foreignBody')}
          <pre className="mt-1 whitespace-pre-wrap text-amber-300/80">{status.codexForeign}</pre>
          {t('notify.foreignRemove')}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => run('install')}
          disabled={pending !== null}
          className="rounded-md bg-violet-600 px-3 py-2 text-xs text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {pending === 'install' ? t('notify.installing') : enabled ? t('notify.reapply') : t('notify.enable')}
        </button>
        {enabled && (
          <button
            type="button"
            onClick={() => run('uninstall')}
            disabled={pending !== null}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-50"
          >
            {pending === 'uninstall' ? t('notify.removing') : t('notify.disable')}
          </button>
        )}
      </div>

      {!status.scriptExists && (
        <p className="mt-3 text-xs text-red-400">{t('notify.scriptMissing', { path: status.scriptPath })}</p>
      )}
      {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </section>
  );
}

function StatusPill({ label, on, warn, warnText }: { label: string; on: boolean; warn?: boolean; warnText?: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-xs">
      <span className="text-zinc-400">{label}</span>
      {warn ? (
        <span className="text-amber-400" title={warnText}>!</span>
      ) : (
        <span className={on ? 'text-emerald-400' : 'text-zinc-600'}>{on ? '✓' : '·'}</span>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-violet-500"
      />
      <span>{label}</span>
    </label>
  );
}

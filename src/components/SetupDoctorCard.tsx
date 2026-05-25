'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/client';
import type { DoctorReport, DoctorStatus } from '@/lib/doctor';

type LoadState = 'loading' | 'ready' | 'error';

const DOT_CLASS: Record<DoctorStatus, string> = {
  ready: 'bg-emerald-400',
  needs_setup: 'bg-amber-400',
  missing: 'bg-red-400',
  unknown: 'bg-zinc-500',
};

export function SetupDoctorCard() {
  const locale = useLocale();
  const localeEn = locale === 'en';
  const [state, setState] = useState<LoadState>('loading');
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);

  async function load() {
    setState('loading');
    try {
      const response = await fetch('/api/doctor', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'doctor failed');
      setDoctor(payload.doctor);
      setState('ready');
    } catch {
      setState('error');
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/doctor', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'doctor failed');
        setDoctor(payload.doctor);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  const title = localeEn ? 'First-run doctor' : '首次运行检查';
  const sub = localeEn ? 'Shows what is ready and what needs setup' : '确认哪些数据源已就绪，哪些还要配置';
  const refresh = localeEn ? 'Refresh' : '刷新';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-600">{sub}</p>
        </div>
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
        <p className="mt-4 text-sm text-zinc-500">{localeEn ? 'Checking setup...' : '正在检查...'}</p>
      )}

      {state === 'error' && (
        <p className="mt-4 text-sm text-red-300">{localeEn ? 'Doctor unavailable.' : '检查暂不可用。'}</p>
      )}

      {state === 'ready' && doctor && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-zinc-300">
            {localeEn ? `${doctor.ready}/${doctor.checks.length} ready` : `${doctor.ready}/${doctor.checks.length} 已就绪`}
          </p>
          <ul className="space-y-2">
            {doctor.checks.slice(0, 5).map((item) => (
              <li key={item.id} className="flex gap-2 text-xs">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[item.status]}`} />
                <span className="min-w-0">
                  <span className="block truncate text-zinc-300">{item.label}</span>
                  <span className="block truncate text-zinc-600">{item.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {doctor.needsAttention > 0 && (
            <p className="text-xs leading-5 text-amber-200/80">
              {localeEn ? 'Run `vibemeter doctor` for the full setup checklist.' : '运行 `vibemeter doctor` 可查看完整检查清单。'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

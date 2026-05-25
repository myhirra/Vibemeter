'use client';

import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/client';
import type { ShareReport } from '@/lib/share-report';

type LoadState = 'loading' | 'ready' | 'error';

const STATUS_CLASS: Record<string, string> = {
  safe: 'text-emerald-300',
  watch: 'text-amber-300',
  risky: 'text-orange-300',
  wait: 'text-red-300',
  unknown: 'text-zinc-400',
};

function guardCopy(status: string, localeEn: boolean) {
  if (localeEn) return null;
  switch (status) {
    case 'safe':
      return { headline: '适合启动长任务', detail: '当前额度跑道健康，可以开始较长的 Claude Code 或 Codex 任务。' };
    case 'watch':
      return { headline: '适合短中任务', detail: '建议先用边界明确的 prompt，长任务开始前再刷新一次。' };
    case 'risky':
      return { headline: '不建议长任务', detail: '短改动可以，修测试或重构循环可能会在完成前撞限。' };
    case 'wait':
      return { headline: '建议等重置', detail: '额度太紧，先处理小跟进，或等下一次 reset 后再开新任务。' };
    default:
      return { headline: '还没有额度快照', detail: '先运行一次 Claude Code 或 Codex，再刷新 Vibemeter。' };
  }
}

export function ShareReportCard() {
  const locale = useLocale();
  const localeEn = locale === 'en';
  const [state, setState] = useState<LoadState>('loading');
  const [report, setReport] = useState<ShareReport | null>(null);
  const [copied, setCopied] = useState(false);

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
    void (async () => {
      try {
        const response = await fetch('/api/report', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'report failed');
        setReport(payload.report);
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  async function copy() {
    if (!report) return;
    await navigator.clipboard?.writeText(report.markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const title = localeEn ? 'Share report' : '分享报告';
  const sub = localeEn ? 'Local Markdown for V2EX, GitHub, or team chat' : '本地生成 Markdown，可贴到 V2EX/GitHub/群里';
  const refresh = localeEn ? 'Refresh' : '刷新';
  const copyLabel = copied ? (localeEn ? 'Copied' : '已复制') : (localeEn ? 'Copy Markdown' : '复制 Markdown');

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
        <p className="mt-4 text-sm text-zinc-500">{localeEn ? 'Building report...' : '正在生成报告...'}</p>
      )}

      {state === 'error' && (
        <p className="mt-4 text-sm text-red-300">{localeEn ? 'Report unavailable.' : '报告暂不可用。'}</p>
      )}

      {state === 'ready' && report && (
        <div className="mt-4 space-y-3">
          <div>
            {(() => {
              const localized = guardCopy(report.guard.status, localeEn);
              const headline = localized?.headline ?? report.guard.headline;
              const detail = localized?.detail ?? report.guard.detail;
              return (
                <>
                  <p className={`text-sm font-semibold ${STATUS_CLASS[report.guard.status] ?? STATUS_CLASS.unknown}`}>
                    {headline}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">{detail}</p>
                </>
              );
            })()}
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <p className="text-zinc-600">{localeEn ? 'Today' : '今天'}</p>
              <p className="mt-1 text-zinc-200">{report.todaySessions}</p>
            </div>
            <div>
              <p className="text-zinc-600">{localeEn ? 'Sessions' : '会话'}</p>
              <p className="mt-1 text-zinc-200">{report.totalSessions}</p>
            </div>
            <div>
              <p className="text-zinc-600">{localeEn ? 'Streak' : '连续'}</p>
              <p className="mt-1 text-zinc-200">{report.currentStreak}d</p>
            </div>
          </div>
          <button
            type="button"
            onClick={copy}
            className="w-full rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20"
          >
            {copyLabel}
          </button>
        </div>
      )}
    </div>
  );
}

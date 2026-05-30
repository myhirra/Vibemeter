'use client';

import { useState } from 'react';
import type { CacheStats, SessionInsight } from '@/lib/stats';
import type { RecapCardData, RecapCardsByScope, RecapDateFilter, RecapPeriod, RecapToolFilter } from '@/lib/recap-card';
import { useLocale, useT } from '@/lib/i18n/client';
import { RecapShareButton } from './RecapShareButton';

function fmtTokens(n: number, locale: string): string {
  if (locale === 'zh' && n >= 1_000_000) {
    if (n >= 1_000_000_000) {
      const b = n / 1_000_000_000;
      return `${b >= 100 ? b.toFixed(0) : b.toFixed(1)}B`;
    }
    const value = n / 1_000_000;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}M`;
  }
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtCost(n: number | null) {
  if (n == null) return '--';
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

function periodKey(period: RecapPeriod) {
  return period === 'today' ? 'today' : period === '7d' ? 'week' : period === '30d' ? '30d' : period === 'all' ? 'all' : 'month';
}

const TOOL_LABEL_KEYS: Record<RecapToolFilter, string> = {
  all: 'dashboard.toolAll',
  'claude-code': 'dashboard.toolClaude',
  codex: 'dashboard.toolCodex',
  cursor: 'dashboard.toolCursor',
};

function emptyCacheSummary(card: RecapCardData): CacheStats {
  return {
    totalInput: card.cacheSummary.totalInput,
    totalCacheCreation: card.cacheSummary.totalCacheCreation,
    totalCacheRead: card.cacheSummary.totalCacheRead,
    totalOutput: card.cacheSummary.totalOutput,
    hitRatePct: card.cacheHitRatePct,
    inputTokensSaved: card.cacheSummary.inputTokensSaved,
    sessionsAnalyzed: card.cacheSessionsAnalyzed,
    topProjects: card.cacheSummary.topProjects.map((project) => ({
      project: project.project,
      sessions: project.sessions,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      hitRatePct: project.hitRatePct,
    })),
    worstSessions: [],
    hint: '',
  };
}

async function openTranscript(path: string) {
  const response = await fetch('/api/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export function UsageTotalCard({
  insight,
  recapCards,
  period,
  toolFilter,
  redact = false,
}: {
  insight: SessionInsight;
  recapCards: RecapCardsByScope;
  period: RecapDateFilter;
  toolFilter: RecapToolFilter;
  redact?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openErrorId, setOpenErrorId] = useState<string | null>(null);
  const card = recapCards[toolFilter]?.[period] ?? recapCards.all[period];
  const cache = emptyCacheSummary(card);
  const tokenTotals = card.totalTokens;
  const claudeTokens = tokenTotals.input + tokenTotals.cacheCreation + tokenTotals.cacheRead + tokenTotals.output;
  const codexTokens = tokenTotals.codex;
  const splitTotal = Math.max(claudeTokens + codexTokens, 1);
  const claudePct = Math.round((claudeTokens / splitTotal) * 100);
  const codexPct = Math.max(0, 100 - claudePct);
  const incoming = Math.max(cache.totalInput + cache.totalCacheCreation + cache.totalCacheRead, 1);
  const cacheReadPct = Math.round((cache.totalCacheRead / incoming) * 100);
  const cacheWritePct = Math.round((cache.totalCacheCreation / incoming) * 100);
  const inputPct = Math.max(0, 100 - cacheReadPct - cacheWritePct);
  const topChats = insight.topExpensive.slice(0, 3);

  async function handleOpen(id: string, path: string) {
    setOpeningId(id);
    setOpenErrorId(null);
    try {
      await openTranscript(path);
    } catch {
      setOpenErrorId(id);
    } finally {
      window.setTimeout(() => setOpeningId(null), 500);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-zinc-500">{t('card.total.title')}</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            {t('card.total.subtitle', {
              period: t(`recap.period.${periodKey(period)}`),
              agent: t(TOOL_LABEL_KEYS[toolFilter]),
            })}
          </p>
        </div>
        <RecapShareButton
          card={card}
          period={period}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t('card.total.tokens')}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-zinc-100">{fmtTokens(tokenTotals.total, locale)}</p>
          <p className="mt-1 text-[11px] text-zinc-600">{t('card.total.tokensHint')}</p>
        </div>
        <div className="rounded-md border border-violet-800/50 bg-violet-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-violet-300/70">{t('card.total.value')}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-violet-200">${card.valueAtApiRatesUsd.toFixed(2)}</p>
          <p className="mt-1 text-[11px] text-violet-200/50">
            {t(
              toolFilter === 'claude-code'
                ? 'card.total.valueHint.claude'
                : toolFilter === 'codex'
                  ? 'card.total.valueHint.codex'
                  : 'card.total.valueHint',
            )}
          </p>
          {/* "Months of a $200/mo plan" reference so the dollar value always
              has a sense of scale. $200 maps to Claude Max on the Claude/all
              tabs and to ChatGPT Pro on the Codex tab — same divisor, but a
              vendor-correct label. Hidden only when it rounds to <0.1 months. */}
          {(() => {
            const planPriceUsd = 200;
            const planLabel = toolFilter === 'codex' ? 'Pro $200' : 'Max $200';
            const months = Math.round((card.valueAtApiRatesUsd / planPriceUsd) * 10) / 10;
            if (months < 0.1) return null;
            return (
              <p className="mt-0.5 text-[11px] text-violet-200/40">
                {t('card.total.valuePlan', { n: months, plan: planLabel })}
              </p>
            );
          })()}
        </div>
        <div className="rounded-md border border-emerald-800/50 bg-emerald-950/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-emerald-300/70">{t('card.total.cacheHit')}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-emerald-300">{card.cacheHitRatePct}%</p>
          <p className="mt-1 text-[11px] text-emerald-200/50">
            {t('card.total.cacheHint', { n: card.cacheSessionsAnalyzed })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
        <section className="flex h-full min-h-52 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-zinc-300">{t('card.total.breakdown')}</p>
            <p className="text-[11px] text-zinc-600">{t('card.total.periodTotal')}</p>
          </div>

          <div className="mb-3 h-3 overflow-hidden rounded-full bg-zinc-800">
            <div className="flex h-full">
              <div className="bg-violet-500" style={{ width: `${claudePct}%` }} />
              <div className="bg-emerald-500" style={{ width: `${codexPct}%` }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t('card.total.claudeTokens')}</p>
              <p className="mt-1 font-semibold tabular-nums text-violet-200">{fmtTokens(claudeTokens, locale)}</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">{t('card.total.codexTokens')}</p>
              <p className="mt-1 font-semibold tabular-nums text-emerald-200">{fmtTokens(codexTokens, locale)}</p>
            </div>
          </div>

          <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-800">
            <div className="flex h-full">
              <div className="bg-emerald-500" style={{ width: `${cacheReadPct}%` }} title={t('card.cache.legendRead')} />
              <div className="bg-amber-500" style={{ width: `${cacheWritePct}%` }} title={t('card.cache.legendCreate')} />
              <div className="bg-zinc-500" style={{ width: `${inputPct}%` }} title={t('card.cache.legendInput')} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500">
            <span><span className="mr-1 inline-block size-2 rounded-sm bg-emerald-500/80" />{t('card.cache.legendRead')} {fmtTokens(cache.totalCacheRead, locale)}</span>
            <span><span className="mr-1 inline-block size-2 rounded-sm bg-amber-500/70" />{t('card.cache.legendCreate')} {fmtTokens(cache.totalCacheCreation, locale)}</span>
            <span><span className="mr-1 inline-block size-2 rounded-sm bg-zinc-600" />{t('card.cache.legendInput')} {fmtTokens(cache.totalInput, locale)}</span>
          </div>

          <p className="mt-auto pt-3 text-[11px] text-zinc-600">
            {t('card.total.saved', { tokens: fmtTokens(cache.inputTokensSaved, locale) })}
          </p>
        </section>

        <section className="flex h-full min-h-52 flex-col rounded-md border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-zinc-300">{t('card.total.topChats')}</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                {t('card.total.retry', {
                  pct: insight.retryRate7d.pct,
                  retried: insight.retryRate7d.retriedSessions,
                  total: insight.retryRate7d.totalSessions,
                })}
              </p>
            </div>
            {card.roiMultiplier != null && (
              <p className="shrink-0 rounded-full border border-emerald-700/40 bg-emerald-950/40 px-2 py-1 text-[11px] font-semibold text-emerald-200">
                {t('card.total.roi', { x: card.roiMultiplier })}
              </p>
            )}
          </div>

          {topChats.length === 0 ? (
            <p className="text-xs text-zinc-600">{t('card.total.noTopChats')}</p>
          ) : (
            <ul className="space-y-2">
              {topChats.map((session) => (
                <li key={session.id} className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-zinc-200">{session.aiTitle ?? session.project}</p>
                    <p className="mt-0.5 truncate text-[10px] text-zinc-600">{session.project}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums text-emerald-300">{fmtCost(session.costUsd)}</span>
                    {redact ? (
                      <button
                        type="button"
                        disabled
                        title={t('redact.transcriptHidden')}
                        className="cursor-not-allowed rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-600"
                      >
                        {t('card.total.openTranscript')}
                      </button>
                    ) : (
                      session.transcriptPath && (
                        <button
                          type="button"
                          onClick={() => handleOpen(session.id, session.transcriptPath!)}
                          disabled={openingId === session.id}
                          className="rounded-md border border-violet-700/50 px-2 py-1 text-[10px] text-violet-200 transition-colors hover:border-violet-500 hover:text-violet-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          {openErrorId === session.id
                            ? t('card.total.openFailed')
                            : openingId === session.id
                              ? t('common.loading')
                              : t('card.total.openTranscript')}
                        </button>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cache.topProjects.length > 0 && (
            <div className="mt-auto pt-3">
              <p className="mb-1.5 text-[11px] text-zinc-600">{t('card.cache.byProject')}</p>
              <div className="flex flex-wrap gap-1.5">
                {cache.topProjects.slice(0, 4).map((project) => (
                  <span key={project.project} className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400">
                    {project.project} · {project.hitRatePct}%
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

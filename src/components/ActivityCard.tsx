'use client';

import { useState, useMemo } from 'react';
import type { SessionEntry } from './SessionsTable';
import type { StreakInfo, TimelineSession } from '@/lib/stats';
import { useT } from '@/lib/i18n/client';

const DOW_KEYS = ['card.activity.dayMon', 'card.activity.dayTue', 'card.activity.dayWed', 'card.activity.dayThu', 'card.activity.dayFri', 'card.activity.daySat', 'card.activity.daySun'];
const LANE_HEIGHT = 28;
const LANE_GAP = 4;

interface Cell { dow: number; hour: number; minutes: number; sessions: number; }

function buildCells(sessions: SessionEntry[]): Cell[] {
  const buckets = new Map<string, { minutes: number; sessions: number }>();
  for (const s of sessions) {
    const start = s.started_at;
    const end = s.ended_at ?? Math.min(Date.now(), s.started_at + 60 * 60_000);
    let cur = start;
    let firstSessionBucket: string | null = null;
    while (cur < end) {
      const d = new Date(cur);
      const dow = (d.getDay() + 6) % 7;
      const hour = d.getHours();
      const key = `${dow}-${hour}`;
      const nextBoundary = new Date(d);
      nextBoundary.setMinutes(0, 0, 0);
      nextBoundary.setHours(d.getHours() + 1);
      const slice = (Math.min(nextBoundary.getTime(), end) - cur) / 60_000;
      const cell = buckets.get(key) ?? { minutes: 0, sessions: 0 };
      cell.minutes += slice;
      if (firstSessionBucket === null) {
        cell.sessions += 1;
        firstSessionBucket = key;
      }
      buckets.set(key, cell);
      cur = nextBoundary.getTime();
    }
  }
  const out: Cell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = buckets.get(`${dow}-${hour}`) ?? { minutes: 0, sessions: 0 };
      out.push({ dow, hour, ...c });
    }
  }
  return out;
}

function intensityClass(minutes: number, max: number): string {
  if (minutes === 0) return 'bg-zinc-900';
  const t = max > 0 ? minutes / max : 0;
  if (t < 0.15) return 'bg-violet-900/40';
  if (t < 0.3)  return 'bg-violet-800/60';
  if (t < 0.5)  return 'bg-violet-700';
  if (t < 0.75) return 'bg-violet-600';
  return 'bg-violet-400';
}

function fmtMins(m: number): string {
  if (m < 60) return `${Math.round(m)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function fmtHHmm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function durMin(start: number, end: number): number {
  return Math.max(1, Math.round((end - start) / 60_000));
}

const TOOL_BG: Record<string, string> = {
  'claude-code': 'bg-violet-500/80 border-violet-400 text-violet-50',
  codex: 'bg-emerald-600/80 border-emerald-400 text-emerald-50',
  cursor: 'bg-sky-600/80 border-sky-400 text-sky-50',
  gemini: 'bg-blue-600/80 border-blue-400 text-blue-50',
  opencode: 'bg-amber-600/80 border-amber-400 text-amber-50',
  qoder: 'bg-rose-600/80 border-rose-400 text-rose-50',
};

interface Props {
  sessions: SessionEntry[];
  streak: StreakInfo;
  timeline: { dateLabel: string; sessions: TimelineSession[] };
}

export function ActivityCard({ sessions, streak, timeline }: Props) {
  const t = useT();
  const DOW = DOW_KEYS.map((k) => t(k));
  const [view, setView] = useState<'pattern' | 'today'>('pattern');
  const [hover, setHover] = useState<{ s: TimelineSession; x: number; y: number } | null>(null);

  const cells = useMemo(() => buildCells(sessions), [sessions]);
  const max = Math.max(...cells.map((c) => c.minutes), 1);
  const totalHours = cells.reduce((s, c) => s + c.minutes, 0) / 60;
  const peak = cells.reduce((best, c) => c.minutes > best.minutes ? c : best, cells[0]);

  // Today's data
  const dayStart = new Date(timeline.dateLabel + 'T00:00:00').getTime();
  const dayEnd = dayStart + 86_400_000;
  const valid = timeline.sessions
    .map((s) => ({ ...s, _start: Math.max(s.startMs, dayStart), _end: Math.min(s.endMs, dayEnd) }))
    .filter((s) => s._end > s._start)
    .sort((a, b) => a._start - b._start);
  const lanes: Array<typeof valid> = [];
  for (const s of valid) {
    let placed = false;
    for (const lane of lanes) {
      if (lane[lane.length - 1]._end <= s._start) { lane.push(s); placed = true; break; }
    }
    if (!placed) lanes.push([s]);
  }
  const laneCount = Math.max(lanes.length, 1);
  const containerHeight = laneCount * (LANE_HEIGHT + LANE_GAP) + LANE_GAP;
  const totalActiveHours = valid.reduce((sum, s) => sum + (s._end - s._start), 0) / 3_600_000;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5 relative">
      {/* Header: title + tabs + streak stats */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">{t('card.activity.title')}</p>
          <div className="flex gap-1">
            <button onClick={() => setView('pattern')}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                view === 'pattern'
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}>{t('card.activity.viewPattern')}</button>
            <button onClick={() => setView('today')}
              className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                view === 'today'
                  ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                  : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}>{t('card.activity.viewToday')}</button>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div><span className="text-base font-bold text-zinc-100 tabular-nums">{streak.current}</span><span className="text-zinc-500 ml-1">{t('card.activity.dayStreak')}</span></div>
          <div><span className="text-base font-bold text-zinc-300 tabular-nums">{streak.longest}</span><span className="text-zinc-500 ml-1">{t('card.activity.longest')}</span></div>
          <div><span className="text-base font-bold text-zinc-300 tabular-nums">{streak.totalDays}</span><span className="text-zinc-500 ml-1">{t('card.activity.activeDays')}</span></div>
          <div className="border-l border-zinc-800 pl-4">
            <span className="text-base font-bold text-violet-400 tabular-nums">{totalHours.toFixed(0)}h</span><span className="text-zinc-500 ml-1">{t('card.activity.total')}</span>
          </div>
        </div>
      </div>

      {view === 'pattern' ? (
        <>
          <p className="text-xs text-zinc-600 mb-2">
            {t('card.activity.peakSlotFmt', { day: DOW[peak.dow], hour: peak.hour.toString().padStart(2, '0'), mins: fmtMins(peak.minutes) })}
          </p>
          <div className="flex gap-1 text-xs">
            <div className="w-8 shrink-0"></div>
            <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className={`text-center text-[9px] text-zinc-600 ${h % 3 === 0 ? '' : 'opacity-40'}`}>
                  {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
                </div>
              ))}
            </div>
          </div>
          {DOW.map((day, dow) => (
            <div key={day} className="flex gap-1 mt-px">
              <div className="w-8 shrink-0 text-[10px] text-zinc-600 leading-4">{day}</div>
              <div className="flex-1 grid gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                {Array.from({ length: 24 }).map((_, hour) => {
                  const c = cells[dow * 24 + hour];
                  return (
                    <div key={hour}
                      className={`h-4 rounded-sm ${intensityClass(c.minutes, max)}`}
                      title={`${day} ${hour.toString().padStart(2, '0')}:00\n${fmtMins(c.minutes)} · ${c.sessions} sessions`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-3 text-[10px] text-zinc-600">
            <span>{t('card.activity.less')}</span>
            <span className="w-3 h-3 rounded-sm bg-zinc-900 border border-zinc-800" />
            <span className="w-3 h-3 rounded-sm bg-violet-900/40" />
            <span className="w-3 h-3 rounded-sm bg-violet-800/60" />
            <span className="w-3 h-3 rounded-sm bg-violet-700" />
            <span className="w-3 h-3 rounded-sm bg-violet-600" />
            <span className="w-3 h-3 rounded-sm bg-violet-400" />
            <span>{t('card.activity.more')}</span>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-600 mb-2">
            {t('card.activity.dayHeader', { date: timeline.dateLabel, n: valid.length, hours: totalActiveHours.toFixed(1) })}
          </p>
          {valid.length === 0 ? (
            <p className="text-zinc-600 text-sm py-4">{t('card.activity.noToday')}</p>
          ) : (
            <>
              <div className="relative h-4 mb-1">
                {Array.from({ length: 25 }).map((_, h) => (
                  <div key={h} className="absolute top-0 text-[10px] text-zinc-600 tabular-nums"
                    style={{ left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)' }}>
                    {h % 3 === 0 ? h.toString().padStart(2, '0') : ''}
                  </div>
                ))}
              </div>
              <div className="relative bg-zinc-950/50 rounded overflow-hidden"
                style={{ height: `${containerHeight}px` }}>
                {Array.from({ length: 25 }).map((_, h) => (
                  <div key={h} className="absolute top-0 bottom-0 border-l border-zinc-800/40"
                    style={{ left: `${(h / 24) * 100}%` }} />
                ))}
                {lanes.flatMap((lane, li) =>
                  lane.map((s) => {
                    const left = ((s._start - dayStart) / 86_400_000) * 100;
                    const width = ((s._end - s._start) / 86_400_000) * 100;
                    const showLabel = width > 4;
                    return (
                      <div key={s.id}
                        className={`absolute rounded border text-[11px] font-medium leading-none cursor-pointer hover:brightness-125 transition-all overflow-hidden ${TOOL_BG[s.tool] ?? 'bg-zinc-600 border-zinc-500 text-zinc-100'}`}
                        style={{
                          left: `${left}%`, width: `${Math.max(width, 0.4)}%`,
                          top: `${LANE_GAP + li * (LANE_HEIGHT + LANE_GAP)}px`,
                          height: `${LANE_HEIGHT}px`,
                        }}
                        onMouseEnter={(e) => setHover({ s, x: e.clientX, y: e.clientY })}
                        onMouseMove={(e) => setHover({ s, x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHover(null)}
                      >
                        {showLabel && (
                          <div className="px-1.5 py-1 truncate">
                            <span className="opacity-80">{fmtHHmm(s._start)}</span>{' · '}{s.project}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex gap-4 mt-3 text-[11px] text-zinc-600">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500/80 inline-block" /> claude code</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-600/80 inline-block" /> codex</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-600/80 inline-block" /> cursor</span>
              </div>
              {hover && (
                <div className="fixed z-20 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs shadow-xl pointer-events-none max-w-xs"
                  style={{ left: hover.x + 12, top: hover.y + 12 }}>
                  <p className="text-zinc-100 font-medium mb-0.5">
                    {hover.s.project} <span className="text-zinc-500 font-normal">· {hover.s.tool}</span>
                  </p>
                  {hover.s.aiTitle && <p className="text-zinc-400 mb-1 line-clamp-2">{hover.s.aiTitle}</p>}
                  <p className="text-zinc-500 tabular-nums">
                    {fmtHHmm(hover.s.startMs)} → {fmtHHmm(hover.s.endMs)} · {durMin(hover.s.startMs, hover.s.endMs)}m
                  </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

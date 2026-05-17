'use client';

import React, { useState, useMemo } from 'react';

export interface SessionEntry {
  id: string;
  tool: string;
  started_at: number;
  ended_at: number | null;
  cwd: string | null;
  confidence: string;
  summary: string | null;
  ai_title: string | null;
  tags: string | null;
}

const PRESET_TAGS = ['blocked', 'poc', 'spike', 'review', 'done'];

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function cwdBasename(cwd: string | null): string {
  if (!cwd) return '—';
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}
function duration(startMs: number, endMs: number | null): string {
  if (!endMs) return 'active';
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function parseTags(raw: string | null): string[] {
  try { return raw ? (JSON.parse(raw) as string[]) : []; } catch { return []; }
}

function ToolBadge({ tool }: { tool: string }) {
  if (tool === 'codex')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-800/50">codex</span>;
  if (tool === 'cursor')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-400 border border-sky-800/50">cursor</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-400 border border-violet-800/50">claude</span>;
}

function TagChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  const colors: Record<string, string> = {
    blocked: 'bg-red-900/40 text-red-400 border-red-800/50',
    poc: 'bg-yellow-900/40 text-yellow-400 border-yellow-800/50',
    spike: 'bg-orange-900/40 text-orange-400 border-orange-800/50',
    review: 'bg-blue-900/40 text-blue-400 border-blue-800/50',
    done: 'bg-zinc-700/40 text-zinc-400 border-zinc-600/50',
  };
  const cls = colors[label] ?? 'bg-zinc-800/40 text-zinc-400 border-zinc-700/50';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-white leading-none">&times;</button>
      )}
    </span>
  );
}

export function SessionsTable({ sessions }: { sessions: SessionEntry[] }) {
  const [search, setSearch] = useState('');
  const [tagStates, setTagStates] = useState<Record<string, string[]>>({});
  const [tagInput, setTagInput] = useState<Record<string, string>>({});
  const [tagOpen, setTagOpen] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      cwdBasename(s.cwd).toLowerCase().includes(q) ||
      (s.ai_title ?? '').toLowerCase().includes(q) ||
      (s.summary ?? '').toLowerCase().includes(q)
    );
  }, [sessions, search]);

  async function saveTags(sessionId: string, tags: string[]) {
    setTagStates((t) => ({ ...t, [sessionId]: tags }));
    await fetch(`/api/sessions/${sessionId}/tags`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
    });
  }

  function getTags(s: SessionEntry): string[] {
    return tagStates[s.id] ?? parseTags(s.tags);
  }

  function addTag(s: SessionEntry, tag: string) {
    const trimmed = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!trimmed) return;
    const cur = getTags(s);
    if (cur.includes(trimmed)) return;
    saveTags(s.id, [...cur, trimmed]);
    setTagInput((t) => ({ ...t, [s.id]: '' }));
  }

  function removeTag(s: SessionEntry, tag: string) {
    saveTags(s.id, getTags(s).filter((t) => t !== tag));
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 gap-4">
        <h2 className="text-sm font-medium text-zinc-300 shrink-0">Recent Sessions</h2>
        <input
          type="text"
          placeholder="search project / title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-xs bg-zinc-800 border border-zinc-700 rounded px-3 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <span className="text-xs text-zinc-500 shrink-0">
          {sessions.filter((s) => !s.ended_at).length} active · {filtered.length}/{sessions.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-zinc-600 text-sm text-center">No sessions match.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-zinc-500 border-b border-zinc-800">
              <th className="px-4 py-2 text-left font-normal">started</th>
              <th className="px-4 py-2 text-left font-normal">tool</th>
              <th className="px-4 py-2 text-left font-normal">project · title</th>
              <th className="px-4 py-2 text-left font-normal">dur</th>
              <th className="px-4 py-2 text-left font-normal">status</th>
              <th className="px-4 py-2 text-left font-normal">tags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const isActive = !s.ended_at;
              const tags = getTags(s);
              const isTagOpen = tagOpen === s.id;

              return (
                <React.Fragment key={s.id}>
                  <tr className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-2 text-zinc-500 tabular-nums whitespace-nowrap text-xs">
                      {formatTime(s.started_at)}
                    </td>
                    <td className="px-4 py-2">
                      <ToolBadge tool={s.tool} />
                    </td>
                    <td className="px-4 py-2 max-w-xs">
                      <div className="text-zinc-200 text-xs font-medium">{cwdBasename(s.cwd)}</div>
                      {s.ai_title && (
                        <div className="text-zinc-500 text-xs truncate">{s.ai_title}</div>
                      )}
                      {!s.ai_title && s.summary && (
                        <div className="text-zinc-600 text-xs truncate">{s.summary}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-zinc-500 tabular-nums text-xs">
                      {duration(s.started_at, s.ended_at ?? null)}
                    </td>
                    <td className="px-4 py-2">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                          active
                        </span>
                      ) : (
                        <span className="text-zinc-700 text-xs">done</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1 items-center">
                        {tags.map((t) => (
                          <TagChip key={t} label={t} onRemove={() => removeTag(s, t)} />
                        ))}
                        {isTagOpen ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={tagInput[s.id] ?? ''}
                              onChange={(e) => setTagInput((x) => ({ ...x, [s.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { addTag(s, tagInput[s.id] ?? ''); }
                                if (e.key === 'Escape') setTagOpen(null);
                              }}
                              placeholder="tag…"
                              className="w-16 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 text-xs text-zinc-200 focus:outline-none"
                            />
                            <div className="flex gap-1">
                              {PRESET_TAGS.filter((pt) => !tags.includes(pt)).slice(0, 3).map((pt) => (
                                <button key={pt} onClick={() => addTag(s, pt)}
                                  className="text-xs text-zinc-500 hover:text-zinc-300 px-1 py-0.5 rounded border border-zinc-700">
                                  {pt}
                                </button>
                              ))}
                            </div>
                            <button onClick={() => setTagOpen(null)} className="text-zinc-600 hover:text-zinc-400 text-xs">✕</button>
                          </div>
                        ) : (
                          <button onClick={() => setTagOpen(s.id)}
                            className="text-zinc-700 hover:text-zinc-400 text-xs leading-none">+</button>
                        )}
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';

interface CodexAccountSummary {
  accountId: string;
  label: string;
  email: string | null;
  name: string | null;
  planType: string | null;
  userId: string | null;
  lastRefresh: string | null;
  idTokenExpiresAt: string | null;
  accessTokenExpiresAt: string | null;
  storedAt: string | null;
  isCurrent: boolean;
}

interface Props {
  initialAccounts: CodexAccountSummary[];
}

function formatDate(value: string | null) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

export function CodexAccountsPanel({ initialAccounts }: Props) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(() => accounts.find((account) => account.isCurrent) ?? null, [accounts]);

  async function runAction(action: string, accountId?: string) {
    setPending(accountId ? `${action}:${accountId}` : action);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/codex-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, accountId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Operation failed');
      setAccounts(payload.accounts ?? []);
      if (action === 'import-current') setMessage('Current Codex login saved to the account list.');
      if (action === 'switch') setMessage('Codex auth.json switched. Restart active Codex sessions to use the new account.');
      if (action === 'delete') setMessage('Saved account removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Active Codex account</p>
          {current ? (
            <>
              <h2 className="text-lg font-semibold text-zinc-100">{current.label}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-zinc-600">plan</p>
                  <p className="mt-1 text-zinc-300">{current.planType ?? 'unknown'}</p>
                </div>
                <div>
                  <p className="text-zinc-600">account id</p>
                  <p className="mt-1 text-zinc-300">{shortId(current.accountId)}</p>
                </div>
                <div>
                  <p className="text-zinc-600">access token</p>
                  <p className="mt-1 text-zinc-300">expires {formatDate(current.accessTokenExpiresAt)}</p>
                </div>
                <div>
                  <p className="text-zinc-600">last refresh</p>
                  <p className="mt-1 text-zinc-300">{formatDate(current.lastRefresh)}</p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">No readable Codex auth found at ~/.codex/auth.json.</p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <p className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Local account store</p>
          <p className="text-sm text-zinc-400 leading-6">
            Saved snapshots live in <span className="text-zinc-200">~/.codex/auth-accounts</span>. Tokens are stored on disk for switching, but this page only renders decoded metadata.
          </p>
          <button
            type="button"
            onClick={() => runAction('import-current')}
            disabled={pending !== null}
            className="mt-4 w-full rounded-md border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === 'import-current' ? 'Saving...' : 'Save current Codex login'}
          </button>
        </section>
      </div>

      {(message || error) && (
        <div className={`rounded-lg border px-4 py-3 text-xs ${error ? 'border-red-900/60 bg-red-950/40 text-red-200' : 'border-emerald-900/60 bg-emerald-950/30 text-emerald-200'}`}>
          {error ?? message}
        </div>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900">
        <div className="hidden grid-cols-[1.2fr_0.8fr_0.9fr_170px] border-b border-zinc-800 px-4 py-3 text-xs uppercase tracking-wider text-zinc-600 md:grid">
          <span>account</span>
          <span>plan</span>
          <span>tokens</span>
          <span className="text-right">actions</span>
        </div>
        {accounts.length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">No saved accounts yet. Log into Codex, then save the current login here.</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {accounts.map((account) => {
              const switchPending = pending === `switch:${account.accountId}`;
              const deletePending = pending === `delete:${account.accountId}`;
              return (
                <div key={account.accountId} className="grid gap-3 px-4 py-4 md:grid-cols-[1.2fr_0.8fr_0.9fr_170px] md:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-100">{account.label}</p>
                      {account.isCurrent && <span className="rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">active</span>}
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-600">{account.name ?? account.email ?? account.userId ?? shortId(account.accountId)}</p>
                  </div>
                  <div className="text-xs text-zinc-400">
                    <span className="mr-2 text-zinc-600 md:hidden">plan</span>
                    {account.planType ?? 'unknown'}
                  </div>
                  <div className="text-xs text-zinc-500">
                    <p>access {formatDate(account.accessTokenExpiresAt)}</p>
                    <p className="mt-1">saved {formatDate(account.storedAt)}</p>
                  </div>
                  <div className="flex gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => runAction('switch', account.accountId)}
                      disabled={account.isCurrent || pending !== null}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {switchPending ? 'Switching...' : 'Switch'}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction('delete', account.accountId)}
                      disabled={account.isCurrent || pending !== null}
                      className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-red-900 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {deletePending ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

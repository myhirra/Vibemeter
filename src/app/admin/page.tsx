export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { CodexAccountsPanel } from '@/components/CodexAccountsPanel';
import { getCodexAccounts } from '@/lib/codex-auth';

export default async function AdminPage() {
  const accounts = await getCodexAccounts();

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter Admin
            </h1>
            <p className="text-zinc-600 text-xs mt-1">local Codex account switching · tokens stay on this machine</p>
          </div>
          <Link
            href="/"
            className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
          >
            Dashboard
          </Link>
        </div>

        <CodexAccountsPanel initialAccounts={accounts} />
      </div>
    </div>
  );
}

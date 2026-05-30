export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { CodexAccountsPanel } from '@/components/CodexAccountsPanel';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { getCodexAccounts } from '@/lib/codex-auth';
import { getServerLocale } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';

export default async function AdminPage() {
  const accounts = await getCodexAccounts();
  const locale = await getServerLocale();

  return (
    <div className="min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-100 font-mono">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href="/" className="block text-xl font-semibold tracking-tight text-zinc-100 transition-colors hover:text-zinc-200">
              <span className="text-violet-400">Vibe</span>meter {locale === 'zh' ? '· 管理' : 'Admin'}
            </Link>
            <p className="text-zinc-600 text-xs mt-1">{t(locale, 'admin.subtitle')}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <LocaleSwitcher />
          </div>
        </div>

        <CodexAccountsPanel initialAccounts={accounts} />
      </div>
    </div>
  );
}

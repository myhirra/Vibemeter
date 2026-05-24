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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter {locale === 'zh' ? '· 管理' : 'Admin'}
            </h1>
            <p className="text-zinc-600 text-xs mt-1">{t(locale, 'admin.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link
              href="/"
              className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            >
              {t(locale, 'common.dashboard')}
            </Link>
          </div>
        </div>

        <CodexAccountsPanel initialAccounts={accounts} />
      </div>
    </div>
  );
}

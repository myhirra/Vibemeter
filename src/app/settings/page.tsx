export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { SettingsNotifyPanel } from '@/components/SettingsNotifyPanel';
import { SettingsAlertsPanel } from '@/components/SettingsAlertsPanel';
import { SettingsDonatePanel } from '@/components/SettingsDonatePanel';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { getNotifyStatus } from '@/lib/notify-installer';
import { alertsConfigPath, maskWebhook, readAlertConfig } from '@/lib/alerts/storage';
import { getServerLocale } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';

export default async function SettingsPage() {
  const locale = await getServerLocale();
  const initialStatus = getNotifyStatus();
  const alertConfig = readAlertConfig();
  const initialAlerts = {
    config: {
      channels: alertConfig.channels.map((c) => ({ ...c, webhook: maskWebhook(c.webhook) })),
      rules: alertConfig.rules,
      pushLocale: alertConfig.pushLocale ?? 'zh',
    },
    configPath: alertsConfigPath(),
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter {locale === 'zh' ? '· 设置' : 'Settings'}
            </h1>
            <p className="text-zinc-600 text-xs mt-1">{t(locale, 'settings.subtitle')}</p>
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

        <div className="space-y-6">
          <SettingsNotifyPanel initialStatus={initialStatus} />
          <SettingsAlertsPanel initialConfig={initialAlerts.config} initialConfigPath={initialAlerts.configPath} />
          <SettingsDonatePanel />
        </div>
      </div>
    </div>
  );
}

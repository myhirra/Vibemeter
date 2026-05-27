'use client';

import Image from 'next/image';
import { useT } from '@/lib/i18n/client';

/**
 * In-app marketing page rendered at `/` when `VIBEMETER_SITE === 'marketing'`.
 *
 * Distinct from `deploy/vibemeter-site/index.html` (the static SEO landing).
 * This one runs inside the same Next.js app the user just installed, so it
 * can reuse the app's bilingual messages table and link straight into the
 * pricing page that lives at `/pricing`.
 *
 * Positioning: lead with the runway angle, not "token tracker". The hero
 * answers a single question — "can my next AI coding run finish?" — and the
 * three feature cards expand into the surfaces that make that answer:
 * floating quota meter, /compact warnings, and cache diagnostics.
 */

const INSTALL_CMD = "curl -fsSL 'https://vibemeter.siney.top/install.sh?src=site-copy' | bash";

const SOURCES = [
  '~/.claude/projects/**/*.jsonl',
  '~/.codex/state_5.sqlite',
  'Cursor workspaceStorage',
];

export function MarketingPage() {
  const t = useT();

  const features: Array<{ key: string; title: string; body: string }> = [
    {
      key: 'runway',
      title: t('marketing.features.runway.title'),
      body: t('marketing.features.runway.body'),
    },
    {
      key: 'context',
      title: t('marketing.features.context.title'),
      body: t('marketing.features.context.body'),
    },
    {
      key: 'cache',
      title: t('marketing.features.cache.title'),
      body: t('marketing.features.cache.body'),
    },
  ];

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-8 pt-10 lg:min-h-[78vh] lg:grid-cols-[0.86fr_1.14fr]">
        <div className="min-w-0">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-violet-300">
            {t('marketing.hero.eyebrow')}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            {t('marketing.hero.title')}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
            {t('marketing.hero.subtitle')}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              className="rounded-full bg-violet-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-900/40 transition-colors hover:bg-violet-400"
              href="/pricing"
            >
              {t('marketing.cta.primary')}
            </a>
            <a
              className="rounded-full border border-zinc-700 px-5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-zinc-500 hover:text-zinc-50"
              href="/install.sh?src=site-button"
            >
              {t('marketing.cta.secondary')}
            </a>
          </div>

          <div className="mt-6 min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">
              {t('marketing.install.label')}
            </p>
            <code className="block whitespace-pre-wrap break-all rounded-md bg-zinc-950 px-3 py-3 text-sm text-zinc-100">
              {INSTALL_CMD}
            </code>
          </div>

          <p className="mt-5 text-xs leading-6 text-zinc-500">
            {t('marketing.privacy')}
          </p>
        </div>

        <div className="min-w-0 space-y-4">
          <Image
            src="/float-expanded.png"
            alt={t('marketing.imageAltExpanded')}
            width={520}
            height={360}
            className="mx-auto block h-auto w-full max-w-[420px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
            priority
          />
          <Image
            src="/float-collapsed.png"
            alt={t('marketing.imageAltCollapsed')}
            width={520}
            height={260}
            className="mx-auto block h-auto w-full max-w-[420px] rounded-lg border border-zinc-800 bg-zinc-900"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14">
        <div className="grid gap-3 md:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.key} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">{feature.title}</h2>
              <p className="mt-2 text-xs leading-6 text-zinc-500">{feature.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-sm font-semibold text-zinc-100">{t('marketing.sources.title')}</h2>
          <p className="mt-2 text-xs leading-6 text-zinc-500">{t('marketing.sources.body')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {SOURCES.map((source) => (
              <code
                key={source}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-400"
              >
                {source}
              </code>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

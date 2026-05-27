export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { SettingsDashboardLink } from '@/components/SettingsDashboardLink';
import { PricingCtaButtons } from '@/components/PricingCtaButtons';
import { getServerLocale } from '@/lib/i18n/server';
import { t } from '@/lib/i18n';
import {
  PRICING,
  PRO_DEFAULT_DEVICES,
  TEAM_CONTACT_HREF,
  FREE_INSTALL_URL,
} from '@/lib/pricing-config';

// Pricing has no per-request data — everything is config-driven. We still keep
// it dynamic so locale cookie flips render immediately without a stale cache.
export default async function PricingPage() {
  const locale = await getServerLocale();

  const freeFeatures = [
    t(locale, 'pricing.feature.free.float'),
    t(locale, 'pricing.feature.free.status'),
    t(locale, 'pricing.feature.free.reset'),
    t(locale, 'pricing.feature.free.dashboard'),
    t(locale, 'pricing.feature.free.history'),
    t(locale, 'pricing.feature.free.activity'),
    t(locale, 'pricing.feature.free.redact'),
  ];

  const proFeatures = [
    t(locale, 'pricing.feature.pro.everythingFree'),
    t(locale, 'pricing.feature.pro.history'),
    t(locale, 'pricing.feature.pro.forecast'),
    t(locale, 'pricing.feature.pro.alerts'),
    t(locale, 'pricing.feature.pro.context'),
    t(locale, 'pricing.feature.pro.cacheDiag'),
    t(locale, 'pricing.feature.pro.lowCache'),
    t(locale, 'pricing.feature.pro.projects'),
    t(locale, 'pricing.feature.pro.search'),
    t(locale, 'pricing.feature.pro.transcript'),
    t(locale, 'pricing.feature.pro.git'),
    t(locale, 'pricing.feature.pro.report'),
    t(locale, 'pricing.feature.pro.devices', { n: PRO_DEFAULT_DEVICES }),
    t(locale, 'pricing.feature.pro.updates'),
    t(locale, 'pricing.feature.pro.refund'),
  ];

  const teamFeatures = [
    t(locale, 'pricing.feature.team.reports'),
    t(locale, 'pricing.feature.team.exports'),
    t(locale, 'pricing.feature.team.seats'),
    t(locale, 'pricing.feature.team.integrations'),
    t(locale, 'pricing.feature.team.support'),
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
              <span className="text-violet-400">Vibe</span>meter
            </h1>
            <p className="text-zinc-600 text-xs mt-1">{t(locale, 'header.tagline')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <SettingsDashboardLink label={t(locale, 'common.dashboard')} />
          </div>
        </header>

        <section className="mb-10 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
            {t(locale, 'pricing.heroTitle')}
          </h2>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-2xl mx-auto">
            {t(locale, 'pricing.heroTagline')}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <PlanCard
            name={t(locale, 'pricing.plan.free.name')}
            price={t(locale, 'pricing.plan.free.price')}
            period={t(locale, 'pricing.plan.free.period')}
            subtitle={t(locale, 'pricing.plan.free.subtitle')}
            features={freeFeatures}
            cta={
              <a
                href={FREE_INSTALL_URL}
                className="inline-flex w-full items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/60"
              >
                {t(locale, 'pricing.plan.free.cta')}
              </a>
            }
          />

          <PlanCard
            highlight
            name={t(locale, 'pricing.plan.pro.name')}
            price={`$${PRICING.proFounding.price}`}
            period={t(locale, 'pricing.plan.pro.period')}
            subtitle={t(locale, 'pricing.plan.pro.subtitle')}
            features={proFeatures}
            cta={
              <PricingCtaButtons
                label={t(locale, 'pricing.plan.pro.cta')}
                comingSoonTitle={t(locale, 'pricing.plan.pro.ctaDisabledTitle')}
                comingSoonLabel={t(locale, 'pricing.checkoutComingSoon')}
              />
            }
          />

          <PlanCard
            name={t(locale, 'pricing.plan.team.name')}
            price={t(locale, 'pricing.plan.team.price')}
            period={t(locale, 'pricing.plan.team.period')}
            subtitle={t(locale, 'pricing.plan.team.subtitle')}
            features={teamFeatures}
            muted
            cta={
              <a
                href={TEAM_CONTACT_HREF}
                className="inline-flex w-full items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800/60"
              >
                {t(locale, 'pricing.plan.team.cta')}
              </a>
            }
          />
        </section>

        <section className="mt-12 rounded-lg border border-zinc-800 bg-zinc-900 p-6">
          <h3 className="text-sm font-semibold text-zinc-100">
            {t(locale, 'pricing.foot.title')}
          </h3>
          <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
            {t(locale, 'pricing.foot.line1')}
          </p>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
            {t(locale, 'pricing.foot.line2')}
          </p>

          <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FaqItem
              q={t(locale, 'pricing.foot.faqQ1')}
              a={t(locale, 'pricing.foot.faqA1', { n: PRO_DEFAULT_DEVICES })}
            />
            <FaqItem
              q={t(locale, 'pricing.foot.faqQ2')}
              a={t(locale, 'pricing.foot.faqA2')}
            />
            <FaqItem
              q={t(locale, 'pricing.foot.faqQ3')}
              a={t(locale, 'pricing.foot.faqA3')}
            />
          </dl>
        </section>

        <footer className="mt-10 flex items-center justify-between text-xs text-zinc-600">
          <Link href="/" className="hover:text-zinc-300 transition-colors">
            ← {t(locale, 'common.dashboard')}
          </Link>
          <Link href="/settings" className="hover:text-zinc-300 transition-colors">
            {t(locale, 'common.settings')} →
          </Link>
        </footer>
      </div>
    </div>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  subtitle: string;
  features: string[];
  cta: React.ReactNode;
  highlight?: boolean;
  muted?: boolean;
}

function PlanCard({ name, price, period, subtitle, features, cta, highlight, muted }: PlanCardProps) {
  return (
    <div
      className={`flex flex-col rounded-lg border p-6 ${
        highlight
          ? 'border-violet-500/60 bg-zinc-900 shadow-[0_0_0_1px_rgba(167,139,250,0.18)]'
          : muted
            ? 'border-zinc-800 bg-zinc-900/50'
            : 'border-zinc-800 bg-zinc-900'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={`text-base font-semibold ${highlight ? 'text-violet-300' : 'text-zinc-100'}`}>
          {name}
        </h3>
        {highlight && (
          <span className="rounded-full border border-violet-700/60 bg-violet-900/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-violet-300">
            Founding
          </span>
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-zinc-100">{price}</span>
        <span className="text-xs text-zinc-500">{period}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>

      <ul className="mt-5 space-y-2 text-xs text-zinc-300 flex-1">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <span className={`mt-0.5 ${highlight ? 'text-violet-400' : 'text-zinc-500'}`}>·</span>
            <span className="leading-relaxed">{f}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">{cta}</div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-300">{q}</dt>
      <dd className="mt-1 text-xs text-zinc-500 leading-relaxed">{a}</dd>
    </div>
  );
}

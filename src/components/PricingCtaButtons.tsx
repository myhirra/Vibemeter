'use client';

/**
 * Pro CTA on the pricing page. Lives as a client component because the
 * "disabled tooltip when no checkout URL is configured" interaction is a
 * pointer / focus event, and because we want the button to render the same
 * shape regardless of whether the env var was set at build time.
 */
import { CHECKOUT_URL_PRO_FOUNDING } from '@/lib/pricing-config';

interface Props {
  label: string;
  comingSoonTitle: string;
  comingSoonLabel: string;
}

export function PricingCtaButtons({ label, comingSoonTitle, comingSoonLabel }: Props) {
  const checkoutUrl = CHECKOUT_URL_PRO_FOUNDING.trim();
  const ready = checkoutUrl.length > 0;

  if (ready) {
    return (
      <a
        href={checkoutUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-full items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500"
      >
        {label}
      </a>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled
        title={comingSoonTitle}
        className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-md bg-violet-600/40 px-3 py-2 text-xs font-medium text-violet-100/70"
      >
        {label}
      </button>
      <p className="text-center text-[11px] text-zinc-500">{comingSoonLabel}</p>
    </div>
  );
}

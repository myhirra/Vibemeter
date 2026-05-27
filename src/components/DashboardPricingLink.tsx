'use client';

/**
 * Small "Pricing" link in the dashboard header. Only renders when the user is
 * on the free plan — Pro users have no reason to see a pricing nudge on every
 * dashboard load. Client component so the visibility decision is local and
 * doesn't require pushing license state into RSC.
 */
import Link from 'next/link';
import { useLicense } from '@/lib/entitlements-client';

interface Props {
  label: string;
}

export function DashboardPricingLink({ label }: Props) {
  const { plan } = useLicense();
  if (plan !== 'free') return null;
  return (
    <Link
      href="/pricing"
      className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-violet-500/60 hover:text-violet-200"
    >
      {label}
    </Link>
  );
}

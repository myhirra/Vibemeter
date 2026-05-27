'use client';

/**
 * Small "Upgrade" pill rendered in the Settings header — only when the user
 * is on the free plan. Kept as a client component so we can hide it once the
 * license provider resolves to a paid plan (no flicker, no wasted CTA).
 */
import Link from 'next/link';
import { useLicense } from '@/lib/entitlements-client';

interface Props {
  label: string;
}

export function SettingsUpgradeLink({ label }: Props) {
  const { plan } = useLicense();
  if (plan !== 'free') return null;
  return (
    <Link
      href="/pricing"
      className="rounded-md border border-violet-700/60 bg-violet-900/30 px-3 py-2 text-xs font-medium text-violet-200 transition-colors hover:border-violet-500 hover:text-violet-50"
    >
      {label}
    </Link>
  );
}

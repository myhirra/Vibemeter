'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';

interface Props {
  label: string;
}

export function SettingsDashboardLink({ label }: Props) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.location.assign('/');
  }

  return (
    <Link
      href="/"
      onClick={navigate}
      className="rounded-md border border-zinc-800 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
    >
      {label}
    </Link>
  );
}

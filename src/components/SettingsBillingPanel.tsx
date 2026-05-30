'use client';

/**
 * License / billing surface inside the Settings page.
 *
 * IMPORTANT: this panel is purely presentational — there is no real license
 * server, no Lemon Squeezy / Paddle wiring. Every action button is rendered
 * disabled with a "coming in the next update" tooltip. The component exists so
 * the visual shape of each license state is locked in before the verification
 * pipeline lands in Phase 6.
 *
 * Dev preview: when `NEXT_PUBLIC_VIBEMETER_DEV_PLAN` is set we expose a small
 * state switcher so the maintainer can preview every state shape without
 * mutating storage. The switcher reads / writes the `devLicenseState` URL
 * param so screenshots can be deep-linked.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { useLicense, useLicenseSession, type LicenseState } from '@/lib/entitlements-client';
import type { LicenseStatus } from '@/lib/entitlements';

const DEV_STATES: LicenseStatus[] = [
  'none',
  'active',
  'grace',
  'offline',
  'expired',
  'disabled',
  'invalid',
];

function isDevModeEnabled(): boolean {
  // NEXT_PUBLIC_* inlines at build time, so this evaluates the same on server
  // (during the first SSR pass) and on the client after hydration. We still
  // gate the switcher's actual rendering on `mounted` below to avoid touching
  // window during SSR.
  return Boolean(process.env.NEXT_PUBLIC_VIBEMETER_DEV_PLAN);
}

function readUrlState(): LicenseStatus | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('devLicenseState');
  if (!raw) return null;
  return (DEV_STATES as readonly string[]).includes(raw) ? (raw as LicenseStatus) : null;
}

export function SettingsBillingPanel() {
  const t = useT();
  const license = useLicense();

  // Dev preview state. Default to whatever the env override resolves to, but
  // let `?devLicenseState=` win after mount so screenshots are deterministic.
  const [mounted, setMounted] = useState(false);
  const [devOverride, setDevOverride] = useState<LicenseStatus | null>(null);
  useEffect(() => {
    // Reading window state on mount is a one-shot init; setState is the only way.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    setDevOverride(readUrlState());
  }, []);

  const devEnabled = isDevModeEnabled();
  const effectiveLicense = useMemo<LicenseState>(() => {
    if (devEnabled && devOverride) {
      return synthesizeDevState(devOverride);
    }
    return license;
  }, [devEnabled, devOverride, license]);

  function setDevState(next: LicenseStatus | null) {
    setDevOverride(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next) {
      url.searchParams.set('devLicenseState', next);
    } else {
      url.searchParams.delete('devLicenseState');
    }
    window.history.replaceState(null, '', url.toString());
  }

  return (
    <section className="h-full rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-100">{t('billing.title')}</h2>
        <p className="text-zinc-500 text-xs mt-1">{t('billing.subtitle')}</p>
      </div>

      <BillingBody state={effectiveLicense} />

      {devEnabled && mounted && (
        <DevSwitcher current={devOverride} onChange={setDevState} />
      )}
    </section>
  );
}

function BillingBody({ state }: { state: LicenseState }) {
  // Resolve which UI variant to render. We branch on `status` first because
  // the lifecycle controls copy; the resolved `plan` is shown for context.
  switch (state.status) {
    case 'active':
    case 'dev':
      return <ActiveState state={state} />;
    case 'grace':
      return <GraceState state={state} />;
    case 'offline':
      return <OfflineState state={state} />;
    case 'expired':
      return <ExpiredState />;
    case 'disabled':
      return <DisabledState />;
    case 'invalid':
      return <InvalidState />;
    case 'none':
    default:
      return <FreeState />;
  }
}

// ─── Free / no license ──────────────────────────────────────────────────

function FreeState() {
  const t = useT();
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">{t('billing.free.header')}</h3>
          <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
            free
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-400">{t('billing.free.intro')}</p>
        <ul className="mt-2 space-y-1 text-xs text-zinc-400">
          <ProBullet text={t('billing.free.bullet1')} />
          <ProBullet text={t('billing.free.bullet2')} />
          <ProBullet text={t('billing.free.bullet3')} />
          <ProBullet text={t('billing.free.bullet4')} />
        </ul>
      </div>

      <div>
        <Link
          href="/pricing"
          className="inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500"
        >
          {t('billing.free.primaryCta')}
        </Link>
      </div>

      <LicenseKeyActivation
        label={t('billing.free.keyLabel')}
        placeholder={t('billing.free.keyPlaceholder')}
        activateLabel={t('billing.free.activate')}
      />
    </div>
  );
}

// ─── Real license activation field ───────────────────────────────────────

function LicenseKeyActivation({
  label,
  placeholder,
  activateLabel,
}: {
  label: string;
  placeholder: string;
  activateLabel: string;
}) {
  const t = useT();
  const { refresh } = useLicenseSession();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function activate() {
    setError(null);
    setSuccess(false);
    setBusy(true);
    try {
      const res = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate', key: key.trim() }),
      });
      const payload = await res.json().catch(() => ({} as { ok?: boolean; errorKey?: string }));
      if (payload.ok) {
        setSuccess(true);
        setKey('');
        await refresh();
      } else {
        setError(payload.errorKey ?? 'billing.error.unknown');
      }
    } catch {
      setError('billing.error.network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500" htmlFor="vibemeter-license-key">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id="vibemeter-license-key"
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim() && !busy) void activate(); }}
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void activate()}
          disabled={busy || !key.trim()}
          className="inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-600/30 disabled:text-violet-100/70"
        >
          {busy ? t('billing.activating') : activateLabel}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-300">{t(error)}</p>}
      {success && <p className="mt-2 text-[11px] text-emerald-300">{t('billing.activateSuccess')}</p>}
    </div>
  );
}

// ─── Real validate (refresh) button ─────────────────────────────────────

function ValidateButton({ label }: { label: string }) {
  const t = useT();
  const { refresh } = useLicenseSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'validate' }),
      });
      const payload = await res.json().catch(() => ({} as { ok?: boolean; errorKey?: string }));
      if (!payload.ok) setError(payload.errorKey ?? 'billing.error.unknown');
      await refresh();
    } catch {
      setError('billing.error.network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void validate()}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-600/30 disabled:text-violet-100/70"
      >
        {busy ? t('billing.activating') : label}
      </button>
      {error && <p className="text-[11px] text-red-300">{t(error)}</p>}
    </div>
  );
}

// ─── Real deactivate button ─────────────────────────────────────────────

function DeactivateButton({ label }: { label: string }) {
  const t = useT();
  const { refresh } = useLicenseSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deactivate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deactivate' }),
      });
      const payload = await res.json().catch(() => ({} as { ok?: boolean; errorKey?: string }));
      if (payload.ok) {
        await refresh();
      } else {
        setError(payload.errorKey ?? 'billing.error.unknown');
      }
    } catch {
      setError('billing.error.network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void deactivate()}
        disabled={busy}
        className="inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-600/30 disabled:text-violet-100/70"
      >
        {busy ? t('billing.deactivating') : label}
      </button>
      {error && <p className="text-[11px] text-red-300">{t(error)}</p>}
    </div>
  );
}

// ─── Active / dev ───────────────────────────────────────────────────────

function ActiveState({ state }: { state: LicenseState }) {
  const t = useT();
  const masked = formatMaskedKey(state.licenseKeyLast4);
  const lastValidatedValue = state.lastValidatedAt
    ? formatDate(state.lastValidatedAt)
    : t('billing.active.lastValidatedNeverShort');
  const updatesUntilValue = state.updatesUntil
    ? formatDate(state.updatesUntil)
    : '—';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">{t('billing.active.header')}</h3>
        <span className="rounded-full border border-emerald-800 bg-emerald-900/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300">
          {state.status === 'dev' ? 'dev' : 'active'}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <Field label={t('billing.active.keyLabel')} value={<code className="font-mono text-zinc-200">{masked}</code>} />
        <Field label={t('billing.active.deviceLabel')} value={<span className="text-zinc-200">{t('billing.thisDevice')}</span>} />
        <Field label={t('billing.active.lastValidatedLabel')} value={<span className="text-zinc-400">{lastValidatedValue}</span>} />
        <Field label={t('billing.active.updatesUntilLabel')} value={<span className="text-zinc-400">{updatesUntilValue}</span>} />
      </dl>

      <div className="flex flex-wrap items-start gap-2">
        <DeactivateButton label={t('billing.active.deactivate')} />
        <DisabledButton title={t('billing.managePurchaseComingSoon')} variant="secondary">
          {t('billing.active.manage')}
        </DisabledButton>
      </div>
    </div>
  );
}

// ─── Grace ──────────────────────────────────────────────────────────────

function GraceState({ state }: { state: LicenseState }) {
  const t = useT();
  // Banner copy reads "X days ago" / "valid until Y" — both rely on Date.now().
  // Reading the wall clock at render is the intended behaviour (banner is
  // re-rendered on focus when refresh() fires).
  // eslint-disable-next-line react-hooks/purity
  const days = state.lastValidatedAt ? Math.max(0, Math.floor((Date.now() - state.lastValidatedAt) / 86_400_000)) : 0;
  // Grace deadline placeholder: 14 days after the last validation, or now+14d
  // when we have no anchor. Real value will come from the license payload.
  // eslint-disable-next-line react-hooks/purity
  const deadlineMs = (state.lastValidatedAt ?? Date.now()) + 14 * 86_400_000;
  return (
    <WarningBanner
      tone="amber"
      header={t('billing.grace.header')}
      body={t('billing.grace.body', { days })}
      hint={t('billing.grace.hint', { date: formatDate(deadlineMs) })}
    >
      <ValidateButton label={t('billing.grace.refresh')} />
    </WarningBanner>
  );
}

// ─── Offline ────────────────────────────────────────────────────────────

function OfflineState({ state }: { state: LicenseState }) {
  const t = useT();
  const masked = formatMaskedKey(state.licenseKeyLast4);
  return (
    <WarningBanner
      tone="amber"
      header={t('billing.offline.header')}
      body={t('billing.offline.body')}
      hint={t('billing.offline.hint')}
    >
      <code className="rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[11px] text-zinc-300">
        {masked}
      </code>
    </WarningBanner>
  );
}

// ─── Expired ────────────────────────────────────────────────────────────

function ExpiredState() {
  const t = useT();
  return (
    <WarningBanner
      tone="red"
      header={t('billing.expired.header')}
      body={t('billing.expired.body')}
    >
      <div className="flex flex-wrap gap-2">
        <Link
          href="/pricing"
          className="inline-flex items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500"
        >
          {t('billing.renewCta')}
        </Link>
        <a
          href="mailto:hi@vibemeter.dev"
          className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-zinc-500"
        >
          {t('billing.contactSupport')}
        </a>
      </div>
    </WarningBanner>
  );
}

// ─── Disabled ───────────────────────────────────────────────────────────

function DisabledState() {
  const t = useT();
  return (
    <WarningBanner
      tone="red"
      header={t('billing.disabled.header')}
      body={t('billing.disabled.body')}
    >
      <a
        href="mailto:hi@vibemeter.dev"
        className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-zinc-500"
      >
        {t('billing.contactSupport')}
      </a>
    </WarningBanner>
  );
}

// ─── Invalid ────────────────────────────────────────────────────────────

function InvalidState() {
  const t = useT();
  return (
    <WarningBanner tone="red" header={t('billing.invalid.header')} body={t('billing.invalid.body')}>
      <LicenseKeyActivation
        label={t('billing.invalid.keyLabel')}
        placeholder=""
        activateLabel={t('billing.invalid.retry')}
      />
    </WarningBanner>
  );
}

// ─── primitives ─────────────────────────────────────────────────────────

function ProBullet({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 text-violet-400">·</span>
      <span className="leading-relaxed">{text}</span>
    </li>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-1 text-xs">{value}</div>
    </div>
  );
}

interface DisabledButtonProps {
  children: React.ReactNode;
  title: string;
  variant?: 'primary' | 'secondary';
}

function DisabledButton({ children, title, variant = 'primary' }: DisabledButtonProps) {
  const base = 'inline-flex cursor-not-allowed items-center justify-center rounded-md px-3 py-2 text-xs font-medium transition-colors';
  const palette =
    variant === 'primary'
      ? 'bg-violet-600/30 text-violet-100/70'
      : 'border border-zinc-700 text-zinc-400 bg-transparent';
  return (
    <button type="button" disabled title={title} className={`${base} ${palette}`}>
      {children}
    </button>
  );
}

function WarningBanner({
  tone,
  header,
  body,
  hint,
  children,
}: {
  tone: 'amber' | 'red';
  header: string;
  body: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const palette =
    tone === 'amber'
      ? 'border-amber-900/60 bg-amber-950/30 text-amber-100'
      : 'border-red-900/60 bg-red-950/30 text-red-100';
  const accent = tone === 'amber' ? 'text-amber-300' : 'text-red-300';
  return (
    <div className={`rounded border px-4 py-3 ${palette}`}>
      <div className={`text-sm font-semibold ${accent}`}>{header}</div>
      <p className="mt-1 text-xs leading-relaxed">{body}</p>
      {hint && <p className={`mt-1 text-xs leading-relaxed ${tone === 'amber' ? 'text-amber-200/80' : 'text-red-200/80'}`}>{hint}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

function DevSwitcher({
  current,
  onChange,
}: {
  current: LicenseStatus | null;
  onChange: (next: LicenseStatus | null) => void;
}) {
  const t = useT();
  return (
    <div className="mt-6 rounded border border-dashed border-violet-900/60 bg-violet-950/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-violet-300">{t('billing.dev.title')}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
        <DevPill active={current === null} onClick={() => onChange(null)}>
          (auto)
        </DevPill>
        {DEV_STATES.map((s) => (
          <DevPill key={s} active={current === s} onClick={() => onChange(s)}>
            {t(`billing.dev.state${capitalize(s)}` as `billing.dev.state${string}`)}
          </DevPill>
        ))}
      </div>
    </div>
  );
}

function DevPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 transition-colors ${
        active
          ? 'border-violet-500 bg-violet-700/40 text-violet-100'
          : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function formatMaskedKey(last4?: string | null): string {
  if (!last4) return '—';
  // Normalize to uppercase, take last 4, render as the standard mask.
  const tail = last4.toUpperCase().slice(-4).padStart(4, '·');
  return `****-****-${tail}`;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  // YYYY-MM-DD in the user's local zone — short and unambiguous in both locales.
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Synthesize a plausible LicenseState for each dev-preview status so the panel
 * can render every branch without a real license payload behind it.
 */
function synthesizeDevState(status: LicenseStatus): LicenseState {
  const now = Date.now();
  switch (status) {
    case 'active':
      return {
        plan: 'pro',
        status: 'active',
        licenseKeyLast4: 'A1B2',
        lastValidatedAt: now - 2 * 86_400_000,
        updatesUntil: now + 365 * 86_400_000,
      };
    case 'grace':
      return {
        plan: 'pro',
        status: 'grace',
        licenseKeyLast4: 'A1B2',
        lastValidatedAt: now - 9 * 86_400_000,
        updatesUntil: now + 350 * 86_400_000,
      };
    case 'offline':
      return {
        plan: 'pro',
        status: 'offline',
        licenseKeyLast4: 'A1B2',
        lastValidatedAt: now - 3 * 86_400_000,
        updatesUntil: now + 360 * 86_400_000,
      };
    case 'expired':
      return {
        plan: 'free',
        status: 'expired',
        licenseKeyLast4: 'A1B2',
        lastValidatedAt: now - 40 * 86_400_000,
        updatesUntil: now - 10 * 86_400_000,
      };
    case 'disabled':
      return { plan: 'free', status: 'disabled', licenseKeyLast4: 'A1B2', lastValidatedAt: null, updatesUntil: null };
    case 'invalid':
      return { plan: 'free', status: 'invalid', licenseKeyLast4: null, lastValidatedAt: null, updatesUntil: null };
    case 'dev':
      return { plan: 'pro', status: 'dev', licenseKeyLast4: 'DEV1', lastValidatedAt: now, updatesUntil: now + 365 * 86_400_000 };
    case 'none':
    default:
      return { plan: 'free', status: 'none', licenseKeyLast4: null, lastValidatedAt: null, updatesUntil: null };
  }
}

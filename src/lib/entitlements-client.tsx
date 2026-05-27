'use client';

/**
 * Client-side license/entitlement context.
 *
 * On mount the provider fetches `/api/license` (cached on disk, no network)
 * and updates `state`. Re-fetches on window focus and after activate /
 * deactivate mutations. We never block first paint on validation: until the
 * fetch resolves, consumers see the dev-env override or the Free default,
 * so app startup is never gated on the license daemon.
 *
 * Dev preview: `NEXT_PUBLIC_VIBEMETER_DEV_PLAN=pro` (or `team`) ignores the
 * real fetch and pins the plan. Useful for screenshots before activating a
 * real key.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasFeature,
  isPlan,
  type Feature,
  type LicenseStatus,
  type Plan,
} from './entitlements';
import type { LicenseState as ServerLicenseState } from './license/provider';

export interface LicenseState {
  plan: Plan;
  status: LicenseStatus;
  licenseKeyLast4?: string | null;
  lastValidatedAt?: number | null;
  updatesUntil?: number | null;
}

const DEFAULT_STATE: LicenseState = {
  plan: 'free',
  status: 'none',
  licenseKeyLast4: null,
  lastValidatedAt: null,
  updatesUntil: null,
};

interface LicenseContextValue {
  state: LicenseState;
  loading: boolean;
  /** Re-fetch from `/api/license`. Returns the resolved state. */
  refresh: () => Promise<LicenseState>;
}

const LicenseContext = createContext<LicenseContextValue>({
  state: DEFAULT_STATE,
  loading: false,
  refresh: async () => DEFAULT_STATE,
});

function resolveDevState(): LicenseState | null {
  const raw = process.env.NEXT_PUBLIC_VIBEMETER_DEV_PLAN;
  if (raw && isPlan(raw) && raw !== 'free') {
    return { plan: raw, status: 'dev' };
  }
  return null;
}

/**
 * Server state has its own lifecycle (`active`/`inactive`/`expired`/`disabled`/`none`).
 * We map that onto our richer client-side LicenseStatus union so the existing
 * billing UI (which already branches on grace/offline/etc.) keeps working.
 */
function toClientState(server: ServerLicenseState): LicenseState {
  if (server.status === 'none') return DEFAULT_STATE;
  const status = mapStatus(server);
  return {
    plan: server.plan === 'team' ? 'team' : server.plan === 'pro' ? 'pro' : 'free',
    status,
    licenseKeyLast4: server.licenseKeyLast4 ?? null,
    lastValidatedAt: server.lastValidatedAt ?? null,
    updatesUntil: server.expiresAt ?? null,
  };
}

function mapStatus(server: ServerLicenseState): LicenseStatus {
  if (server.status === 'disabled') return 'disabled';
  if (server.status === 'expired') return 'expired';
  if (server.status === 'inactive') return server.plan === 'free' ? 'invalid' : 'expired';
  // Active. Decide between active / grace / offline / expired-by-grace.
  const now = Date.now();
  const lastValidated = server.lastValidatedAt ?? 0;
  const grace = server.validationGraceUntil ?? Infinity;
  const ttlMs = 7 * 86_400_000;
  if (now <= lastValidated + ttlMs) return 'active';
  // Cached validation expired but we're still within grace.
  if (now <= grace) {
    // Some part of "validation overdue but still good" — surface as grace.
    return 'grace';
  }
  // Past grace → effectively free. Surface as expired so UI prompts a refresh.
  return 'expired';
}

export function LicenseProvider({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: LicenseState;
}) {
  const devState = useMemo(() => resolveDevState(), []);
  const [state, setState] = useState<LicenseState>(initialState ?? devState ?? DEFAULT_STATE);
  // We're "loading" only when there's no dev override and no SSR-provided
  // initial state. The Free default already renders fine; this flag lets
  // future UIs show a spinner if they want.
  const [loading, setLoading] = useState(!devState && !initialState);
  const mounted = useRef(false);

  const refresh = useCallback(async (): Promise<LicenseState> => {
    if (devState) {
      setState(devState);
      setLoading(false);
      return devState;
    }
    try {
      const res = await fetch('/api/license', { cache: 'no-store' });
      if (!res.ok) throw new Error(`license fetch ${res.status}`);
      const payload = await res.json() as { state?: ServerLicenseState };
      const next = payload.state ? toClientState(payload.state) : DEFAULT_STATE;
      if (mounted.current) {
        setState(next);
        setLoading(false);
      }
      return next;
    } catch {
      if (mounted.current) {
        setState(DEFAULT_STATE);
        setLoading(false);
      }
      return DEFAULT_STATE;
    }
  }, [devState]);

  useEffect(() => {
    mounted.current = true;
    if (devState) return; // dev override already pinned; skip fetch
    // Initial data fetch is the canonical "trigger setState from effect" case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // Re-fetch when the window regains focus so an activation done in another
    // tab (or the CLI) becomes visible without a full reload.
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      mounted.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [devState, refresh]);

  const value = useMemo<LicenseContextValue>(
    () => ({ state, loading, refresh }),
    [state, loading, refresh],
  );
  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}

/**
 * Returns the bare LicenseState — the most common consumer. Existing call
 * sites destructure { plan, status, … } so we keep the shape stable.
 */
export function useLicense(): LicenseState {
  return useContext(LicenseContext).state;
}

/**
 * Sibling hook that exposes `refresh()` + `loading`. Used by the Settings
 * billing panel after a successful activate / deactivate mutation.
 */
export function useLicenseSession(): LicenseContextValue {
  return useContext(LicenseContext);
}

/**
 * Sugar hook: "is this feature available on the active plan?"
 */
export function useEntitlement(feature: Feature): boolean {
  const { plan } = useLicense();
  return hasFeature(feature, plan);
}

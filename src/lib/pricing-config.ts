/**
 * Single source of truth for plan pricing. Kept config-shaped so we can swap
 * numbers (e.g. promote `proStandard` to the public price once the Founding
 * window closes) without chasing copy through templates. The pricing page and
 * the Settings/Billing panel both read from here.
 *
 * Checkout URL is intentionally read from an env var: when it's unset (default
 * for OSS contributors) the UI renders a disabled CTA with a tooltip instead
 * of a dead link. No real payments wiring lives here — that's a later phase.
 */
export const PRICING = {
  free: { price: 0 },
  proFounding: { price: 39, currency: 'USD', label: 'Founding License' },
  proStandard: { price: 59, currency: 'USD', label: 'Standard' },
  team: { price: null, currency: 'USD', label: 'Coming soon' },
} as const;

export type PricingPlan = keyof typeof PRICING;

/**
 * Checkout URL for the Pro Founding tier. Plumbed through `NEXT_PUBLIC_*` so
 * Next inlines it at build time and the same value is visible to server and
 * client. Empty string ⇒ disabled CTA (no broken link).
 */
export const CHECKOUT_URL_PRO_FOUNDING: string =
  process.env.NEXT_PUBLIC_VIBEMETER_CHECKOUT_URL ?? '';

/**
 * Where the "Install free" secondary CTA points. The marketing landing page
 * already hosts a curl-based install line; reuse it instead of duplicating
 * download instructions on the pricing page.
 */
export const FREE_INSTALL_URL = 'https://vibemeter.siney.top';

/**
 * Mailto target for the Team plan "Contact" CTA. Overridable via env so we can
 * point at a Fastmail alias / Discord invite later without code changes.
 */
export const TEAM_CONTACT_HREF: string =
  process.env.NEXT_PUBLIC_VIBEMETER_TEAM_CONTACT ?? 'mailto:hi@vibemeter.dev';

/**
 * Default device count baked into the Pro license. Surfaced on the pricing
 * page ("multi-device — default {n}") and on the Settings/Billing panel.
 */
export const PRO_DEFAULT_DEVICES = 2;

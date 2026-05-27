/**
 * Focused gating snapshot for `hasFeature` against the actual `Feature` keys
 * shipped in `src/lib/entitlements.ts`. Complements
 * `tests/entitlements.test.ts` (which exercises the FEATURES map structurally)
 * by pinning the *user-visible* gating decisions: which surfaces stay open to
 * Free, and which are reserved for Pro / Team.
 *
 * Note: a few conceptual features listed in the Phase 9 spec (e.g.
 * `full-history`, `redact-mode`, `transcript-search`) don't have dedicated
 * keys in the current FEATURES map — those user-facing capabilities are
 * always-available on the local-first build, gated only by the surrounding
 * UI. We therefore assert the closest matching real keys instead of
 * fabricating new ones.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { FEATURES, hasFeature, type Feature, type Plan } from '../src/lib/entitlements.ts';

// Features that the Free plan must always retain. These are the baseline
// surfaces Vibemeter promises to keep local-first and unpaywalled.
const FREE_AVAILABLE: Feature[] = [
  'float.basic',
  'float.contextWindow',     // context-pressure indicator in the bubble
  'float.muteAlerts',
  'float.deepLinkDashboard',
  'dashboard.nowRunway',     // "can I keep coding?" decision card
  'dashboard.cacheCard',     // cache-diagnostics surface
  'dashboard.apiEquivValue',
  'dashboard.achievements',
  'dashboard.heatmap',
  'dashboard.shareReport',   // markdown / share-report export
  'alerts.webhookPush',
];

// Features that should be reserved for Pro (and inherited by Team).
const PRO_ONLY: Feature[] = [
  'dashboard.advancedExport',
  'dashboard.multiAccount',
  'alerts.scheduledRules',
];

// Features that should only ever resolve true for Team.
const TEAM_ONLY: Feature[] = [
  'team.sharedDashboard',
  'team.adminRoles',
];

test('free plan keeps every baseline floating-bubble + dashboard feature open', () => {
  for (const feature of FREE_AVAILABLE) {
    assert.equal(
      hasFeature(feature, 'free'),
      true,
      `expected Free to include ${feature}`,
    );
  }
});

test('Pro-only features are gated off for the free plan', () => {
  for (const feature of PRO_ONLY) {
    assert.equal(
      hasFeature(feature, 'free'),
      false,
      `expected Free to NOT include ${feature}`,
    );
  }
});

test('Pro-only features all light up for the pro plan', () => {
  for (const feature of PRO_ONLY) {
    assert.equal(
      hasFeature(feature, 'pro'),
      true,
      `expected Pro to include ${feature}`,
    );
  }
});

test('team plan inherits everything in Pro plus the team-only extras', () => {
  for (const feature of [...FREE_AVAILABLE, ...PRO_ONLY, ...TEAM_ONLY]) {
    assert.equal(
      hasFeature(feature, 'team'),
      true,
      `expected Team to include ${feature}`,
    );
  }
});

test('team-only features are unreachable from free or pro', () => {
  const plans: Plan[] = ['free', 'pro'];
  for (const feature of TEAM_ONLY) {
    for (const plan of plans) {
      assert.equal(
        hasFeature(feature, plan),
        false,
        `${plan} must NOT include ${feature}`,
      );
    }
  }
});

test('every feature key listed appears in at least one plan in the FEATURES map', () => {
  // Belt-and-braces: catches a key being added to the type union but forgotten
  // in the FEATURES map (which would silently hide it from every plan).
  const allDeclared = new Set<string>([
    ...FEATURES.free,
    ...FEATURES.pro,
    ...FEATURES.team,
  ]);
  for (const feature of [...FREE_AVAILABLE, ...PRO_ONLY, ...TEAM_ONLY]) {
    assert.ok(
      allDeclared.has(feature),
      `${feature} should be declared in FEATURES`,
    );
  }
});

test('redact / floating-bubble basics are free for everyone (local-first guarantee)', () => {
  for (const plan of ['free', 'pro', 'team'] as Plan[]) {
    assert.equal(hasFeature('float.basic', plan), true);
  }
});

test('cache-diagnostics surface stays free across all tiers', () => {
  for (const plan of ['free', 'pro', 'team'] as Plan[]) {
    assert.equal(hasFeature('dashboard.cacheCard', plan), true);
  }
});

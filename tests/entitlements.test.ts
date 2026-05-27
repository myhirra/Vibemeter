import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEATURES,
  hasFeature,
  isPlan,
  planFromStatus,
  type Feature,
  type Plan,
} from '../src/lib/entitlements.ts';

const ALL_PLANS: Plan[] = ['free', 'pro', 'team'];

test('every plan exposes the baseline floating-bubble features', () => {
  for (const plan of ALL_PLANS) {
    assert.ok(hasFeature('float.basic', plan), `${plan} should have float.basic`);
    assert.ok(hasFeature('float.muteAlerts', plan), `${plan} should have float.muteAlerts`);
    assert.ok(hasFeature('float.contextWindow', plan), `${plan} should have float.contextWindow`);
  }
});

test('free plan does not get pro-tier features', () => {
  assert.equal(hasFeature('dashboard.advancedExport', 'free'), false);
  assert.equal(hasFeature('dashboard.multiAccount', 'free'), false);
  assert.equal(hasFeature('alerts.scheduledRules', 'free'), false);
});

test('pro inherits free + adds its own', () => {
  for (const f of FEATURES.free) {
    assert.ok(hasFeature(f, 'pro'), `pro should also have ${f}`);
  }
  assert.ok(hasFeature('dashboard.advancedExport', 'pro'));
  assert.ok(hasFeature('dashboard.multiAccount', 'pro'));
});

test('team inherits pro + adds team-only features', () => {
  for (const f of FEATURES.pro) {
    assert.ok(hasFeature(f, 'team'), `team should also have ${f}`);
  }
  assert.ok(hasFeature('team.sharedDashboard', 'team'));
  assert.ok(hasFeature('team.adminRoles', 'team'));
  assert.equal(hasFeature('team.sharedDashboard', 'pro'), false);
});

test('hasFeature returns false for unknown / malformed plan input', () => {
  assert.equal(hasFeature('float.basic', 'enterprise' as unknown as Plan), false);
  assert.equal(hasFeature('float.basic', '' as unknown as Plan), false);
});

test('FEATURES table contains every Feature key declared in the union', () => {
  // This guards against accidentally adding a Feature key to the type but
  // forgetting to add it to any plan list — that would silently disable it
  // for everyone.
  const declaredOnFree = new Set<string>(FEATURES.free);
  const declaredOnPro = new Set<string>(FEATURES.pro);
  const declaredOnTeam = new Set<string>(FEATURES.team);
  const sample: Feature[] = [
    'float.basic',
    'float.contextWindow',
    'float.muteAlerts',
    'float.deepLinkDashboard',
    'dashboard.nowRunway',
    'dashboard.cacheCard',
    'dashboard.apiEquivValue',
    'dashboard.achievements',
    'dashboard.heatmap',
    'dashboard.shareReport',
    'dashboard.advancedExport',
    'dashboard.multiAccount',
    'alerts.webhookPush',
    'alerts.scheduledRules',
    'team.sharedDashboard',
    'team.adminRoles',
  ];
  for (const key of sample) {
    const inAny = declaredOnFree.has(key) || declaredOnPro.has(key) || declaredOnTeam.has(key);
    assert.ok(inAny, `${key} should appear in at least one plan`);
  }
});

test('planFromStatus maps lifecycle states to effective plans', () => {
  assert.equal(planFromStatus('active', 'pro'), 'pro');
  assert.equal(planFromStatus('grace', 'pro'), 'pro');
  assert.equal(planFromStatus('offline', 'team'), 'team');
  assert.equal(planFromStatus('dev', 'pro'), 'pro');
  assert.equal(planFromStatus('expired', 'pro'), 'free');
  assert.equal(planFromStatus('disabled', 'pro'), 'free');
  assert.equal(planFromStatus('invalid', 'pro'), 'free');
  assert.equal(planFromStatus('none', 'pro'), 'free');
});

test('isPlan accepts known plans and rejects anything else', () => {
  for (const p of ALL_PLANS) assert.ok(isPlan(p));
  assert.equal(isPlan('enterprise'), false);
  assert.equal(isPlan(null), false);
  assert.equal(isPlan(undefined), false);
  assert.equal(isPlan(42), false);
});

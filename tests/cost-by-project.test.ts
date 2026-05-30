import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCostByProject } from '../src/lib/cost-attribution.ts';
import type { ProjectCostContribution } from '../src/lib/cost-attribution.ts';

function c(project: string, claudeUsd: number, codexUsd = 0): ProjectCostContribution {
  return { project, claudeUsd, codexUsd };
}

test('groups contributions by project and sums cost', () => {
  const out = groupCostByProject([
    c('alpha', 1.0),
    c('alpha', 2.0),
    c('beta', 0.5),
  ]);
  const alpha = out.find((p) => p.project === 'alpha')!;
  assert.equal(alpha.claudeUsd, 3.0);
  assert.equal(alpha.totalUsd, 3.0);
  assert.equal(alpha.sessions, 2);
});

test('sorts projects by total spend descending', () => {
  const out = groupCostByProject([
    c('cheap', 1.0),
    c('pricey', 9.0),
    c('mid', 4.0),
  ]);
  assert.deepEqual(out.map((p) => p.project), ['pricey', 'mid', 'cheap']);
});

test('combines claude and codex spend per project into total', () => {
  const out = groupCostByProject([
    { project: 'alpha', claudeUsd: 2.0, codexUsd: 1.5 },
  ]);
  assert.equal(out[0].claudeUsd, 2.0);
  assert.equal(out[0].codexUsd, 1.5);
  assert.equal(out[0].totalUsd, 3.5);
  assert.equal(out[0].sessions, 1);
});

test('rounds money to cents', () => {
  const out = groupCostByProject([
    c('alpha', 0.1),
    c('alpha', 0.2), // 0.1 + 0.2 = 0.30000000000000004 in float
  ]);
  assert.equal(out[0].totalUsd, 0.3, 'should round away float noise');
});

test('blank project names collapse to a single placeholder bucket', () => {
  const out = groupCostByProject([
    c('', 1.0),
    c('   ', 2.0),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].project, '—');
  assert.equal(out[0].totalUsd, 3.0);
});

test('empty input yields an empty list, not a crash', () => {
  assert.deepEqual(groupCostByProject([]), []);
});

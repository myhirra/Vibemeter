import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getCodexAccounts,
  importCurrentCodexAuth,
  switchCodexAccount,
} from '../src/lib/codex-auth.ts';

function jwt(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

function auth(accountId: string, email: string, plan = 'plus') {
  return {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({
        email,
        name: email.split('@')[0],
        exp: 1_800_000_000,
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId,
          chatgpt_plan_type: plan,
          user_id: `user-${accountId}`,
        },
      }),
      access_token: jwt({
        exp: 1_800_000_100,
        'https://api.openai.com/auth': {
          chatgpt_account_id: accountId,
          chatgpt_plan_type: plan,
        },
      }),
      refresh_token: `rt_${accountId}`,
      account_id: accountId,
    },
    last_refresh: '2026-05-15T12:00:00.000Z',
  };
}

test('imports current Codex auth into a local account store without exposing token strings', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-auth-'));
  const authPath = path.join(root, 'auth.json');
  const storeDir = path.join(root, 'accounts');
  await writeFile(authPath, JSON.stringify(auth('acct-a', 'a@example.com')), 'utf8');

  const imported = await importCurrentCodexAuth({ authPath, storeDir });
  const accounts = await getCodexAccounts({ authPath, storeDir });

  assert.equal(imported.accountId, 'acct-a');
  assert.equal(accounts[0]?.email, 'a@example.com');
  assert.equal(accounts[0]?.planType, 'plus');
  assert.equal(accounts[0]?.isCurrent, true);
  assert.equal(JSON.stringify(accounts).includes('rt_acct-a'), false);
  assert.equal(JSON.stringify(accounts).includes('header.'), false);
});

test('switches the active Codex account and writes a backup of the previous auth file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-switch-'));
  const authPath = path.join(root, 'auth.json');
  const storeDir = path.join(root, 'accounts');
  await writeFile(authPath, JSON.stringify(auth('acct-a', 'a@example.com')), 'utf8');
  await importCurrentCodexAuth({ authPath, storeDir });
  await writeFile(authPath, JSON.stringify(auth('acct-b', 'b@example.com')), 'utf8');
  await importCurrentCodexAuth({ authPath, storeDir });

  const switched = await switchCodexAccount('acct-a', { authPath, storeDir });
  const active = JSON.parse(await readFile(authPath, 'utf8'));
  const accounts = await getCodexAccounts({ authPath, storeDir });

  assert.equal(switched.accountId, 'acct-a');
  assert.equal(active.tokens.account_id, 'acct-a');
  assert.equal(active.tokens.refresh_token, 'rt_acct-a');
  assert.equal(accounts.find((account) => account.accountId === 'acct-a')?.isCurrent, true);
  assert.equal(accounts.some((account) => account.label.includes('a@example.com')), true);
  assert.ok(switched.backupPath);
  assert.equal(switched.backupPath.endsWith('.bak'), true);
});

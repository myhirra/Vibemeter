import { mkdir, readFile, rename, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

interface CodexAuthFile {
  auth_mode?: unknown;
  OPENAI_API_KEY?: unknown;
  tokens?: {
    id_token?: unknown;
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  };
  last_refresh?: unknown;
}

export interface CodexAccountSummary {
  accountId: string;
  label: string;
  email: string | null;
  name: string | null;
  planType: string | null;
  userId: string | null;
  lastRefresh: string | null;
  idTokenExpiresAt: string | null;
  accessTokenExpiresAt: string | null;
  storedAt: string | null;
  isCurrent: boolean;
}

export interface CodexAuthPaths {
  authPath?: string;
  storeDir?: string;
}

export interface CurrentCodexAccount {
  accountId: string;
  authMtimeMs: number;
}

const AUTH_CLAIMS_KEY = 'https://api.openai.com/auth';

function defaultAuthPath() {
  return path.join(/* turbopackIgnore: true */ homedir(), '.codex', 'auth.json');
}

function defaultStoreDir() {
  return path.join(/* turbopackIgnore: true */ homedir(), '.codex', 'auth-accounts');
}

function resolvePaths(paths: CodexAuthPaths = {}) {
  return {
    authPath: paths.authPath ?? defaultAuthPath(),
    storeDir: paths.storeDir ?? defaultStoreDir(),
  };
}

function accountPath(accountId: string, storeDir: string) {
  return path.join(/* turbopackIgnore: true */ storeDir, `${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

async function readAuthFile(filePath: string): Promise<CodexAuthFile> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw) as CodexAuthFile;
  if (!parsed.tokens || typeof parsed.tokens.account_id !== 'string') {
    throw new Error('Codex auth file is missing tokens.account_id');
  }
  return parsed;
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, filePath);
}

function decodeJwtPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const [, payload] = token.split('.');
  if (!payload) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringClaim(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function expiryClaim(value: unknown): string | null {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : null;
}

function summarizeAuth(auth: CodexAuthFile, storedAt: string | null, currentAccountId: string | null): CodexAccountSummary {
  const accountId = stringClaim(auth.tokens?.account_id);
  if (!accountId) throw new Error('Codex auth file is missing tokens.account_id');

  const idPayload = decodeJwtPayload(auth.tokens?.id_token);
  const accessPayload = decodeJwtPayload(auth.tokens?.access_token);
  const idAuthClaims = idPayload?.[AUTH_CLAIMS_KEY] as Record<string, unknown> | undefined;
  const accessAuthClaims = accessPayload?.[AUTH_CLAIMS_KEY] as Record<string, unknown> | undefined;

  const email = stringClaim(idPayload?.email);
  const name = stringClaim(idPayload?.name);
  const planType = stringClaim(idAuthClaims?.chatgpt_plan_type) ?? stringClaim(accessAuthClaims?.chatgpt_plan_type);
  const userId = stringClaim(idAuthClaims?.user_id) ?? stringClaim(accessAuthClaims?.user_id);
  const label = email ?? name ?? `${accountId.slice(0, 8)}...${accountId.slice(-4)}`;

  return {
    accountId,
    label,
    email,
    name,
    planType,
    userId,
    lastRefresh: stringClaim(auth.last_refresh),
    idTokenExpiresAt: expiryClaim(idPayload?.exp),
    accessTokenExpiresAt: expiryClaim(accessPayload?.exp),
    storedAt,
    isCurrent: accountId === currentAccountId,
  };
}

export async function getCodexAccounts(paths: CodexAuthPaths = {}): Promise<CodexAccountSummary[]> {
  const { authPath, storeDir } = resolvePaths(paths);
  let currentAccountId: string | null = null;
  let currentAuth: CodexAuthFile | null = null;

  try {
    currentAuth = await readAuthFile(authPath);
    currentAccountId = stringClaim(currentAuth.tokens?.account_id);
  } catch {
    currentAuth = null;
  }

  const accounts = new Map<string, CodexAccountSummary>();

  try {
    const entries = await readdir(storeDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(storeDir, entry);
      try {
        const storedAuth = await readAuthFile(filePath);
        const storedStat = await stat(filePath);
        const summary = summarizeAuth(storedAuth, storedStat.mtime.toISOString(), currentAccountId);
        accounts.set(summary.accountId, summary);
      } catch {
        // Ignore malformed account snapshots so one bad file does not break the admin page.
      }
    }
  } catch {
    // Missing store just means no saved accounts yet.
  }

  if (currentAuth && currentAccountId && !accounts.has(currentAccountId)) {
    accounts.set(currentAccountId, summarizeAuth(currentAuth, null, currentAccountId));
  }

  return [...accounts.values()].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export function getCurrentCodexAccount(paths: CodexAuthPaths = {}): CurrentCodexAccount | null {
  const { authPath } = resolvePaths(paths);
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as CodexAuthFile;
    const accountId = stringClaim(auth.tokens?.account_id);
    if (!accountId) return null;
    return {
      accountId,
      authMtimeMs: statSync(authPath).mtimeMs,
    };
  } catch {
    return null;
  }
}

export async function importCurrentCodexAuth(paths: CodexAuthPaths = {}): Promise<CodexAccountSummary> {
  const { authPath, storeDir } = resolvePaths(paths);
  const auth = await readAuthFile(authPath);
  const accountId = auth.tokens?.account_id as string;
  const destination = accountPath(accountId, storeDir);
  await writeJsonAtomic(destination, auth);
  const storedStat = await stat(destination);
  return summarizeAuth(auth, storedStat.mtime.toISOString(), accountId);
}

export async function switchCodexAccount(accountId: string, paths: CodexAuthPaths = {}) {
  const { authPath, storeDir } = resolvePaths(paths);
  const source = accountPath(accountId, storeDir);
  const auth = await readAuthFile(source);
  const sourceAccountId = auth.tokens?.account_id;
  if (sourceAccountId !== accountId) {
    throw new Error('Stored account id does not match requested account');
  }

  let backupPath: string | null = null;
  try {
    const current = await readFile(authPath, 'utf8');
    backupPath = `${authPath}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await writeFile(backupPath, current, { encoding: 'utf8', mode: 0o600 });
  } catch {
    backupPath = null;
  }

  await writeJsonAtomic(authPath, auth);
  return {
    ...summarizeAuth(auth, null, accountId),
    backupPath,
  };
}

export async function deleteCodexAccount(accountId: string, paths: CodexAuthPaths = {}) {
  const { authPath, storeDir } = resolvePaths(paths);
  const auth = await readAuthFile(authPath).catch(() => null);
  if (auth?.tokens?.account_id === accountId) {
    throw new Error('Cannot delete the currently active Codex account');
  }
  await unlink(accountPath(accountId, storeDir));
}

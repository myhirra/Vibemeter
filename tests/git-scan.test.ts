import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

function git(repo: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      ...env,
      GIT_AUTHOR_NAME: 'Vibe Test',
      GIT_AUTHOR_EMAIL: 'test@vibemeter.local',
      GIT_COMMITTER_NAME: 'Vibe Test',
      GIT_COMMITTER_EMAIL: 'test@vibemeter.local',
    } as NodeJS.ProcessEnv,
  });
}

test('scanGitCommits links commits to sessions whose time range covers them', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vm-git-'));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);

  const tStart = Date.now() - 60 * 60_000; // 1h ago
  const tCommit = tStart + 10 * 60_000;
  const tEnd = tStart + 20 * 60_000;

  writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
  git(repo, ['add', 'a.txt']);
  const ts = new Date(tCommit).toISOString();
  git(repo, ['commit', '-q', '-m', 'add a'], {
    GIT_AUTHOR_DATE: ts,
    GIT_COMMITTER_DATE: ts,
  });

  const dbPath = path.join(root, 'vm.sqlite');
  const db = new Database(dbPath);
  const { bootstrap } = await import('../src/lib/db-bootstrap.ts');
  bootstrap(db);
  db.prepare(`
    INSERT INTO sessions (id, tool, started_at, ended_at, cwd, confidence)
    VALUES (?, 'claude-code', ?, ?, ?, 'high')
  `).run('11111111-1111-1111-1111-111111111111', tStart, tEnd, repo);

  const { scanGitCommits, commitCountsBySession, commitsForSession } = await import('../src/lib/git/scan.ts');
  const result = scanGitCommits(db);
  assert.equal(result.reposScanned, 1);
  assert.equal(result.linksInserted, 1);

  const counts = commitCountsBySession(db);
  assert.equal(counts.get('11111111-1111-1111-1111-111111111111'), 1);

  const commits = commitsForSession('11111111-1111-1111-1111-111111111111', db);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'add a');
  assert.equal(commits[0].shortSha.length, 7);
});

test('scanGitCommits is idempotent — running twice does not duplicate', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'vm-git-idem-'));
  const repo = path.join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);

  const t = Date.now() - 30 * 60_000;
  writeFileSync(path.join(repo, 'a.txt'), 'hi\n');
  git(repo, ['add', 'a.txt']);
  const ts = new Date(t).toISOString();
  git(repo, ['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: ts, GIT_COMMITTER_DATE: ts });

  const db = new Database(path.join(root, 'vm.sqlite'));
  const { bootstrap } = await import('../src/lib/db-bootstrap.ts');
  bootstrap(db);
  db.prepare(`INSERT INTO sessions (id, tool, started_at, ended_at, cwd, confidence) VALUES (?, 'claude-code', ?, ?, ?, 'high')`)
    .run('22222222-2222-2222-2222-222222222222', t - 5 * 60_000, t + 5 * 60_000, repo);

  const { scanGitCommits } = await import('../src/lib/git/scan.ts');
  scanGitCommits(db);
  const second = scanGitCommits(db);
  assert.equal(second.linksInserted, 0);
  const total = db.prepare(`SELECT COUNT(*) AS n FROM session_commits`).get() as { n: number };
  assert.equal(total.n, 1);
});

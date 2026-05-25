import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { dataDir } from './data-dir';
import { getNotifyStatus } from './notify-installer';

export type DoctorStatus = 'ready' | 'needs_setup' | 'missing' | 'unknown';

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  generatedAt: number;
  overall: DoctorStatus;
  ready: number;
  needsAttention: number;
  checks: DoctorCheck[];
}

function fileExists(filePath: string): boolean {
  try { return statSync(filePath).isFile(); } catch { return false; }
}

function dirExists(dirPath: string): boolean {
  try { return statSync(dirPath).isDirectory(); } catch { return false; }
}

function countFiles(root: string, predicate: (name: string) => boolean, limit = 500): number {
  let count = 0;
  function walk(dir: string) {
    if (count >= limit) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (count >= limit) return;
      const full = path.join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full);
      else if (predicate(entry)) count += 1;
    }
  }
  if (dirExists(root)) walk(root);
  return count;
}

function check(label: string, id: string, ok: boolean, detail: string, hint?: string): DoctorCheck {
  return { id, label, status: ok ? 'ready' : 'needs_setup', detail, hint };
}

export function getDoctorReport(): DoctorReport {
  const home = homedir();
  const vibemeterDir = dataDir();
  const dbPath = path.join(vibemeterDir, 'continuity.sqlite');
  const statuslinePath = path.join(vibemeterDir, 'statusline-latest.json');
  const claudeProjectsDir = path.join(home, '.claude', 'projects');
  const codexStatePath = path.join(home, '.codex', 'state_5.sqlite');
  const codexSessionsDir = path.join(home, '.codex', 'sessions');
  const cursorStorageDir = path.join(home, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');

  const claudeJsonl = countFiles(claudeProjectsDir, (name) => name.endsWith('.jsonl'), 300);
  const codexRollouts = countFiles(codexSessionsDir, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 300);
  const cursorDbs = countFiles(cursorStorageDir, (name) => name === 'state.vscdb', 300);
  const notify = getNotifyStatus();

  const checks: DoctorCheck[] = [
    check(
      'Vibemeter data store',
      'data-store',
      existsSync(vibemeterDir) && fileExists(dbPath),
      fileExists(dbPath) ? 'Local SQLite database exists.' : 'Local database has not been created yet.',
      'Open the dashboard or run `vibemeter` once.',
    ),
    check(
      'Claude Code sessions',
      'claude-sessions',
      claudeJsonl > 0,
      claudeJsonl > 0 ? `${claudeJsonl} session logs found.` : 'No Claude Code session logs found.',
      'Run Claude Code once, then refresh Vibemeter.',
    ),
    check(
      'Claude quota statusline',
      'claude-statusline',
      fileExists(statuslinePath),
      fileExists(statuslinePath) ? 'Latest statusline quota snapshot exists.' : 'No Claude Code quota snapshot found.',
      'Add the README statusLine hook or use Codex quota until Claude writes a snapshot.',
    ),
    check(
      'Codex state database',
      'codex-state',
      fileExists(codexStatePath),
      fileExists(codexStatePath) ? 'Codex state_5.sqlite found.' : 'Codex state_5.sqlite not found.',
      'Run Codex once to create local state.',
    ),
    check(
      'Codex quota rollouts',
      'codex-rollouts',
      codexRollouts > 0,
      codexRollouts > 0 ? `${codexRollouts} rollout files found.` : 'No Codex rollout rate-limit files found.',
      'Run Codex once; Vibemeter reads rollout rate-limit events locally.',
    ),
    {
      id: 'cursor-storage',
      label: 'Cursor workspace storage',
      status: cursorDbs > 0 ? 'ready' : 'unknown',
      detail: cursorDbs > 0 ? `${cursorDbs} Cursor workspace DBs found.` : 'Cursor data not found; this is fine if you do not use Cursor.',
    },
    {
      id: 'completion-notify',
      label: 'Completion notifications',
      status: notify.claudeStop || notify.codex ? 'ready' : 'needs_setup',
      detail: notify.claudeStop || notify.codex
        ? `Claude ${notify.claudeStop ? 'ready' : 'off'}, Codex ${notify.codex ? 'ready' : 'off'}.`
        : 'Completion hooks are not installed yet.',
      hint: 'Run `vibemeter notify-install` or enable it from Settings.',
    },
  ];

  const ready = checks.filter((item) => item.status === 'ready').length;
  const needsAttention = checks.filter((item) => item.status === 'needs_setup' || item.status === 'missing').length;
  const overall: DoctorStatus = needsAttention === 0 ? 'ready' : ready >= 3 ? 'needs_setup' : 'missing';
  return { generatedAt: Date.now(), overall, ready, needsAttention, checks };
}


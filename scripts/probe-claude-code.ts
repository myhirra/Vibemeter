#!/usr/bin/env tsx
/**
 * Probes the local Claude Code environment — no parsing, just sampling.
 * Saves raw /usage output to .data/probe-usage.txt for later parser design.
 * Run: npx tsx scripts/probe-claude-code.ts
 */
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(process.cwd(), '.data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── 1. Run `claude /usage` ────────────────────────────────────────────────────

console.log('\n=== 1. claude /usage stdout ===');
let usageRaw = '';
try {
  const result = spawnSync('claude', ['/usage'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  usageRaw = (result.stdout ?? '') + (result.stderr ?? '');
  if (result.error) {
    usageRaw = `[spawnSync error] ${result.error.message}`;
  }
} catch (e) {
  usageRaw = `[exception] ${String(e)}`;
}
console.log(usageRaw || '(empty output)');

const usagePath = path.join(DATA_DIR, 'probe-usage.txt');
fs.writeFileSync(usagePath, usageRaw, 'utf8');
console.log(`→ saved to ${usagePath}`);

// ── 2. Known Claude Code data locations ──────────────────────────────────────

console.log('\n=== 2. Claude Code local data directories ===');
const candidates = [
  path.join(os.homedir(), '.claude'),
  path.join(os.homedir(), '.config', 'claude'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Claude'),
  path.join(os.homedir(), 'Library', 'Application Support', 'claude'),
];

for (const dir of candidates) {
  const exists = fs.existsSync(dir);
  console.log(`${exists ? '✓ EXISTS' : '✗ absent'} ${dir}`);
  if (exists) {
    try {
      const entries = fs.readdirSync(dir).slice(0, 20);
      for (const e of entries) {
        const full = path.join(dir, e);
        const stat = fs.statSync(full);
        console.log(`    ${stat.isDirectory() ? 'd' : 'f'} ${e}`);
        // One level deeper for directories
        if (stat.isDirectory()) {
          try {
            const sub = fs.readdirSync(full).slice(0, 10);
            for (const s of sub) console.log(`        ${s}`);
          } catch { /* permission denied etc */ }
        }
      }
    } catch (e) {
      console.log(`    (read error: ${String(e)})`);
    }
  }
}

// ── 3. .claude/ in cwd ────────────────────────────────────────────────────────

console.log('\n=== 3. .claude/ in cwd ===');
const cwdClaude = path.join(process.cwd(), '.claude');
const cwdExists = fs.existsSync(cwdClaude);
console.log(`cwd: ${process.cwd()}`);
console.log(`${cwdExists ? '✓ EXISTS' : '✗ absent'} ${cwdClaude}`);
if (cwdExists) {
  const entries = fs.readdirSync(cwdClaude).slice(0, 20);
  for (const e of entries) console.log(`  ${e}`);
}

// ── 4. `claude` binary location ───────────────────────────────────────────────

console.log('\n=== 4. claude binary ===');
try {
  const which = execSync('which claude', { encoding: 'utf8' }).trim();
  console.log(`which claude: ${which}`);
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 5_000 });
  console.log(`--version stdout: ${version.stdout?.trim()}`);
  console.log(`--version stderr: ${version.stderr?.trim()}`);
} catch (e) {
  console.log(`(error: ${String(e)})`);
}

console.log('\nProbe done ✓');

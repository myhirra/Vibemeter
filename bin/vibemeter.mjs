#!/usr/bin/env node
/**
 * Vibemeter CLI — `npx @hirra/vibemeter`
 * Spawns Next.js in production mode against the pre-built `.next/` shipped with the package.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT ?? '3000';

// Stable user-data location, overridable.
process.env.VIBEMETER_DATA_DIR ??= join(homedir(), '.vibemeter');

// Resolve `next` via Node's own module resolution — works whether deps are
// hoisted to a parent node_modules (npm install) or co-located.
const require = createRequire(import.meta.url);
let nextCliPath;
try {
  nextCliPath = require.resolve('next/dist/bin/next', { paths: [ROOT] });
} catch (e) {
  console.error('Vibemeter: could not locate the `next` package. Try reinstalling.');
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

async function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [nextCliPath, ...args], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`next ${args[0]} exit ${code}`)));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => p.kill(sig));
  });
}

if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('First run — building Vibemeter (one-time, ~30s)…');
  await run(['build']).catch((e) => { console.error(e.message); process.exit(1); });
}

console.error('');
console.error('  Vibemeter');
console.error(`  → http://localhost:${PORT}`);
console.error(`  data: ${process.env.VIBEMETER_DATA_DIR}`);
console.error('  (Ctrl-C to stop)');
console.error('');

await run(['start', '-p', String(PORT)]).catch((e) => { console.error(e.message); process.exit(1); });

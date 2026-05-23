#!/usr/bin/env node
/**
 * Vibemeter CLI — `npx @hirra/vibemeter`
 *
 *   vibemeter            start the server in the foreground
 *   vibemeter install    register as a LaunchAgent so it boots on login (macOS)
 *   vibemeter uninstall  remove the LaunchAgent
 *   vibemeter status     show whether the daemon is loaded / running
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { homedir, platform } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REQUIRE_HOOK = join(__dirname, 'require-hook.cjs');
const DEFAULT_PORT = 9527;
const PORT = process.env.PORT ?? String(DEFAULT_PORT);
const DATA_DIR = process.env.VIBEMETER_DATA_DIR ?? join(homedir(), '.vibemeter');
const LABEL = 'com.hirra.vibemeter';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

process.env.VIBEMETER_DATA_DIR = DATA_DIR;
mkdirSync(DATA_DIR, { recursive: true });

const require = createRequire(import.meta.url);
function resolveNextBin() {
  try {
    return require.resolve('next/dist/bin/next', { paths: [ROOT] });
  } catch {
    return null;
  }
}

async function runNext(args) {
  const nextBin = resolveNextBin();
  if (!nextBin) {
    console.error('Vibemeter: could not locate the `next` package. Try reinstalling.');
    process.exit(1);
  }
  return new Promise((resolveP, reject) => {
    const nodeOptions = process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} --require ${REQUIRE_HOOK}`
      : `--require ${REQUIRE_HOOK}`;
    const p = spawn(process.execPath, [nextBin, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });
    p.on('exit', (code) => code === 0 ? resolveP() : reject(new Error(`next ${args[0]} exit ${code}`)));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => p.kill(sig));
  });
}

async function start() {
  if (!existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    console.error('First run — building Vibemeter (one-time, ~30s)…');
    await runNext(['build']).catch((e) => { console.error(e.message); process.exit(1); });
  }
  console.error('');
  console.error('  Vibemeter');
  console.error(`  → http://localhost:${PORT}`);
  console.error(`  data: ${DATA_DIR}`);
  console.error('  (Ctrl-C to stop)');
  console.error('');
  await runNext(['start', '-p', String(PORT)]).catch((e) => { console.error(e.message); process.exit(1); });
}

function plistXml({ nodeBin, scriptPath, logPath, port, dataDir }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${esc(nodeBin)}</string>
        <string>${esc(scriptPath)}</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${esc(logPath)}</string>
    <key>StandardErrorPath</key><string>${esc(logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
        <key>PORT</key><string>${esc(port)}</string>
        <key>VIBEMETER_DATA_DIR</key><string>${esc(dataDir)}</string>
        <key>NODE_ENV</key><string>production</string>
    </dict>
</dict>
</plist>
`;
}

function systemdUnit({ nodeBin, scriptPath, port, dataDir }) {
  return `[Unit]
Description=Vibemeter — local AI coding dashboard
After=network.target

[Service]
ExecStart=${nodeBin} ${scriptPath}
Restart=on-failure
RestartSec=5
Environment=PORT=${port}
Environment=VIBEMETER_DATA_DIR=${dataDir}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function macInstall() {
  const scriptPath = resolvePath(fileURLToPath(import.meta.url));
  const logPath = join(DATA_DIR, 'vibemeter.log');
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  writeFileSync(PLIST_PATH, plistXml({
    nodeBin: process.execPath, scriptPath, logPath, port: PORT, dataDir: DATA_DIR,
  }));
  // Reload: unload first (ignore errors), then load
  spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['load', PLIST_PATH], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('launchctl load failed.');
    process.exit(1);
  }
  console.log('');
  console.log('  ✓ Vibemeter installed as LaunchAgent');
  console.log(`    plist:  ${PLIST_PATH}`);
  console.log(`    log:    ${logPath}`);
  console.log(`    URL:    http://localhost:${PORT}`);
  console.log('');
  console.log('  It will start automatically on login and restart if it crashes.');
  console.log('  Use `vibemeter uninstall` to remove.');
}

function macUninstall() {
  if (!existsSync(PLIST_PATH)) {
    console.log('Vibemeter LaunchAgent is not installed.');
    return;
  }
  spawnSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  rmSync(PLIST_PATH);
  console.log(`✓ Removed ${PLIST_PATH}`);
}

function macStatus() {
  const list = spawnSync('launchctl', ['list', LABEL], { encoding: 'utf8' });
  if (list.status !== 0) {
    console.log(`Not loaded. (Run \`vibemeter install\` to register.)`);
    return;
  }
  console.log(list.stdout.trim());
  console.log('');
  const log = join(DATA_DIR, 'vibemeter.log');
  if (existsSync(log)) {
    console.log(`Recent log (tail of ${log}):`);
    try {
      const body = readFileSync(log, 'utf8').trim().split('\n').slice(-15).join('\n');
      console.log(body || '(empty)');
    } catch { /* ignore */ }
  }
}

function linuxInstallHint() {
  const scriptPath = resolvePath(fileURLToPath(import.meta.url));
  const unitPath = join(homedir(), '.config', 'systemd', 'user', 'vibemeter.service');
  console.log('On Linux, write the following to ~/.config/systemd/user/vibemeter.service:\n');
  console.log(systemdUnit({ nodeBin: process.execPath, scriptPath, port: PORT, dataDir: DATA_DIR }));
  console.log('Then run:');
  console.log(`  systemctl --user daemon-reload`);
  console.log(`  systemctl --user enable --now vibemeter`);
  console.log(`  loginctl enable-linger ${process.env.USER ?? ''}   # so it keeps running when logged out`);
  console.log(`\n(target file: ${unitPath})`);
}

function help() {
  console.log(`
Vibemeter — local AI coding dashboard

Usage:
  vibemeter             start the server in the foreground (Ctrl-C to stop)
  vibemeter install     run on login + keep alive (macOS LaunchAgent)
  vibemeter uninstall   remove the auto-start config
  vibemeter status      show whether the daemon is loaded + tail logs
  vibemeter help        this message

Environment:
  PORT                  default ${DEFAULT_PORT}
  VIBEMETER_DATA_DIR    default ~/.vibemeter
`);
}

const cmd = process.argv[2];
switch (cmd) {
  case undefined:
  case 'start':
    await start();
    break;
  case 'install':
    if (platform() === 'darwin') macInstall();
    else if (platform() === 'linux') linuxInstallHint();
    else { console.error('Auto-start install not implemented for this platform yet.'); process.exit(1); }
    break;
  case 'uninstall':
    if (platform() === 'darwin') macUninstall();
    else { console.error('Auto-start uninstall not implemented for this platform yet.'); process.exit(1); }
    break;
  case 'status':
    if (platform() === 'darwin') macStatus();
    else { console.error('Status not implemented for this platform yet.'); process.exit(1); }
    break;
  case '-h':
  case '--help':
  case 'help':
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}

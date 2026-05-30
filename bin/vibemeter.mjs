#!/usr/bin/env node
/**
 * Vibemeter CLI — `npx @hirra/vibemeter`
 *
 *   vibemeter            start the server in the foreground
 *   vibemeter install    register as a LaunchAgent so it boots on login (macOS)
 *   vibemeter float      open the desktop floating widget
 *   vibemeter uninstall  remove the LaunchAgent
 *   vibemeter status     show whether the daemon is loaded / running
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync, copyFileSync, readdirSync, lstatSync, readlinkSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { homedir, platform } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REQUIRE_HOOK = join(__dirname, 'require-hook.cjs');
const FLOAT_SWIFT = join(__dirname, 'vibemeter-float.swift');
const NOTIFY_SCRIPT = join(__dirname, 'vibemeter-notify.sh');
const DEFAULT_PORT = 9527;
const PORT = process.env.PORT ?? String(DEFAULT_PORT);
const DATA_DIR = process.env.VIBEMETER_DATA_DIR ?? join(homedir(), '.vibemeter');
const LABEL = 'com.hirra.vibemeter';
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml');
const HOOK_MARKER = 'vibemeter-notify.sh';

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

// Compile the Swift binary into a minimal .app bundle so it has a stable
// CFBundleIdentifier — UNUserNotificationCenter refuses to deliver banners
// from unbundled binaries. The bundle also keeps the Dock icon hidden via
// LSUIElement and gives users a real "Vibemeter" name in the notification.
const APP_BUNDLE = join(DATA_DIR, 'Vibemeter.app');
const APP_BINARY = join(APP_BUNDLE, 'Contents', 'MacOS', 'Vibemeter');
const APP_INFO_PLIST = join(APP_BUNDLE, 'Contents', 'Info.plist');
const APP_RESOURCES_DIR = join(APP_BUNDLE, 'Contents', 'Resources');
const APP_ICON_SOURCE = join(__dirname, 'Vibemeter.icns');
const APP_ICON_FILE = join(APP_RESOURCES_DIR, 'Vibemeter.icns');
const INSTALLED_APP_DEFAULT = '/Applications/Vibemeter.app';
const BUNDLE_ID = 'com.hirra.vibemeter';

function infoPlistXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Vibemeter</string>
  <key>CFBundleDisplayName</key><string>Vibemeter</string>
  <key>CFBundleIdentifier</key><string>com.hirra.vibemeter</string>
  <key>CFBundleExecutable</key><string>Vibemeter</string>
  <key>CFBundleIconFile</key><string>Vibemeter</string>
  <key>CFBundleIconName</key><string>Vibemeter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

function currentMacBinaryArch() {
  const appleSilicon = spawnSync('/usr/sbin/sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' });
  if (appleSilicon.status === 0 && appleSilicon.stdout.trim() === '1') return 'arm64';

  const uname = spawnSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' });
  return uname.stdout.trim() === 'arm64' ? 'arm64' : 'x86_64';
}

function floatBinaryArchitectures() {
  const result = spawnSync('/usr/bin/lipo', ['-archs', APP_BINARY], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function hasCurrentMacArchitecture() {
  const archs = floatBinaryArchitectures();
  return archs.includes(currentMacBinaryArch());
}

function appInfoPlistHasIcon() {
  if (!existsSync(APP_INFO_PLIST)) return false;
  try {
    const body = readFileSync(APP_INFO_PLIST, 'utf8');
    return body.includes('<key>CFBundleIconFile</key>') && body.includes('<string>Vibemeter</string>');
  } catch {
    return false;
  }
}

function appIconNeedsRefresh() {
  if (!existsSync(APP_ICON_FILE)) return true;
  if (!existsSync(APP_ICON_SOURCE)) return false;
  return statSync(APP_ICON_FILE).mtimeMs < statSync(APP_ICON_SOURCE).mtimeMs;
}

function ensureFloatAppIcon() {
  if (!existsSync(APP_ICON_SOURCE)) {
    console.error(`Vibemeter: macOS app icon missing: ${APP_ICON_SOURCE}`);
    return false;
  }
  mkdirSync(APP_RESOURCES_DIR, { recursive: true });
  if (appIconNeedsRefresh()) {
    copyFileSync(APP_ICON_SOURCE, APP_ICON_FILE);
  }
  return true;
}

function compileFloatBinary() {
  const arch = currentMacBinaryArch();
  const target = `${arch}-apple-macos11.0`;
  const result = spawnSync('/usr/bin/swiftc', ['-target', target, FLOAT_SWIFT, '-o', APP_BINARY], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status === 0 && hasCurrentMacArchitecture()) return true;

  const got = floatBinaryArchitectures().join(', ') || 'unknown';
  console.error(`Vibemeter: swiftc did not produce a native ${arch} floating app (built: ${got}).`);
  return false;
}

function resolveFloatBinary() {
  if (!existsSync(FLOAT_SWIFT)) return null;
  const stale = !existsSync(APP_BINARY)
    || statSync(APP_BINARY).mtimeMs < statSync(FLOAT_SWIFT).mtimeMs
    || !existsSync(APP_INFO_PLIST)
    || !appInfoPlistHasIcon()
    || appIconNeedsRefresh()
    || !hasCurrentMacArchitecture();
  if (!stale && existsSync(APP_INFO_PLIST)) return APP_BINARY;

  mkdirSync(dirname(APP_BINARY), { recursive: true });
  writeFileSync(APP_INFO_PLIST, infoPlistXml());
  ensureFloatAppIcon();
  if (!compileFloatBinary()) return null;
  syncInstalledCopy();
  return APP_BINARY;
}

// macOS-only: copy ~/.vibemeter/Vibemeter.app into /Applications so Spotlight,
// Launchpad, and Finder search find it. We use a real copy (not a symlink)
// because Spotlight's indexer doesn't reliably traverse symlinked .app bundles
// — users would install Vibemeter and still not find it via Cmd+Space. To
// keep the copy fresh after swiftc rebuilds, `resolveFloatBinary()` calls
// `syncInstalledCopy()` whenever it recompiles.
function installApp(args) {
  if (platform() !== 'darwin') {
    console.error('install-app is macOS-only.');
    process.exit(1);
  }
  const nameIdx = args.indexOf('--name');
  const customName = nameIdx >= 0 ? args[nameIdx + 1] : null;
  const force = args.includes('--force');
  const remove = args.includes('--uninstall') || args.includes('--remove');
  const dest = join('/Applications', customName || 'Vibemeter.app');

  if (remove) {
    if (!existsSync(dest) && !isBrokenSymlink(dest)) {
      console.log(`Nothing at ${dest}.`);
      return;
    }
    if (!isOurInstalledApp(dest) && !force) {
      console.error(`${dest} is not a Vibemeter install — refusing to remove without --force.`);
      process.exit(1);
    }
    rmSync(dest, { recursive: true, force: true });
    console.log(`✓ Removed ${dest}`);
    return;
  }

  const binary = resolveFloatBinary();
  if (!binary) {
    console.error('Could not build ~/.vibemeter/Vibemeter.app (swiftc failed). Run `vibemeter float` first to see the error.');
    process.exit(1);
  }

  if (existsSync(dest) || isBrokenSymlink(dest)) {
    if (!isOurInstalledApp(dest) && !force) {
      const otherId = readBundleId(dest);
      console.error(`${dest} already exists (CFBundleIdentifier=${otherId ?? 'unknown'}).`);
      console.error(`Pass --force to replace it, or use --name "Vibemeter Float.app" to install under a different name.`);
      process.exit(1);
    }
    rmSync(dest, { recursive: true, force: true });
  }

  if (!copyBundle(APP_BUNDLE, dest)) {
    process.exit(1);
  }
  refreshLaunchServices(dest);
  console.log(`✓ Installed ${dest}`);
  console.log('  Spotlight / Launchpad should pick it up within a few seconds.');
  console.log('  Remove with: vibemeter install-app --uninstall');
}

// Use macOS's `ditto` for .app copies — it preserves bundle metadata and
// extended attributes that a recursive `cp` can drop, which Launch Services
// occasionally cares about.
function copyBundle(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const result = spawnSync('/usr/bin/ditto', [src, dest], { stdio: 'inherit' });
  if (result.status === 0) return true;
  console.error(`Failed to copy ${src} → ${dest} (ditto exit ${result.status}).`);
  return false;
}

// Refresh /Applications/Vibemeter.app after a swiftc rebuild so users
// launching from Spotlight don't get a stale binary.
function syncInstalledCopy() {
  if (platform() !== 'darwin') return;
  const dest = INSTALLED_APP_DEFAULT;
  if (!isOurInstalledApp(dest)) return;
  rmSync(dest, { recursive: true, force: true });
  if (copyBundle(APP_BUNDLE, dest)) {
    refreshLaunchServices(dest);
  }
}

function isBrokenSymlink(p) {
  try { lstatSync(p); return true; } catch { return false; }
}

// True if `p` is a Vibemeter install we own: either the legacy symlink
// (pre-0.2.x) pointing at APP_BUNDLE, or a real copy carrying our bundle id.
function isOurInstalledApp(p) {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      return readlinkSync(p) === APP_BUNDLE;
    }
    return readBundleId(p) === BUNDLE_ID;
  } catch { return false; }
}

function readBundleId(appPath) {
  const plistPath = join(appPath, 'Contents', 'Info.plist');
  if (!existsSync(plistPath)) return null;
  const out = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plistPath], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : null;
}

function refreshLaunchServices(appPath) {
  spawnSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', appPath], { stdio: 'ignore' });
}

function openFloat() {
  const url = `http://localhost:${PORT}/float`;
  if (platform() === 'darwin') {
    // Singleton check: if a Vibemeter floater is already running, just bring
    // it to the front. Catches the case where swiftc rebuild hasn't happened
    // yet so the running binary lacks the in-process singleton guard.
    const existing = spawnSync('pgrep', ['-f', `${APP_BUNDLE}/Contents/MacOS/Vibemeter`], { encoding: 'utf8' });
    if (existing.status === 0 && existing.stdout.trim()) {
      spawnSync('open', ['-b', 'com.hirra.vibemeter'], { stdio: 'ignore' });
      console.log(`Vibemeter floating window already running (${url}) — focused.`);
      return;
    }
    const binary = resolveFloatBinary();
    const native = binary
      ? spawn(binary, [url], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, VIBEMETER_DATA_DIR: DATA_DIR },
        })
      : null;
    if (native) {
      native.unref();
      console.log(`✓ Opened Vibemeter floating window (${url})`);
      return;
    }

    const app = spawnSync('open', ['-na', 'Google Chrome', '--args', `--app=${url}`, '--window-size=260,380'], { stdio: 'inherit' });
    if (app.status === 0) return;
    spawnSync('open', [url], { stdio: 'inherit' });
    return;
  }
  if (platform() === 'linux') {
    spawnSync('xdg-open', [url], { stdio: 'inherit' });
    return;
  }
  console.log(url);
}

async function pulse(args) {
  const asJson = args.includes('--json');
  const payload = await fetchDaemonJson('/api/float');
  if (asJson) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return;
  }
  const lines = [];
  const fmtPct = (v) => v == null ? '--' : `${v}%`;
  const fmtPace = (q) => {
    if (q?.pace5hExhaustMin != null) return `  pace: exhausts in ~${q.pace5hExhaustMin}m`;
    if (q?.pace5hPctPerMin != null && q.pace5hPctPerMin <= 0) return '  pace: idle';
    return '';
  };
  for (const q of payload.quotas ?? []) {
    const head = q.accountLabel ? `${q.label} (${q.accountLabel})` : q.label;
    lines.push(`${head}`);
    lines.push(`  5h:    ${fmtPct(q.remaining5h)} remaining  · used ${fmtPct(q.used5h)}`);
    lines.push(`  week:  ${fmtPct(q.remainingWeekly)} remaining · used ${fmtPct(q.usedWeekly)}`);
    const pace = fmtPace(q);
    if (pace) lines.push(pace);
    lines.push('');
  }
  lines.push(`today: ${payload.todaySessions} sessions · total: ${payload.totalSessions}`);
  process.stdout.write(lines.join('\n') + '\n');
  await printCardNudge();
}

async function fetchDaemonJson(endpoint) {
  const url = `http://localhost:${PORT}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.error(`Vibemeter daemon not reachable at ${url}: ${e.message}`);
    console.error('Hint: run `vibemeter start` (or `vibemeter install` for autostart).');
    process.exit(2);
  }
}

async function fetchDaemonText(endpoint) {
  const url = `http://localhost:${PORT}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.error(`Vibemeter daemon not reachable at ${url}: ${e.message}`);
    console.error('Hint: run `vibemeter start` (or `vibemeter install` for autostart).');
    process.exit(2);
  }
}

function argValue(args, names) {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0) return args[i + 1] ?? null;
  }
  return null;
}

function recapPeriodFromArgs(args) {
  const raw = argValue(args, ['--period']);
  if (args.includes('--month') || raw === 'month') return 'month';
  return '7d';
}

function recapVariantFromArgs(args) {
  const raw = argValue(args, ['--size', '--variant']);
  if (args.includes('--square') || raw === 'square') return 'square';
  return 'landscape';
}

function defaultCardPath(period, variant) {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = variant === 'square' ? '1080x1080' : '1200x675';
  const dir = join(DATA_DIR, 'cards');
  mkdirSync(dir, { recursive: true });
  return join(dir, `vibemeter-recap-${period}-${suffix}-${stamp}.png`);
}

function renderSvgFileToPng(svg, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = join(DATA_DIR, `recap-${process.pid}-${Date.now()}.svg`);
  writeFileSync(tmp, svg);
  try {
    let result = null;
    if (platform() === 'darwin' && existsSync('/usr/bin/sips')) {
      result = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', tmp, '--out', outPath], { encoding: 'utf8' });
    } else {
      result = spawnSync('rsvg-convert', ['-f', 'png', '-o', outPath, tmp], { encoding: 'utf8' });
    }
    if (result.status !== 0 || !existsSync(outPath)) {
      const detail = result.stderr?.trim() || result.error?.message || `exit ${result.status}`;
      throw new Error(`PNG render failed: ${detail}`);
    }
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function cardCommand(args) {
  const period = recapPeriodFromArgs(args);
  const variant = recapVariantFromArgs(args);
  const out = argValue(args, ['--out', '-o']) ?? defaultCardPath(period, variant);
  const svg = await fetchDaemonText(`/api/recap-card/svg?period=${encodeURIComponent(period)}&variant=${encodeURIComponent(variant)}`);
  try {
    renderSvgFileToPng(svg, out);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'PNG render failed');
    if (platform() !== 'darwin') {
      console.error('Hint: install `rsvg-convert` or run this command on macOS.');
    }
    process.exit(1);
  }
  console.log(out);
}

async function printCardNudge() {
  try {
    const payload = await fetchDaemonJson('/api/recap-card?period=7d');
    const card = payload.card;
    if (!card?.minimumData?.ok) return;
    if (card.roiMultiplier != null) {
      console.log(`\n  ${card.roiMultiplier}x return this week - run \`vibemeter card\` to make a shareable recap.`);
    } else if (card.valueAtApiRatesUsd > 0) {
      console.log(`\n  $${card.valueAtApiRatesUsd.toFixed(2)} API-equivalent value this week - run \`vibemeter card\` to make a shareable recap.`);
    }
  } catch {
    // Keep the primary stats output clean if the recap endpoint is unavailable.
  }
}

function statusGlyph(status) {
  switch (status) {
    case 'safe': return 'OK';
    case 'watch': return 'WATCH';
    case 'risky': return 'RISKY';
    case 'wait': return 'WAIT';
    case 'ready': return 'OK';
    case 'needs_setup': return 'SETUP';
    case 'missing': return 'MISSING';
    default: return 'UNKNOWN';
  }
}

function fmtPct(value) {
  return value == null ? '--' : `${Math.max(0, Math.round(value))}%`;
}

async function guard(args) {
  const asJson = args.includes('--json');
  const payload = await fetchDaemonJson('/api/guard');
  if (asJson) {
    process.stdout.write(JSON.stringify(payload.guard, null, 2) + '\n');
    return;
  }
  const g = payload.guard;
  console.log('');
  console.log(`  Quota guard: ${statusGlyph(g.status)} · ${g.headline}`);
  console.log(`  ${g.detail}`);
  console.log('');
  for (const q of g.quotas ?? []) {
    const label = q.accountLabel ? `${q.label} (${q.accountLabel})` : q.label;
    const pace = q.pace5hExhaustMin == null ? '' : ` · pace exhausts in ~${q.pace5hExhaustMin}m`;
    console.log(`  ${label}`);
    console.log(`    5h ${fmtPct(q.remaining5h)} left · weekly ${fmtPct(q.remainingWeekly)} left${pace}`);
  }
  if (!g.quotas?.length) console.log('  No quota snapshot yet.');
  console.log('');
}

async function shareReport(args) {
  const asJson = args.includes('--json');
  const payload = await fetchDaemonJson('/api/report');
  const report = payload.report;
  process.stdout.write((asJson ? JSON.stringify(report, null, 2) : report.markdown) + '\n');
}

function dirExists(filePath) {
  try { return statSync(filePath).isDirectory(); } catch { return false; }
}

function fileExists(filePath) {
  try { return statSync(filePath).isFile(); } catch { return false; }
}

function countFiles(root, predicate, limit = 500) {
  let count = 0;
  function walk(dir) {
    if (count >= limit) return;
    let entries = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (count >= limit) return;
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (predicate(entry)) count += 1;
    }
  }
  if (dirExists(root)) walk(root);
  return count;
}

async function daemonReachable() {
  try {
    const res = await fetch(`http://localhost:${PORT}/api/float`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function doctor(args) {
  const asJson = args.includes('--json');
  const claudeProjects = join(homedir(), '.claude', 'projects');
  const codexSessions = join(homedir(), '.codex', 'sessions');
  const codexState = join(homedir(), '.codex', 'state_5.sqlite');
  const cursorStorage = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage');
  const statusline = join(DATA_DIR, 'statusline-latest.json');
  const dbPath = join(DATA_DIR, 'continuity.sqlite');
  const notify = notifyStatusObject();
  const claudeLogs = countFiles(claudeProjects, (name) => name.endsWith('.jsonl'), 300);
  const codexRollouts = countFiles(codexSessions, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 300);
  const cursorDbs = countFiles(cursorStorage, (name) => name === 'state.vscdb', 300);
  const daemon = await daemonReachable();

  const checks = [
    { id: 'daemon', label: 'Dashboard daemon', status: daemon ? 'ready' : 'needs_setup', detail: daemon ? `http://localhost:${PORT} is reachable` : `http://localhost:${PORT} is not reachable`, hint: 'Run `vibemeter start` or `vibemeter install`.' },
    { id: 'data-store', label: 'Vibemeter data store', status: fileExists(dbPath) ? 'ready' : 'needs_setup', detail: fileExists(dbPath) ? 'Local SQLite database exists' : 'Local database has not been created yet', hint: 'Open the dashboard or run `vibemeter` once.' },
    { id: 'claude-sessions', label: 'Claude Code sessions', status: claudeLogs > 0 ? 'ready' : 'needs_setup', detail: claudeLogs > 0 ? `${claudeLogs} session logs found` : 'No Claude Code session logs found', hint: 'Run Claude Code once, then refresh Vibemeter.' },
    { id: 'claude-statusline', label: 'Claude quota statusline', status: fileExists(statusline) ? 'ready' : 'needs_setup', detail: fileExists(statusline) ? 'Latest statusline quota snapshot exists' : 'No Claude Code quota snapshot found', hint: 'Add the README statusLine hook.' },
    { id: 'codex-state', label: 'Codex state database', status: fileExists(codexState) ? 'ready' : 'needs_setup', detail: fileExists(codexState) ? 'Codex state_5.sqlite found' : 'Codex state_5.sqlite not found', hint: 'Run Codex once.' },
    { id: 'codex-rollouts', label: 'Codex quota rollouts', status: codexRollouts > 0 ? 'ready' : 'needs_setup', detail: codexRollouts > 0 ? `${codexRollouts} rollout files found` : 'No Codex rollout rate-limit files found', hint: 'Run Codex once.' },
    { id: 'cursor-storage', label: 'Cursor workspace storage', status: cursorDbs > 0 ? 'ready' : 'unknown', detail: cursorDbs > 0 ? `${cursorDbs} Cursor workspace DBs found` : 'Cursor data not found; fine if unused' },
    { id: 'completion-notify', label: 'Completion notifications', status: notify.claudeStop || notify.codex ? 'ready' : 'needs_setup', detail: `Claude ${notify.claudeStop ? 'ready' : 'off'}, Codex ${notify.codex ? 'ready' : 'off'}`, hint: 'Run `vibemeter notify-install`.' },
  ];
  const ready = checks.filter((item) => item.status === 'ready').length;
  const report = {
    generatedAt: Date.now(),
    overall: ready >= checks.length - 2 ? 'ready' : ready >= 3 ? 'needs_setup' : 'missing',
    ready,
    needsAttention: checks.filter((item) => item.status === 'needs_setup' || item.status === 'missing').length,
    checks,
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  console.log('');
  console.log(`  First-run doctor: ${statusGlyph(report.overall)} · ${report.ready}/${report.checks.length} ready`);
  console.log('');
  for (const item of report.checks) {
    console.log(`  ${statusGlyph(item.status).padEnd(7)} ${item.label}`);
    console.log(`          ${item.detail}`);
    if (item.status !== 'ready' && item.hint) console.log(`          ${item.hint}`);
  }
  console.log('');
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

// ── voice notifications ──────────────────────────────────────────────────

function timestampTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupOnce(path, tag) {
  if (!existsSync(path)) return null;
  const bak = `${path}.bak-vibemeter-${tag}`;
  copyFileSync(path, bak);
  return bak;
}

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function writeJsonPretty(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function buildHookCommand(locale = 'zh', soundMode = 'voice') {
  // Hook commands inherit a restricted PATH; absolute path is required.
  // Locale + sound-mode envs are baked into the command so the bash speaker
  // picks the right phrases / sound style without reading another config file.
  const envs = [`VIBEMETER_NOTIFY_LOCALE=${shellQuote(locale)}`];
  if (soundMode !== 'voice') envs.push(`VIBEMETER_NOTIFY_SOUND_MODE=${shellQuote(soundMode)}`);
  return `${envs.join(' ')} ${shellQuote(NOTIFY_SCRIPT)} Claude`;
}

function shellQuote(s) {
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function ensureClaudeHook(settings, eventName, statusArg, locale, soundMode) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  const list = Array.isArray(settings.hooks[eventName]) ? settings.hooks[eventName] : [];
  const command = `${buildHookCommand(locale, soundMode)} ${statusArg}`;
  // Replace any existing Vibemeter hook so re-applying with a new locale
  // updates the env prefix in place.
  const filtered = list
    .map((entry) => {
      if (!Array.isArray(entry?.hooks)) return entry;
      const kept = entry.hooks.filter((h) => !(typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)));
      return kept.length ? { ...entry, hooks: kept } : null;
    })
    .filter(Boolean);
  filtered.push({ hooks: [{ type: 'command', command, async: true }] });
  settings.hooks[eventName] = filtered;
  return true;
}

function stripClaudeHook(settings, eventName) {
  if (!settings.hooks || !Array.isArray(settings.hooks[eventName])) return false;
  const before = settings.hooks[eventName];
  const after = before
    .map((entry) => {
      if (!Array.isArray(entry?.hooks)) return entry;
      const kept = entry.hooks.filter((h) => !(typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)));
      return kept.length ? { ...entry, hooks: kept } : null;
    })
    .filter(Boolean);
  if (after.length === before.length && after.every((e, i) => e === before[i])) return false;
  if (after.length === 0) delete settings.hooks[eventName];
  else settings.hooks[eventName] = after;
  return true;
}

function installClaudeHooks({ stop, notification, locale = 'zh', soundMode = 'voice' }) {
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH) ?? {};
  let changed = false;
  if (stop) changed = ensureClaudeHook(settings, 'Stop', 'complete', locale, soundMode) || changed;
  if (notification) changed = ensureClaudeHook(settings, 'Notification', 'needs_input', locale, soundMode) || changed;
  if (!changed) return { changed: false, backup: null };
  const backup = backupOnce(CLAUDE_SETTINGS_PATH, timestampTag());
  writeJsonPretty(CLAUDE_SETTINGS_PATH, settings);
  return { changed: true, backup };
}

function uninstallClaudeHooks() {
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH);
  if (!settings) return { changed: false, backup: null };
  const removedStop = stripClaudeHook(settings, 'Stop');
  const removedNotif = stripClaudeHook(settings, 'Notification');
  if (!removedStop && !removedNotif) return { changed: false, backup: null };
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  const backup = backupOnce(CLAUDE_SETTINGS_PATH, timestampTag());
  writeJsonPretty(CLAUDE_SETTINGS_PATH, settings);
  return { changed: true, backup };
}

function codexNotifyLine(locale = 'zh', soundMode = 'voice') {
  return `notify = ${JSON.stringify(codexNotifyArgs(locale, soundMode))}`;
}

function codexNotifyArgs(locale = 'zh', soundMode = 'voice') {
  // Codex's notify config is an exec array — locale prefix needs a sh -c wrapper.
  const envPrefix = soundMode === 'voice'
    ? `VIBEMETER_NOTIFY_LOCALE=${locale}`
    : `VIBEMETER_NOTIFY_LOCALE=${locale} VIBEMETER_NOTIFY_SOUND_MODE=${soundMode}`;
  return ['sh', '-c', `${envPrefix} ${NOTIFY_SCRIPT.replace(/'/g, `'\\''`)} Codex complete`];
}

function parseCodexNotifyArgs(line) {
  const match = line.match(/^\s*notify\s*=\s*(\[[\s\S]*\])\s*$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function updateCodexNotifyLine(line, locale = 'zh', soundMode = 'voice') {
  if (!line.includes(HOOK_MARKER)) return null;
  const args = parseCodexNotifyArgs(line);
  if (args) {
    const previousNotifyIndex = args.indexOf('--previous-notify');
    const previousNotify = args[previousNotifyIndex + 1];
    if (previousNotifyIndex >= 0 && typeof previousNotify === 'string' && previousNotify.includes(HOOK_MARKER)) {
      args[previousNotifyIndex + 1] = JSON.stringify(codexNotifyArgs(locale, soundMode));
      return `notify = ${JSON.stringify(args)}`;
    }
  }
  return codexNotifyLine(locale, soundMode);
}

function stripVibemeterFromCodexNotifyLine(line) {
  if (!line.includes(HOOK_MARKER)) return undefined;
  const args = parseCodexNotifyArgs(line);
  if (args) {
    const previousNotifyIndex = args.indexOf('--previous-notify');
    const previousNotify = args[previousNotifyIndex + 1];
    if (previousNotifyIndex >= 0 && typeof previousNotify === 'string' && previousNotify.includes(HOOK_MARKER)) {
      args.splice(previousNotifyIndex, 2);
      return `notify = ${JSON.stringify(args)}`;
    }
  }
  return null;
}

function installCodexNotify(locale = 'zh', soundMode = 'voice') {
  if (!existsSync(CODEX_CONFIG_PATH)) {
    return { changed: false, backup: null, skipped: 'no-config' };
  }
  const original = readFileSync(CODEX_CONFIG_PATH, 'utf8');
  const lines = original.split(/\r?\n/);
  // Find top-level `notify = ...` (before any [section] header).
  let notifyIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\[/.test(line)) break;
    if (/^\s*notify\s*=/.test(line)) { notifyIndex = i; break; }
  }
  const want = codexNotifyLine(locale, soundMode);
  if (notifyIndex >= 0) {
    const updated = updateCodexNotifyLine(lines[notifyIndex], locale, soundMode);
    if (lines[notifyIndex].trim() === want || lines[notifyIndex] === updated) return { changed: false, backup: null };
    if (!updated) {
      return { changed: false, backup: null, skipped: 'foreign-notify', existing: lines[notifyIndex] };
    }
    lines[notifyIndex] = updated;
  } else {
    // Insert before the first [section] header, or at the top if none.
    let insertAt = lines.findIndex((l) => /^\s*\[/.test(l));
    if (insertAt < 0) insertAt = lines.length;
    lines.splice(insertAt, 0, want);
  }
  const backup = backupOnce(CODEX_CONFIG_PATH, timestampTag());
  writeFileSync(CODEX_CONFIG_PATH, lines.join('\n'));
  return { changed: true, backup };
}

function uninstallCodexNotify() {
  if (!existsSync(CODEX_CONFIG_PATH)) return { changed: false, backup: null };
  const original = readFileSync(CODEX_CONFIG_PATH, 'utf8');
  const lines = original.split(/\r?\n/);
  let removed = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    if (/^\s*notify\s*=/.test(lines[i])) {
      const stripped = stripVibemeterFromCodexNotifyLine(lines[i]);
      if (stripped === undefined) continue;
      if (stripped === null) lines.splice(i, 1);
      else lines[i] = stripped;
      removed = true;
      break;
    }
  }
  if (!removed) return { changed: false, backup: null };
  const backup = backupOnce(CODEX_CONFIG_PATH, timestampTag());
  writeFileSync(CODEX_CONFIG_PATH, lines.join('\n'));
  return { changed: true, backup };
}

function notifyInstall(opts = {}) {
  const { stop = true, notification = false, codex = true, locale = process.env.VIBEMETER_NOTIFY_LOCALE || 'zh', soundMode = 'voice' } = opts;
  if (!existsSync(NOTIFY_SCRIPT)) {
    console.error(`Notify script missing: ${NOTIFY_SCRIPT}`);
    process.exit(1);
  }
  // Build the .app bundle eagerly so the very first hook firing can use the
  // native notification path instead of falling back to osascript.
  if (platform() === 'darwin') resolveFloatBinary();
  const cl = installClaudeHooks({ stop, notification, locale, soundMode });
  const cx = codex ? installCodexNotify(locale, soundMode) : { changed: false, backup: null, skipped: 'disabled' };
  console.log('');
  console.log('  Vibemeter voice notifications');
  if (cl.changed) console.log(`  ✓ Claude Code hooks updated (${CLAUDE_SETTINGS_PATH})`);
  else console.log(`  · Claude Code hooks already in place`);
  if (cl.backup) console.log(`    backup: ${cl.backup}`);
  if (cx.changed) console.log(`  ✓ Codex notify updated (${CODEX_CONFIG_PATH})`);
  else if (cx.skipped === 'no-config') console.log(`  · Codex config not found — skipped`);
  else if (cx.skipped === 'foreign-notify') console.log(`  ! Codex notify already set to: ${cx.existing} — left as-is`);
  else if (cx.skipped === 'disabled') console.log(`  · Codex notify left unchanged`);
  else console.log(`  · Codex notify already pointing to Vibemeter`);
  if (cx.backup) console.log(`    backup: ${cx.backup}`);
  console.log('');
  console.log('  Open http://localhost:' + PORT + '/settings to change voice or disable.');
}

function notifyUninstall() {
  const cl = uninstallClaudeHooks();
  const cx = uninstallCodexNotify();
  console.log('');
  if (cl.changed) console.log(`  ✓ Removed Vibemeter hooks from ${CLAUDE_SETTINGS_PATH}`);
  else console.log(`  · No Vibemeter hooks in ${CLAUDE_SETTINGS_PATH}`);
  if (cl.backup) console.log(`    backup: ${cl.backup}`);
  if (cx.changed) console.log(`  ✓ Removed Vibemeter notify from ${CODEX_CONFIG_PATH}`);
  else console.log(`  · No Vibemeter notify in ${CODEX_CONFIG_PATH}`);
  if (cx.backup) console.log(`    backup: ${cx.backup}`);
  console.log('');
}

function notifyStatusObject() {
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH);
  const hasClaudeHook = (event) => {
    const list = settings?.hooks?.[event];
    if (!Array.isArray(list)) return false;
    return list.some((entry) =>
      Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)),
    );
  };
  let codexInstalled = false;
  let codexForeign = null;
  if (existsSync(CODEX_CONFIG_PATH)) {
    const lines = readFileSync(CODEX_CONFIG_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*\[/.test(line)) break;
      if (/^\s*notify\s*=/.test(line)) {
        if (line.includes(HOOK_MARKER)) codexInstalled = true;
        else codexForeign = line.trim();
        break;
      }
    }
  }
  return {
    scriptPath: NOTIFY_SCRIPT,
    claudeSettingsPath: CLAUDE_SETTINGS_PATH,
    codexConfigPath: CODEX_CONFIG_PATH,
    claudeStop: hasClaudeHook('Stop'),
    claudeNotification: hasClaudeHook('Notification'),
    codex: codexInstalled,
    codexForeign,
    codexConfigExists: existsSync(CODEX_CONFIG_PATH),
  };
}

function notifyStatus() {
  const s = notifyStatusObject();
  console.log('');
  console.log(`  Voice notification status`);
  console.log(`  ───────────────────────────`);
  console.log(`  Claude Stop hook:         ${s.claudeStop ? '✓ installed' : '· not installed'}`);
  console.log(`  Claude Notification hook: ${s.claudeNotification ? '✓ installed' : '· not installed'}`);
  console.log(`  Codex notify:             ${s.codex ? '✓ installed' : s.codexForeign ? `! foreign (${s.codexForeign})` : s.codexConfigExists ? '· not installed' : '· no codex config'}`);
  console.log(`  Script:                   ${s.scriptPath}`);
  console.log('');
}

async function promptYesNo(question, defaultYes = true) {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
  return new Promise((resolve) => {
    rl.question(question + suffix, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

async function offerNotifyDuringInstall() {
  if (platform() !== 'darwin') return;
  const s = notifyStatusObject();
  if (s.claudeStop && s.codex) return; // already wired
  if (!process.stdin.isTTY) {
    console.log('');
    console.log('  Voice notifications available — visit http://localhost:' + PORT + '/settings to enable.');
    return;
  }
  console.log('');
  const enable = await promptYesNo('Enable voice notifications for Claude Code + Codex?', true);
  if (!enable) {
    console.log('  Skipped. You can enable later from http://localhost:' + PORT + '/settings');
    return;
  }
  notifyInstall({ stop: true, notification: false, codex: true });
}

// ── end voice notifications ──────────────────────────────────────────────

function help() {
  console.log(`
Vibemeter — local AI coding dashboard

Usage:
  vibemeter                  start the server in the foreground (Ctrl-C to stop)
  vibemeter install          run on login + keep alive (macOS LaunchAgent)
  vibemeter float            open the desktop floating widget
  vibemeter uninstall        remove the auto-start config
  vibemeter status           show whether the daemon is loaded + tail logs
  vibemeter pulse [--json]   print current 5h/weekly usage from running daemon
  vibemeter guard [--json]   say whether starting a long agent task is safe
  vibemeter card             render a shareable weekly recap PNG
  vibemeter wrapped          alias for card
  vibemeter report [--json]  print a local Markdown usage report
  vibemeter doctor [--json]  check local data sources and setup gaps
  vibemeter notify <t> <s>   speak a notification (used by hooks)
  vibemeter notify-install   wire Vibemeter into Claude Code + Codex
  vibemeter notify-uninstall remove Vibemeter from Claude Code + Codex
  vibemeter notify-status    show which voice hooks are installed
  vibemeter install-app      copy ~/.vibemeter/Vibemeter.app into /Applications (macOS)
  vibemeter help             this message

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
    if (platform() === 'darwin') {
      macInstall();
      await offerNotifyDuringInstall();
    }
    else if (platform() === 'linux') linuxInstallHint();
    else { console.error('Auto-start install not implemented for this platform yet.'); process.exit(1); }
    break;
  case 'notify': {
    if (platform() !== 'darwin') {
      console.error('Voice notifications are macOS-only right now.');
      process.exit(1);
    }
    const tool = process.argv[3] ?? 'AI';
    const status = process.argv[4] ?? 'complete';
    const r = spawnSync(NOTIFY_SCRIPT, [tool, status], { stdio: 'inherit' });
    process.exit(r.status ?? 0);
  }
  case 'notify-install': {
    if (platform() !== 'darwin') { console.error('macOS only.'); process.exit(1); }
    const argv = process.argv.slice(3);
    const smIdx = argv.indexOf('--sound-mode');
    const rawMode = smIdx >= 0 ? argv[smIdx + 1] : 'voice';
    const soundMode = ['voice', 'beep', 'off'].includes(rawMode) ? rawMode : 'voice';
    notifyInstall({ stop: true, notification: false, codex: true, soundMode });
    break;
  }
  case 'notify-uninstall':
    if (platform() !== 'darwin') { console.error('macOS only.'); process.exit(1); }
    notifyUninstall();
    break;
  case 'notify-status':
    notifyStatus();
    break;
  case 'float':
    openFloat();
    break;
  case 'install-app':
    installApp(process.argv.slice(3));
    break;
  case 'pulse':
    await pulse(process.argv.slice(3));
    break;
  case 'guard':
    await guard(process.argv.slice(3));
    break;
  case 'card':
  case 'wrapped':
    await cardCommand(process.argv.slice(3));
    break;
  case 'report':
    await shareReport(process.argv.slice(3));
    break;
  case 'doctor':
    await doctor(process.argv.slice(3));
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

// Server-side helpers for managing the macOS voice-notification hooks that
// Vibemeter installs into Claude Code and Codex. The CLI in bin/vibemeter.mjs
// implements the same operations for terminal use; this module is the path
// that the /settings UI calls through the API.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const HOOK_MARKER = 'vibemeter-notify.sh';
const NOTIFY_SCRIPT = resolve(process.cwd(), 'bin', 'vibemeter-notify.sh');
const FLOAT_SWIFT = resolve(process.cwd(), 'bin', 'vibemeter-float.swift');
const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const CODEX_CONFIG_PATH = join(homedir(), '.codex', 'config.toml');
const DATA_DIR = process.env.VIBEMETER_DATA_DIR ?? join(homedir(), '.vibemeter');
const APP_BUNDLE = join(DATA_DIR, 'Vibemeter.app');
const APP_BINARY = join(APP_BUNDLE, 'Contents', 'MacOS', 'Vibemeter');
const APP_INFO_PLIST = join(APP_BUNDLE, 'Contents', 'Info.plist');

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Vibemeter</string>
  <key>CFBundleDisplayName</key><string>Vibemeter</string>
  <key>CFBundleIdentifier</key><string>com.hirra.vibemeter</string>
  <key>CFBundleExecutable</key><string>Vibemeter</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

function currentMacBinaryArch(): 'arm64' | 'x86_64' {
  const appleSilicon = spawnSync('/usr/sbin/sysctl', ['-in', 'hw.optional.arm64'], { encoding: 'utf8' });
  if (appleSilicon.status === 0 && appleSilicon.stdout.trim() === '1') return 'arm64';

  const uname = spawnSync('/usr/bin/uname', ['-m'], { encoding: 'utf8' });
  return uname.stdout.trim() === 'arm64' ? 'arm64' : 'x86_64';
}

function appBinaryArchitectures(): string[] {
  const result = spawnSync('/usr/bin/lipo', ['-archs', APP_BINARY], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function hasCurrentMacArchitecture(): boolean {
  return appBinaryArchitectures().includes(currentMacBinaryArch());
}

function compileAppBundle(): { ok: boolean; error?: string } {
  const arch = currentMacBinaryArch();
  const target = `${arch}-apple-macos11.0`;
  const result = spawnSync('/usr/bin/swiftc', ['-target', target, FLOAT_SWIFT, '-o', APP_BINARY], { encoding: 'utf8' });
  if (result.status === 0 && hasCurrentMacArchitecture()) return { ok: true };

  const got = appBinaryArchitectures().join(', ') || 'unknown';
  const detail = result.stderr?.trim() || result.error?.message || `swiftc exit ${result.status}`;
  return { ok: false, error: `${detail}; built ${got}, expected ${arch}` };
}

function ensureAppBundle(): { built: boolean; path: string | null; error?: string } {
  if (!existsSync(FLOAT_SWIFT)) return { built: false, path: null, error: 'float swift source missing' };
  const stale = !existsSync(APP_BINARY)
    || statSync(APP_BINARY).mtimeMs < statSync(FLOAT_SWIFT).mtimeMs
    || !existsSync(APP_INFO_PLIST)
    || !hasCurrentMacArchitecture();
  if (!stale && existsSync(APP_INFO_PLIST)) return { built: false, path: APP_BINARY };
  mkdirSync(dirname(APP_BINARY), { recursive: true });
  writeFileSync(APP_INFO_PLIST, INFO_PLIST);
  const compiled = compileAppBundle();
  if (!compiled.ok) return { built: false, path: null, error: compiled.error };
  return { built: true, path: APP_BINARY };
}

function osascriptEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function sendNativeNotification(title: string, body: string, threadId = 'vibemeter'): { ok: boolean; message: string } {
  const app = ensureAppBundle();
  if (app.path) {
    const result = spawnSync(app.path, ['--notify', title, body, threadId], { stdio: 'ignore' });
    if (result.status === 0) return { ok: true, message: 'sent' };
  }

  const fallback = spawnSync('osascript', [
    '-e',
    `display notification "${osascriptEscape(body)}" with title "${osascriptEscape(title)}"`,
  ], { stdio: 'ignore' });
  if (fallback.status === 0) return { ok: true, message: 'sent via osascript' };
  return { ok: false, message: app.error ?? 'notification failed' };
}

export type SoundMode = 'voice' | 'beep' | 'off';

export type NotifyStatus = {
  scriptPath: string;
  scriptExists: boolean;
  claudeSettingsPath: string;
  codexConfigPath: string;
  claudeStop: boolean;
  claudeNotification: boolean;
  codex: boolean;
  codexForeign: string | null;
  codexConfigExists: boolean;
  soundMode: SoundMode;
};

type ClaudeHookEntry = { hooks?: Array<{ type?: string; command?: string; async?: boolean }> };

function readJsonSafe(path: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function timestampTag() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backupOnce(path: string, tag: string): string | null {
  if (!existsSync(path)) return null;
  const bak = `${path}.bak-vibemeter-${tag}`;
  copyFileSync(path, bak);
  return bak;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function hookCommand(statusArg: string, locale: string, soundMode: SoundMode): string {
  const envs = [`VIBEMETER_NOTIFY_LOCALE=${shellQuote(locale)}`];
  if (soundMode !== 'voice') envs.push(`VIBEMETER_NOTIFY_SOUND_MODE=${shellQuote(soundMode)}`);
  return `${envs.join(' ')} ${shellQuote(NOTIFY_SCRIPT)} Claude ${statusArg}`;
}

function writeJsonPretty(path: string, obj: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

function hasOurHook(settings: Record<string, unknown> | null, event: string): boolean {
  const hooks = (settings?.hooks ?? {}) as Record<string, unknown>;
  const list = hooks[event];
  if (!Array.isArray(list)) return false;
  return (list as ClaudeHookEntry[]).some((entry) =>
    Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)),
  );
}

function ensureHook(settings: Record<string, unknown>, event: string, statusArg: string, locale: string, soundMode: SoundMode): boolean {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown>;
  const list = (Array.isArray(hooks[event]) ? hooks[event] : []) as ClaudeHookEntry[];
  // Replace any existing Vibemeter hook so re-applying with a new locale
  // updates the env prefix in place rather than appending a duplicate.
  const filtered = list
    .map((entry) => {
      if (!Array.isArray(entry?.hooks)) return entry;
      const kept = entry.hooks.filter((h) => !(typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)));
      return kept.length ? { ...entry, hooks: kept } : null;
    })
    .filter((e): e is ClaudeHookEntry => e !== null);
  filtered.push({ hooks: [{ type: 'command', command: hookCommand(statusArg, locale, soundMode), async: true }] });
  hooks[event] = filtered;
  return true;
}

function stripHook(settings: Record<string, unknown>, event: string): boolean {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const list = hooks[event];
  if (!Array.isArray(list)) return false;
  const before = list as ClaudeHookEntry[];
  const after = before
    .map((entry) => {
      if (!Array.isArray(entry?.hooks)) return entry;
      const kept = entry.hooks.filter((h) => !(typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)));
      return kept.length ? { ...entry, hooks: kept } : null;
    })
    .filter((e): e is ClaudeHookEntry => e !== null);
  if (after.length === before.length) return false;
  if (after.length === 0) delete hooks[event];
  else hooks[event] = after;
  return true;
}

function detectSoundMode(settings: Record<string, unknown> | null, codexLine: string | null): SoundMode {
  const candidates: string[] = [];
  const hooks = (settings?.hooks ?? {}) as Record<string, unknown>;
  for (const event of ['Stop', 'Notification']) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;
    for (const entry of list as ClaudeHookEntry[]) {
      if (!Array.isArray(entry?.hooks)) continue;
      for (const h of entry.hooks) {
        if (typeof h?.command === 'string' && h.command.includes(HOOK_MARKER)) candidates.push(h.command);
      }
    }
  }
  if (codexLine && codexLine.includes(HOOK_MARKER)) candidates.push(codexLine);
  for (const cmd of candidates) {
    const m = cmd.match(/VIBEMETER_NOTIFY_SOUND_MODE=(?:["']?)(voice|beep|off)/);
    if (m) return m[1] as SoundMode;
  }
  return 'voice';
}

export function getNotifyStatus(): NotifyStatus {
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH);
  let codexInstalled = false;
  let codexForeign: string | null = null;
  let codexLine: string | null = null;
  if (existsSync(CODEX_CONFIG_PATH)) {
    const lines = readFileSync(CODEX_CONFIG_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (/^\s*\[/.test(line)) break;
      if (/^\s*notify\s*=/.test(line)) {
        if (line.includes(HOOK_MARKER)) { codexInstalled = true; codexLine = line; }
        else codexForeign = line.trim();
        break;
      }
    }
  }
  return {
    scriptPath: NOTIFY_SCRIPT,
    scriptExists: existsSync(NOTIFY_SCRIPT),
    claudeSettingsPath: CLAUDE_SETTINGS_PATH,
    codexConfigPath: CODEX_CONFIG_PATH,
    claudeStop: hasOurHook(settings, 'Stop'),
    claudeNotification: hasOurHook(settings, 'Notification'),
    codex: codexInstalled,
    codexForeign,
    codexConfigExists: existsSync(CODEX_CONFIG_PATH),
    soundMode: detectSoundMode(settings, codexLine),
  };
}

export function installNotifyHooks(opts: { stop?: boolean; notification?: boolean; codex?: boolean; locale?: string; soundMode?: SoundMode }): {
  changed: boolean;
  claudeBackup: string | null;
  codexBackup: string | null;
  codexSkipped?: 'no-config' | 'foreign-notify';
  codexForeign?: string | null;
  appBundleBuilt?: boolean;
  appBundleError?: string;
} {
  if (!existsSync(NOTIFY_SCRIPT)) {
    throw new Error(`vibemeter-notify.sh not found at ${NOTIFY_SCRIPT}`);
  }
  // Build the bundled .app eagerly so banners are attributed to Vibemeter
  // (with its own icon) rather than falling back to osascript on the first
  // hook firing.
  const app = ensureAppBundle();
  const locale = opts.locale === 'en' ? 'en' : 'zh';
  const soundMode: SoundMode = opts.soundMode === 'beep' || opts.soundMode === 'off' ? opts.soundMode : 'voice';
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH) ?? {};
  let claudeChanged = false;
  if (opts.stop) claudeChanged = ensureHook(settings, 'Stop', 'complete', locale, soundMode) || claudeChanged;
  if (opts.notification) claudeChanged = ensureHook(settings, 'Notification', 'needs_input', locale, soundMode) || claudeChanged;
  let claudeBackup: string | null = null;
  if (claudeChanged) {
    claudeBackup = backupOnce(CLAUDE_SETTINGS_PATH, timestampTag());
    writeJsonPretty(CLAUDE_SETTINGS_PATH, settings);
  }

  let codexBackup: string | null = null;
  let codexSkipped: 'no-config' | 'foreign-notify' | undefined;
  let codexForeign: string | null | undefined;
  let codexChanged = false;
  if (opts.codex) {
    if (!existsSync(CODEX_CONFIG_PATH)) {
      codexSkipped = 'no-config';
    } else {
      const original = readFileSync(CODEX_CONFIG_PATH, 'utf8');
      const lines = original.split(/\r?\n/);
      let notifyIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*\[/.test(lines[i])) break;
        if (/^\s*notify\s*=/.test(lines[i])) { notifyIndex = i; break; }
      }
      const envPrefix = soundMode === 'voice'
        ? `VIBEMETER_NOTIFY_LOCALE=${locale}`
        : `VIBEMETER_NOTIFY_LOCALE=${locale} VIBEMETER_NOTIFY_SOUND_MODE=${soundMode}`;
      const want = `notify = ["sh", "-c", ${JSON.stringify(`${envPrefix} ${NOTIFY_SCRIPT.replace(/'/g, `'\\''`)} Codex complete`)}]`;
      if (notifyIndex >= 0) {
        if (lines[notifyIndex].trim() === want) {
          codexChanged = false;
        } else if (!lines[notifyIndex].includes(HOOK_MARKER)) {
          codexSkipped = 'foreign-notify';
          codexForeign = lines[notifyIndex].trim();
        } else {
          lines[notifyIndex] = want;
          codexChanged = true;
        }
      } else {
        let insertAt = lines.findIndex((l) => /^\s*\[/.test(l));
        if (insertAt < 0) insertAt = lines.length;
        lines.splice(insertAt, 0, want);
        codexChanged = true;
      }
      if (codexChanged) {
        codexBackup = backupOnce(CODEX_CONFIG_PATH, timestampTag());
        writeFileSync(CODEX_CONFIG_PATH, lines.join('\n'));
      }
    }
  }

  return {
    changed: claudeChanged || codexChanged,
    claudeBackup,
    codexBackup,
    codexSkipped,
    codexForeign,
    appBundleBuilt: app.built,
    appBundleError: app.error,
  };
}

export function uninstallNotifyHooks(): {
  changed: boolean;
  claudeBackup: string | null;
  codexBackup: string | null;
} {
  const settings = readJsonSafe(CLAUDE_SETTINGS_PATH);
  let claudeChanged = false;
  if (settings) {
    const stopRemoved = stripHook(settings, 'Stop');
    const notifRemoved = stripHook(settings, 'Notification');
    claudeChanged = stopRemoved || notifRemoved;
    if (claudeChanged && settings.hooks && typeof settings.hooks === 'object' && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }
  let claudeBackup: string | null = null;
  if (claudeChanged) {
    claudeBackup = backupOnce(CLAUDE_SETTINGS_PATH, timestampTag());
    writeJsonPretty(CLAUDE_SETTINGS_PATH, settings as Record<string, unknown>);
  }

  let codexBackup: string | null = null;
  let codexChanged = false;
  if (existsSync(CODEX_CONFIG_PATH)) {
    const lines = readFileSync(CODEX_CONFIG_PATH, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*\[/.test(lines[i])) break;
      if (/^\s*notify\s*=/.test(lines[i]) && lines[i].includes(HOOK_MARKER)) {
        lines.splice(i, 1);
        codexChanged = true;
        break;
      }
    }
    if (codexChanged) {
      codexBackup = backupOnce(CODEX_CONFIG_PATH, timestampTag());
      writeFileSync(CODEX_CONFIG_PATH, lines.join('\n'));
    }
  }

  return { changed: claudeChanged || codexChanged, claudeBackup, codexBackup };
}

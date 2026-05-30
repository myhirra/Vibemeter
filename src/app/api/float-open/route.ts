import { NextResponse } from 'next/server';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { dataDir } from '@/lib/data-dir';
import { LOCALE_COOKIE, normalizeLocale } from '@/lib/i18n/types';
import { ensureFloatAppBundle } from '@/lib/notify-installer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function localeFromCookie(header: string | null) {
  const match = header?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  if (!match) return normalizeLocale(undefined);
  try {
    return normalizeLocale(decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)));
  } catch {
    return normalizeLocale(undefined);
  }
}

function writeFloatLocale(locale: string) {
  spawnSync('defaults', ['write', 'com.hirra.vibemeter', 'VMFloatLocale', locale], { stdio: 'ignore' });
}

/**
 * Spawn (or refocus) the native macOS floater.
 *
 * The .app bundle has LSUIElement=true and no Dock icon — once the user quits
 * it, only a terminal `vibemeter float` brings it back. This endpoint lets the
 * dashboard surface that action as a button.
 */
export async function POST(request: Request) {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'macOS only' }, { status: 400 });
  }
  const locale = localeFromCookie(request.headers.get('cookie'));
  writeFloatLocale(locale);

  const appBundle = path.join(dataDir(), 'Vibemeter.app');
  const app = ensureFloatAppBundle();
  if (!app.path) {
    return NextResponse.json({ error: app.error ?? 'floater binary could not be built' }, { status: 500 });
  }

  const running = spawnSync('pgrep', ['-f', `${appBundle}/Contents/MacOS/Vibemeter`], { encoding: 'utf8' });
  const runningPids = running.stdout.trim().split(/\s+/).filter(Boolean);
  if (runningPids.length > 0 && !app.built) {
    spawnSync('open', ['-b', 'com.hirra.vibemeter'], { stdio: 'ignore' });
    return NextResponse.json({ ok: true, focused: true });
  }
  if (runningPids.length > 0) {
    spawnSync('kill', runningPids, { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const url = new URL('/float', request.url);
  url.searchParams.set('locale', locale);
  try {
    spawn(app.path, [url.toString()], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }).unref();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

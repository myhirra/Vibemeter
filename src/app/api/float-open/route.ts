import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/data-dir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Spawn (or refocus) the native macOS floater.
 *
 * The .app bundle has LSUIElement=true and no Dock icon — once the user quits
 * it, only a terminal `vibemeter float` brings it back. This endpoint lets the
 * dashboard surface that action as a button.
 */
export async function POST() {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'macOS only' }, { status: 400 });
  }
  const binary = path.join(dataDir(), 'Vibemeter.app', 'Contents', 'MacOS', 'Vibemeter');
  if (!existsSync(binary)) {
    return NextResponse.json({ error: 'floater binary not found — run `vibemeter float` once to build it' }, { status: 404 });
  }
  const url = `http://localhost:${process.env.PORT ?? 9527}/float`;
  try {
    spawn(binary, [url], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    }).unref();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

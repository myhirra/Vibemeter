import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Opens a local file or URL in the user's default OS handler. Strictly limited
 * to .jsonl files under ~/.claude/ to keep this from being a generic file-open
 * exfil endpoint for any process that can reach localhost.
 */
export async function POST(request: Request) {
  let body: { path?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const target = body.path;
  if (!target || typeof target !== 'string') {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }

  const home = os.homedir();
  const allowedRoot = path.join(home, '.claude');
  const resolved = path.resolve(target);
  if (!resolved.startsWith(allowedRoot + path.sep) || !resolved.endsWith('.jsonl')) {
    return NextResponse.json({ error: 'path not allowed' }, { status: 403 });
  }
  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'linux' ? 'xdg-open' : 'cmd';
  const args = platform === 'win32' ? ['/c', 'start', '', resolved] : [resolved];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

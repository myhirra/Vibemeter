import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { getServerLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SoundMode = 'voice' | 'beep' | 'off';

const VALID_MODES: ReadonlySet<SoundMode> = new Set(['voice', 'beep', 'off']);

// Fire-and-forget: don't await the child. Returns immediately so the request
// stays snappy even when `say` takes 1.5s to read a sentence.
function spawnDetached(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    child.on('error', () => {});
  } catch {
    // Swallow — preview is best-effort.
  }
}

export async function POST(request: Request) {
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'Sound preview is macOS-only.' },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode as SoundMode | undefined;
  if (!mode || !VALID_MODES.has(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (mode === 'off') {
    return NextResponse.json({ played: false, reason: 'silent' });
  }

  if (mode === 'beep') {
    spawnDetached('/usr/bin/afplay', ['/System/Library/Sounds/Glass.aiff']);
    return NextResponse.json({ played: true, mode: 'beep' });
  }

  // mode === 'voice' — mirror the real notify script's locale-aware phrasing
  // so preview matches what users will actually hear in production.
  const locale = await getServerLocale();
  const isEn = locale === 'en';
  const sayText = isEn ? 'Claude demo done' : 'Claude demo 完成';
  const voice = isEn ? '' : 'Tingting';
  const args = voice ? ['-v', voice, sayText] : [sayText];
  spawnDetached('/usr/bin/say', args);
  return NextResponse.json({ played: true, mode: 'voice' });
}

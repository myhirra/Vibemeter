import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '@/lib/data-dir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAUSE_FILE = () => path.join(dataDir(), 'pause-until');

function readPausedUntil(): number | null {
  try {
    const raw = fs.readFileSync(PAUSE_FILE(), 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > Date.now() ? n : null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ pausedUntil: readPausedUntil() });
}

export async function POST(request: Request) {
  let body: { minutes?: number };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return NextResponse.json({ error: 'minutes must be 1..1440' }, { status: 400 });
  }
  const until = Date.now() + Math.round(minutes) * 60_000;
  fs.mkdirSync(path.dirname(PAUSE_FILE()), { recursive: true });
  fs.writeFileSync(PAUSE_FILE(), String(until));
  return NextResponse.json({ pausedUntil: until });
}

export async function DELETE() {
  try { fs.unlinkSync(PAUSE_FILE()); } catch { /* already gone */ }
  return NextResponse.json({ pausedUntil: null });
}

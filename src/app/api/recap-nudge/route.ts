import { NextResponse } from 'next/server';
import { dismissRecapNudge, readActiveRecapNudge } from '@/lib/recap-nudge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ nudge: readActiveRecapNudge() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { action?: string; id?: string };
  if (body.action === 'dismiss') {
    dismissRecapNudge(body.id ?? null);
    return NextResponse.json({ ok: true, nudge: readActiveRecapNudge() });
  }
  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}

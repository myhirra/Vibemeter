import { NextResponse } from 'next/server';
import { normalizeRecapSettings, readRecapSettings, writeRecapSettings } from '@/lib/recap-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ settings: readRecapSettings() });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { settings?: unknown } | null;
    if (!body || !('settings' in body)) {
      return NextResponse.json({ error: 'settings required' }, { status: 400 });
    }
    const settings = writeRecapSettings(normalizeRecapSettings(body.settings));
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save recap settings' },
      { status: 500 },
    );
  }
}

import { NextResponse } from 'next/server';
import { refreshSessions } from '@/lib/session-refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const startedAt = Date.now();
    const result = await refreshSessions();
    return NextResponse.json({
      ...result,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to refresh sessions' },
      { status: 500 },
    );
  }
}

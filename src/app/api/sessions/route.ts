import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { SessionRow } from '@/lib/schema';

export function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, tool, started_at, ended_at, exit_code, cwd, confidence
       FROM sessions
       ORDER BY started_at DESC
       LIMIT 50`
    )
    .all() as Partial<SessionRow>[];
  return NextResponse.json({ sessions: rows });
}

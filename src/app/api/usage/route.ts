import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { UsageSnapshotRow } from '@/lib/schema';

export function GET() {
  const db = getDb();
  const latest = db
    .prepare(
      `SELECT * FROM usage_snapshots ORDER BY captured_at DESC LIMIT 1`
    )
    .get() as UsageSnapshotRow | undefined;
  return NextResponse.json({ snapshot: latest ?? null });
}

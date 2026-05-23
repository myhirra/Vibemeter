import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getLatestUsageSnapshot, type UsageSource } from '@/lib/usage-snapshots';

const SOURCES = new Set<UsageSource>(['claude_usage_cmd', 'statusline', 'manual', 'codex']);

export function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSource = url.searchParams.get('source') as UsageSource | null;
  const source = requestedSource && SOURCES.has(requestedSource) ? requestedSource : null;
  const requestedAccountId = url.searchParams.get('accountId');
  const accountId = source === 'codex' && requestedAccountId ? requestedAccountId : null;
  const db = getDb();

  if (source) {
    return NextResponse.json({ snapshot: getLatestUsageSnapshot(db, source, accountId) });
  }

  const latest = db
    .prepare(`SELECT * FROM usage_snapshots ORDER BY captured_at DESC LIMIT 1`)
    .get();
  return NextResponse.json({ snapshot: latest ?? null });
}

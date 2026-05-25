import { NextResponse } from 'next/server';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { getFloatStats } from '@/lib/float-stats';
import { decideQuotaGuard } from '@/lib/quota-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  importUsageSnapshots();
  const stats = await getFloatStats();
  return NextResponse.json({ guard: decideQuotaGuard(stats) });
}


import { NextResponse } from 'next/server';
import { getFloatStats } from '@/lib/float-stats';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('refresh') === 'usage') {
    importUsageSnapshots();
  }
  return NextResponse.json(await getFloatStats());
}

import { NextResponse } from 'next/server';
import { importUsageSnapshots } from '@/lib/collectors/session-importer';
import { buildShareReport } from '@/lib/share-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  importUsageSnapshots();
  return NextResponse.json({ report: await buildShareReport() });
}

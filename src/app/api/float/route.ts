import { NextResponse } from 'next/server';
import { getFloatStats } from '@/lib/float-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await getFloatStats());
}

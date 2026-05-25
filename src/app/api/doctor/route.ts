import { NextResponse } from 'next/server';
import { getDoctorReport } from '@/lib/doctor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ doctor: getDoctorReport() });
}


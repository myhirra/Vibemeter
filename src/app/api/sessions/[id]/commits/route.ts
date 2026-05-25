import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { commitsForSession } from '@/lib/git/scan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const commits = commitsForSession(id, getDb());
  return NextResponse.json({ commits });
}

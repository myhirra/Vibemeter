import { NextResponse } from 'next/server';
import { classifyCodexSessions } from '@/lib/collectors/codex-classifier';

export async function POST() {
  try {
    const classified = await classifyCodexSessions();
    return NextResponse.json({ classified });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

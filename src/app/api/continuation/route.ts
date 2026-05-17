import { NextResponse } from 'next/server';
import { z } from 'zod';

const RequestSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  // TODO Day 2: read session JSONL, extract key context, call Claude API to generate prompt
  return NextResponse.json({
    sessionId: parsed.data.sessionId,
    prompt: 'TODO: continuation prompt generation not yet implemented',
    confidence: 'low',
  });
}

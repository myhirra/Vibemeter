import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateContinuationPrompt } from '@/lib/continuation/generator';
import { getDb } from '@/lib/db';

const RequestSchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  const body: unknown = await request.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  const { sessionId } = parsed.data;

  try {
    const result = await generateContinuationPrompt(sessionId);

    if (result.summary) {
      getDb()
        .prepare(`UPDATE sessions SET summary = ? WHERE id = ?`)
        .run(result.summary, sessionId);
    }

    return NextResponse.json({ sessionId, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

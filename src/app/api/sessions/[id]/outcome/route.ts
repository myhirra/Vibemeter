import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { OutcomeSchema } from '@/lib/schema';

// Mirrors `/api/sessions/[id]/tags` — same shape, same auth model (none; the
// server only listens on localhost). A `null` body clears the outcome and
// resets the source/timestamp, so the next import pass is free to auto-label
// the row again.
const BodySchema = z.object({
  outcome: OutcomeSchema,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: unknown = await request.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { outcome } = parsed.data;

  if (outcome == null) {
    getDb()
      .prepare(`UPDATE sessions SET outcome = NULL, outcome_source = NULL, outcome_set_at = NULL WHERE id = ?`)
      .run(id);
    return NextResponse.json({ ok: true, outcome: null, outcome_source: null, outcome_set_at: null });
  }

  const now = Date.now();
  getDb()
    .prepare(`UPDATE sessions SET outcome = ?, outcome_source = 'user', outcome_set_at = ? WHERE id = ?`)
    .run(outcome, now, id);

  return NextResponse.json({ ok: true, outcome, outcome_source: 'user', outcome_set_at: now });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';

const BodySchema = z.object({
  tags: z.array(z.string().max(32)).max(10),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body: unknown = await request.json();
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  getDb()
    .prepare(`UPDATE sessions SET tags = ? WHERE id = ?`)
    .run(JSON.stringify(parsed.data.tags), id);

  return NextResponse.json({ ok: true, tags: parsed.data.tags });
}

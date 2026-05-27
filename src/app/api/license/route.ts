import { NextResponse } from 'next/server';
import { activate, deactivate, getCurrentState, validate } from '@/lib/license/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/license — current cached state. Never talks to the network.
 */
export async function GET() {
  const state = getCurrentState();
  return NextResponse.json({ state });
}

/**
 * POST /api/license — body `{action: 'activate'|'validate'|'deactivate', key?}`.
 * Local-only loopback contract: this route never accepts usage/session/project
 * data, only an action and (for activate) a license key.
 */
export async function POST(request: Request) {
  let body: { action?: unknown; key?: unknown } = {};
  try {
    body = (await request.json()) as { action?: unknown; key?: unknown };
  } catch {
    return NextResponse.json({ error: 'expected JSON body' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : null;
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 });
  }

  if (action === 'activate') {
    if (typeof body.key !== 'string' || body.key.trim().length === 0) {
      return NextResponse.json({ error: 'key required' }, { status: 400 });
    }
    const result = await activate(body.key);
    return NextResponse.json({
      ok: result.ok,
      state: result.state,
      errorKey: result.errorKey ?? null,
      errorDetail: result.errorDetail ?? null,
    }, { status: result.ok ? 200 : 400 });
  }

  if (action === 'validate') {
    const result = await validate();
    return NextResponse.json({
      ok: result.ok,
      state: result.state,
      errorKey: result.errorKey ?? null,
      errorDetail: result.errorDetail ?? null,
    });
  }

  if (action === 'deactivate') {
    const result = await deactivate();
    return NextResponse.json({
      ok: result.ok,
      state: result.state,
      errorKey: result.errorKey ?? null,
      errorDetail: result.errorDetail ?? null,
    }, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}

import { NextResponse } from 'next/server';
import {
  deleteCodexAccount,
  getCodexAccounts,
  importCurrentCodexAuth,
  switchCodexAccount,
} from '@/lib/codex-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Codex account operation failed' },
    { status },
  );
}

export async function GET() {
  try {
    return NextResponse.json({ accounts: await getCodexAccounts() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { action?: string; accountId?: string };

    if (body.action === 'import-current') {
      const account = await importCurrentCodexAuth();
      return NextResponse.json({ account, accounts: await getCodexAccounts() });
    }

    if (body.action === 'switch') {
      if (!body.accountId) return errorResponse(new Error('Missing accountId'));
      const account = await switchCodexAccount(body.accountId);
      return NextResponse.json({ account, accounts: await getCodexAccounts() });
    }

    if (body.action === 'delete') {
      if (!body.accountId) return errorResponse(new Error('Missing accountId'));
      await deleteCodexAccount(body.accountId);
      return NextResponse.json({ accounts: await getCodexAccounts() });
    }

    return errorResponse(new Error('Unsupported action'));
  } catch (error) {
    return errorResponse(error);
  }
}

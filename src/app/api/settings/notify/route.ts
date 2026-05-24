import { NextResponse } from 'next/server';
import { getNotifyStatus, installNotifyHooks, uninstallNotifyHooks } from '@/lib/notify-installer';
import { getServerLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Notify settings operation failed' },
    { status },
  );
}

export async function GET() {
  try {
    return NextResponse.json({ status: getNotifyStatus() });
  } catch (error) {
    return errorResponse(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      stop?: boolean;
      notification?: boolean;
      codex?: boolean;
    };

    if (body.action === 'install') {
      const locale = await getServerLocale();
      const result = installNotifyHooks({
        stop: body.stop ?? true,
        notification: body.notification ?? false,
        codex: body.codex ?? true,
        locale,
      });
      return NextResponse.json({ result, status: getNotifyStatus() });
    }

    if (body.action === 'uninstall') {
      const result = uninstallNotifyHooks();
      return NextResponse.json({ result, status: getNotifyStatus() });
    }

    return errorResponse(new Error('Unsupported action'));
  } catch (error) {
    return errorResponse(error);
  }
}

// Server-side fan-out for curated announcement items. The client never sees
// webhook plaintext (alerts.json is 0600 + only opened on the server) so the
// browser POSTs the lightweight `{ item, locale }` payload here and we dispatch
// to every configured channel.
//
// This is intentionally a thin glue layer. We do NOT touch the alerts rule
// engine, the alerts state file, or the alerts ticker — announcement fan-out
// has a different lifecycle (it's a curated push from upstream, not a derived
// metric) so it owns its own dedup + prefs on the client side. We only borrow
// the channel registry + push primitives.

import { NextResponse } from 'next/server';
import { dispatch } from '@/lib/alerts/dispatch';
import { readAlertConfig } from '@/lib/alerts/storage';
import {
  formatAnnouncementMessage,
  type Announcement,
} from '@/lib/announcements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, status = 400) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Announcement fan-out failed' },
    { status },
  );
}

interface RequestBody {
  item?: Announcement;
  locale?: 'zh' | 'en';
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return errorResponse(new Error('invalid JSON body'));
  }
  const item = body?.item;
  if (!item || typeof item.id !== 'string' || !item.title) {
    return errorResponse(new Error('item required'));
  }
  const locale: 'zh' | 'en' = body.locale === 'en' ? 'en' : 'zh';

  const config = readAlertConfig();
  const channels = config.channels;
  if (channels.length === 0) {
    // No channels configured — that's fine; the client already showed the
    // banner. Return a benign success so the client can move on without
    // logging a spurious failure.
    return NextResponse.json({ dispatched: 0, results: [] });
  }

  const { title, body: msgBody } = formatAnnouncementMessage(item, locale);
  // Fire all channels in parallel. Each pusher already swallows errors into a
  // `{ success, message }` shape; we just collect them for the response.
  const results = await Promise.all(
    channels.map(async (ch) => {
      try {
        const res = await dispatch(ch, title, msgBody);
        return { channelId: ch.id, channelLabel: ch.label, ...res };
      } catch (err) {
        return {
          channelId: ch.id,
          channelLabel: ch.label,
          success: false,
          message: err instanceof Error ? err.message : String(err),
          channel: ch.type,
        };
      }
    }),
  );
  return NextResponse.json({ dispatched: channels.length, results });
}

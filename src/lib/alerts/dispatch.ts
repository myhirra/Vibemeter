// Channel dispatch — picks the right pusher and returns a uniform result.

import type { AlertChannel } from './types';
import { pushWxwork, type PushResult } from './push/wxwork';
import { pushGeneric } from './push/generic';

export async function dispatch(channel: AlertChannel, title: string, body: string): Promise<PushResult> {
  if (channel.type === 'wxwork') {
    return pushWxwork(channel.webhook, title, body);
  }
  return pushGeneric(channel.webhook, title, body, channel.headers);
}

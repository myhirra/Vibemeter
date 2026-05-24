// Generic webhook — POSTs a JSON body with title/body/timestamp. Good for
// self-hosted receivers (Bark, ntfy, Slack-shaped, …) where the receiver
// adapts the payload itself. No retry — generic endpoints rarely have a
// well-known transient error contract.

import type { PushResult } from './wxwork';
export type { PushResult } from './wxwork';

export async function pushGeneric(
  webhook: string,
  title: string,
  body: string,
  headers?: Record<string, string>,
): Promise<PushResult> {
  if (!webhook) return { success: false, message: 'webhook 为空', channel: 'generic' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
      body: JSON.stringify({
        source: 'vibemeter',
        title,
        body,
        timestamp: new Date().toISOString(),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return { success: true, message: `HTTP ${res.status}`, channel: 'generic', attempts: 1 };
    const text = await res.text().catch(() => '');
    return {
      success: false,
      message: `HTTP ${res.status} ${text.slice(0, 200)}`.trim(),
      channel: 'generic',
      attempts: 1,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      channel: 'generic',
      attempts: 1,
    };
  }
}

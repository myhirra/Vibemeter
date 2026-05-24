// WeChat Work group bot webhook — based on the stocks repo's wxwork pusher.
// Chunks long markdown (4096 char limit, we leave a budget for headings),
// retries on transient errcodes (45009/45033 = rate limit / concurrency).

const RETRY_DELAY_MS = 5000;
const RETRIABLE_ERRCODES = new Set([45009, 45033]);
const MAX_CHUNK = 3800;

export interface PushResult {
  success: boolean;
  message: string;
  channel: string;
  attempts?: number;
}

interface AttemptOutcome {
  success: boolean;
  message: string;
  retriable: boolean;
}

async function attemptPush(webhook: string, content: string): Promise<AttemptOutcome> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string };
    if (data?.errcode === 0) return { success: true, message: '推送成功', retriable: false };
    return {
      success: false,
      message: `errcode=${data?.errcode} ${data?.errmsg ?? ''}`.trim(),
      retriable: typeof data?.errcode === 'number' && RETRIABLE_ERRCODES.has(data.errcode),
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      retriable: true,
    };
  }
}

function chunkBody(title: string, body: string): string[] {
  const head = `## ${title}\n`;
  if (head.length + body.length <= MAX_CHUNK) return [head + body];

  const paragraphs = body.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (head.length + candidate.length <= MAX_CHUNK) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (head.length + para.length > MAX_CHUNK) {
      const lines = para.split('\n');
      let buf = '';
      for (const line of lines) {
        const c = buf ? `${buf}\n${line}` : line;
        if (head.length + c.length <= MAX_CHUNK) {
          buf = c;
        } else {
          if (buf) chunks.push(buf);
          buf = line.length > MAX_CHUNK - head.length ? line.slice(0, MAX_CHUNK - head.length) : line;
        }
      }
      current = buf;
    } else {
      current = para;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((c, i) => {
    const tag = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
    return `## ${title}${tag}\n${c}`;
  });
}

export async function pushWxwork(webhook: string, title: string, body: string): Promise<PushResult> {
  if (!webhook) return { success: false, message: 'webhook 为空', channel: 'wxwork' };
  const chunks = chunkBody(title, body);

  if (chunks.length === 1) {
    const first = await attemptPush(webhook, chunks[0]);
    if (first.success || !first.retriable) {
      return { success: first.success, message: first.message, channel: 'wxwork', attempts: 1 };
    }
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const second = await attemptPush(webhook, chunks[0]);
    return {
      success: second.success,
      message: second.success ? second.message : `${first.message} → 重试: ${second.message}`,
      channel: 'wxwork',
      attempts: 2,
    };
  }

  const failures: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const r = await attemptPush(webhook, chunks[i]);
    if (!r.success) failures.push(`#${i + 1}/${chunks.length}: ${r.message}`);
    if (i < chunks.length - 1) await new Promise((res) => setTimeout(res, 600));
  }
  if (failures.length === 0) {
    return { success: true, message: `推送成功（分 ${chunks.length} 片）`, channel: 'wxwork', attempts: chunks.length };
  }
  return { success: false, message: failures.join(' | '), channel: 'wxwork', attempts: chunks.length };
}

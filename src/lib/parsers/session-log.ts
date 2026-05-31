import fs from 'fs';
import { z } from 'zod';

// Minimal shapes we care about — extra fields are ignored via .passthrough()
const LineWithTimestamp = z.object({
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  version: z.string().optional(),
  type: z.string(),
}).passthrough();

const AiTitleLine = z.object({
  type: z.literal('ai-title'),
  aiTitle: z.string(),
  sessionId: z.string(),
});

export interface SessionLogMeta {
  sessionId: string;
  cwd: string | null;
  gitBranch: string | null;
  version: string | null;
  /** Unix ms of first timestamped line */
  startedAt: number | null;
  /** Unix ms of last timestamped line */
  lastSeenAt: number | null;
  /**
   * Claude-generated session title from the ai-title event.
   * Safe to store (not user prompt content).
   * TODO Day 2: use as seed for continuation prompt generation.
   */
  aiTitle: string | null;
  /** Summed across every assistant turn — for cost / cache analytics. */
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /**
   * Peak observed context window in a single assistant turn.
   * ≈ (input + cache_read + cache_creation + output) of that turn.
   * null when no usage events were seen.
   */
  peakContextTokens: number | null;
  /** Same as peakContextTokens but for the latest turn (rough "current" context). */
  lastContextTokens: number | null;
  /** Wall-clock ms at the latest assistant turn (to age out stale context readings). */
  lastTurnAt: number | null;
  /** Count of top-level user prompts. Prompt text is never returned. */
  promptCount: number;
}

export function parseSessionLog(jsonlPath: string): SessionLogMeta | null {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  // sessionId comes from the filename (uuid before .jsonl)
  const sessionId = jsonlPath.split('/').pop()?.replace('.jsonl', '') ?? null;
  if (!sessionId) return null;

  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let version: string | null = null;
  let startedAt: number | null = null;
  let lastSeenAt: number | null = null;
  let aiTitle: string | null = null;
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let peakContextTokens: number | null = null;
  let lastContextTokens: number | null = null;
  let lastTurnAt: number | null = null;
  let promptCount = 0;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const base = LineWithTimestamp.safeParse(parsed);
    if (!base.success) continue;

    const data = base.data;

    let lineMs: number | null = null;
    if (data.timestamp) {
      const ms = new Date(data.timestamp).getTime();
      if (!Number.isNaN(ms)) {
        lineMs = ms;
        if (startedAt === null || ms < startedAt) startedAt = ms;
        if (lastSeenAt === null || ms > lastSeenAt) lastSeenAt = ms;
      }
    }

    if (!cwd && data.cwd) cwd = data.cwd;
    if (!gitBranch && data.gitBranch) gitBranch = data.gitBranch;
    if (!version && data.version) version = data.version;

    if (data.type === 'ai-title') {
      const titleParsed = AiTitleLine.safeParse(parsed);
      if (titleParsed.success) aiTitle = titleParsed.data.aiTitle;
    }

    if (isUserPrompt(parsed)) {
      promptCount += 1;
    }

    if (data.type === 'assistant') {
      const usage = ((parsed.message as Record<string, unknown> | undefined)?.usage) as Record<string, unknown> | undefined;
      if (usage) {
        const inp = numberOrZero(usage.input_tokens);
        const cc = numberOrZero(usage.cache_creation_input_tokens);
        const cr = numberOrZero(usage.cache_read_input_tokens);
        const out = numberOrZero(usage.output_tokens);
        inputTokens += inp;
        cacheCreationTokens += cc;
        cacheReadTokens += cr;
        outputTokens += out;
        const turnContext = inp + cc + cr + out;
        if (turnContext > 0) {
          if (peakContextTokens === null || turnContext > peakContextTokens) peakContextTokens = turnContext;
          lastContextTokens = turnContext;
          if (lineMs != null) lastTurnAt = lineMs;
        }
      }
    }
  }

  return {
    sessionId,
    cwd,
    gitBranch,
    version,
    startedAt,
    lastSeenAt,
    aiTitle,
    inputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    peakContextTokens,
    lastContextTokens,
    lastTurnAt,
    promptCount,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isUserPrompt(parsed: Record<string, unknown>): boolean {
  if (parsed.type !== 'user' || parsed.isSidechain === true) return false;
  const message = parsed.message as Record<string, unknown> | undefined;
  if (!message || message.role !== 'user') return false;
  const content = message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (!Array.isArray(content)) return false;

  let hasText = false;
  let hasToolResult = false;
  for (const part of content as unknown[]) {
    if (!part || typeof part !== 'object') continue;
    const item = part as Record<string, unknown>;
    if (item.type === 'tool_result') hasToolResult = true;
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      hasText = true;
    }
  }
  return hasText && !hasToolResult;
}

export interface LiveContext {
  sessionId: string;
  cwd: string | null;
  tokens: number;
  capturedAt: number;
}

/**
 * Cheap "live" read of the latest assistant turn's context window for a single
 * jsonl. Reads up to 256 KiB from the end of the file rather than the whole
 * thing — most active sessions get this in <1 ms.
 */
export function readLiveContext(jsonlPath: string): LiveContext | null {
  let stat: fs.Stats;
  try { stat = fs.statSync(jsonlPath); } catch { return null; }
  if (stat.size === 0) return null;

  const sessionId = jsonlPath.split('/').pop()?.replace('.jsonl', '') ?? null;
  if (!sessionId) return null;

  const chunk = Math.min(stat.size, 256 * 1024);
  const fd = fs.openSync(jsonlPath, 'r');
  const buf = Buffer.alloc(chunk);
  try {
    fs.readSync(fd, buf, 0, chunk, stat.size - chunk);
  } finally {
    fs.closeSync(fd);
  }

  const text = buf.toString('utf8');
  // Drop a possibly-partial first line if we didn't start at byte 0
  const startsAtZero = stat.size === chunk;
  const lines = text.split('\n').filter(Boolean);
  if (!startsAtZero && lines.length > 0) lines.shift();

  let cwd: string | null = null;
  let tokens = 0;
  let capturedAt = 0;

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (typeof parsed.cwd === 'string' && !cwd) cwd = parsed.cwd;
    if (parsed.type !== 'assistant') continue;
    const usage = (parsed.message as Record<string, unknown> | undefined)?.usage as Record<string, unknown> | undefined;
    if (!usage) continue;
    const turn = numberOrZero(usage.input_tokens)
      + numberOrZero(usage.cache_creation_input_tokens)
      + numberOrZero(usage.cache_read_input_tokens)
      + numberOrZero(usage.output_tokens);
    if (turn > 0) {
      tokens = turn;
      const ts = typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : 0;
      if (!Number.isNaN(ts)) capturedAt = ts;
    }
  }

  if (tokens === 0) return null;
  return { sessionId, cwd, tokens, capturedAt: capturedAt || stat.mtimeMs };
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  toolNames?: string[];
}

export function readConversationTurns(jsonlPath: string, limit = 12): ConversationTurn[] {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonlPath, 'utf8');
  } catch {
    return [];
  }

  const turns: ConversationTurn[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(line) as Record<string, unknown>; } catch { continue; }

    const type = parsed.type as string | undefined;
    const msg = parsed.message as Record<string, unknown> | undefined;
    if (!msg || (type !== 'user' && type !== 'assistant')) continue;

    const role = msg.role as string;
    const content = msg.content;

    if (role === 'user' && typeof content === 'string' && content.trim()) {
      turns.push({ role: 'user', text: content.trim().slice(0, 800) });
    } else if (role === 'assistant' && Array.isArray(content)) {
      const textParts: string[] = [];
      const toolNames: string[] = [];
      for (const part of content as Record<string, unknown>[]) {
        if (part.type === 'text' && typeof part.text === 'string') {
          textParts.push((part.text as string).slice(0, 600));
        } else if (part.type === 'tool_use' && typeof part.name === 'string') {
          toolNames.push(part.name as string);
        }
      }
      if (textParts.length > 0 || toolNames.length > 0) {
        turns.push({ role: 'assistant', text: textParts.join(' ').trim(), toolNames });
      }
    }
  }

  return turns.slice(-limit);
}

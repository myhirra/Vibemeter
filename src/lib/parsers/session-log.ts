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

/** 按「消息实际发生日」归集的一天用量（解决跨天长会话把 token 全算到 started_at 那天的问题）。 */
export interface SessionDailyUsage {
  /** 本地该天 0 点的 unix ms */
  dayMs: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  promptCount: number;
}

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
  /** 按消息实际发生日归集的 token/prompt 明细（每天一项）。 */
  dailyUsage: SessionDailyUsage[];
}

/** 本地该天 0 点的 unix ms。用于把每条消息按其 timestamp 归到自然日。 */
function floorLocalDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface DayBucket {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
  lastPrompt: number;
  userPrompt: number;
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
  let userPromptCount = 0;
  let lastPromptCount = 0;
  // 上一个已计入的 last-prompt 原文（去重用）。Claude Code 每个 assistant turn 都会
  // 重写 marker（leafUuid 变、lastPrompt 原文不变），只有原文变化才是一次真正的新输入。
  let prevPromptKey: string | null = null;
  // carry-forward：最近见过的行时间戳。last-prompt marker 等行可能没有自己的 timestamp，
  // 用它兜底归到正确的天，避免按天 prompt 丢失。
  let lastMs: number | null = null;
  const daily = new Map<number, DayBucket>();
  const bucketFor = (dayMs: number): DayBucket => {
    let b = daily.get(dayMs);
    if (!b) {
      b = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0, lastPrompt: 0, userPrompt: 0 };
      daily.set(dayMs, b);
    }
    return b;
  };

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
        lastMs = ms;
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

    const promptMs = lineMs ?? lastMs;
    if (isLastPromptEvent(parsed)) {
      // 同一条输入会在后续每个 turn 被重复写成 marker——按原文相邻去重，只计真正的新提交。
      // 无 lastPrompt 原文的旧格式 marker 回退用 leafUuid，保证每个仍各计一次（不误合并）。
      const text = typeof parsed.lastPrompt === 'string' ? parsed.lastPrompt.trim() : '';
      const key = text || (typeof parsed.leafUuid === 'string' ? (parsed.leafUuid as string) : `#${lastPromptCount}`);
      if (key !== prevPromptKey) {
        lastPromptCount += 1;
        if (promptMs != null) bucketFor(floorLocalDayMs(promptMs)).lastPrompt += 1;
        prevPromptKey = key;
      }
    } else if (isUserPrompt(parsed)) {
      userPromptCount += 1;
      if (promptMs != null) bucketFor(floorLocalDayMs(promptMs)).userPrompt += 1;
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
        const assistantMs = lineMs ?? lastMs;
        if (assistantMs != null) {
          const b = bucketFor(floorLocalDayMs(assistantMs));
          b.input += inp;
          b.cacheCreation += cc;
          b.cacheRead += cr;
          b.output += out;
        }
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
    promptCount: lastPromptCount > 0 ? lastPromptCount : userPromptCount,
    dailyUsage: [...daily.entries()].map(([dayMs, b]) => ({
      dayMs,
      inputTokens: b.input,
      cacheCreationTokens: b.cacheCreation,
      cacheReadTokens: b.cacheRead,
      outputTokens: b.output,
      promptCount: b.lastPrompt > 0 ? b.lastPrompt : b.userPrompt,
    })),
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

function isLastPromptEvent(parsed: Record<string, unknown>): boolean {
  if (parsed.type !== 'last-prompt') return false;
  if (parsed.isSidechain === true) return false;
  // 注意：Claude Code 每个 assistant turn 都会重写一个 `last-prompt` marker——leafUuid
  // 每轮变，但 lastPrompt 原文只在你真正键入新内容时才变。所以调用方按 lastPrompt 原文
  // 相邻去重计数，而不是数 marker 行数（否则一条输入的多轮执行会被算成多个 prompt）。
  return typeof parsed.sessionId === 'string' || typeof parsed.leafUuid === 'string';
}

export interface LiveContext {
  sessionId: string;
  cwd: string | null;
  tokens: number;
  capturedAt: number;
  /** 最近一个 assistant turn 的模型名（如 claude-opus-4-…），用于倍率提示 */
  model: string | null;
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
  let model: string | null = null;

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
      const m = (parsed.message as Record<string, unknown> | undefined)?.model;
      if (typeof m === 'string' && m) model = m;
      const ts = typeof parsed.timestamp === 'string' ? new Date(parsed.timestamp).getTime() : 0;
      if (!Number.isNaN(ts)) capturedAt = ts;
    }
  }

  if (tokens === 0) return null;
  return { sessionId, cwd, tokens, model, capturedAt: capturedAt || stat.mtimeMs };
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

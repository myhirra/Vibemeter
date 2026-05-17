/**
 * Parses a single ~/.claude/projects/{path}/{uuid}.jsonl file.
 * Each line is a JSON object. We extract only session-level metadata —
 * never prompt text, never source code, never API keys.
 */

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

    if (data.timestamp) {
      const ms = new Date(data.timestamp).getTime();
      if (!Number.isNaN(ms)) {
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
  }

  return { sessionId, cwd, gitBranch, version, startedAt, lastSeenAt, aiTitle };
}

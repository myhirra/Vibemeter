import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { parseSessionLog, readConversationTurns } from '../parsers/session-log';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function findJsonlPath(sessionId: string): string | null {
  try {
    for (const dir of fs.readdirSync(PROJECTS_DIR)) {
      const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* ok */ }
  return null;
}

export interface ContinuationResult {
  prompt: string;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function generateContinuationPrompt(
  sessionId: string
): Promise<ContinuationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      prompt: 'Set ANTHROPIC_API_KEY to enable continuation prompt generation.',
      summary: '',
      confidence: 'low',
    };
  }

  const jsonlPath = findJsonlPath(sessionId);
  if (!jsonlPath) {
    return {
      prompt: `Session JSONL not found for ${sessionId}.`,
      summary: '',
      confidence: 'low',
    };
  }

  const meta = parseSessionLog(jsonlPath);
  const turns = readConversationTurns(jsonlPath, 12);

  const project = meta?.cwd?.split('/').filter(Boolean).pop() ?? 'unknown';
  const branch = meta?.gitBranch ?? 'unknown';
  const title = meta?.aiTitle ?? '(no title)';

  const turnsSummary = turns.map((t) => {
    if (t.role === 'user') return `User: ${t.text}`;
    const tools = t.toolNames?.length ? ` [tools: ${t.toolNames.join(', ')}]` : '';
    return `Assistant: ${t.text}${tools}`;
  }).join('\n\n');

  const contextBlock = [
    `Session title: ${title}`,
    `Project: ${project} (branch: ${branch})`,
    `Working directory: ${meta?.cwd ?? 'unknown'}`,
    '',
    'Last conversation turns:',
    turnsSummary || '(no conversation recorded)',
  ].join('\n');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    system: [
      {
        type: 'text',
        text: 'You are a session continuity assistant. Given the context of a past AI coding session, produce two things:\n1. A one-sentence summary of what was accomplished.\n2. A compact "resume context" block (≤300 words) that can be pasted at the start of a new Claude Code session to restore context — include what was being built, current state, and immediate next steps.\n\nRespond in JSON: {"summary": "...", "prompt": "..."}',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: contextBlock }],
  });

  const text = response.content.find((c) => c.type === 'text')?.text ?? '';
  try {
    const parsed = JSON.parse(text) as { summary?: string; prompt?: string };
    return {
      prompt: parsed.prompt ?? text,
      summary: parsed.summary ?? '',
      confidence: 'high',
    };
  } catch {
    return { prompt: text, summary: '', confidence: 'medium' };
  }
}

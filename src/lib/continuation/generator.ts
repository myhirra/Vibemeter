/**
 * TODO Day 2: Generate a session continuation prompt from a session's JSONL.
 *
 * Plan:
 *   1. Read ~/.claude/projects/{path}/{sessionId}.jsonl
 *   2. Extract: ai-title, last N user/assistant turns, tool calls, file changes
 *   3. Call Claude API (claude-sonnet-4-6) to produce a compact "resume context" prompt
 *   4. Return prompt string + confidence='high'
 *
 * Day 1: returns a stub.
 */

export interface ContinuationResult {
  prompt: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function generateContinuationPrompt(
  _sessionId: string
): Promise<ContinuationResult> {
  return {
    prompt: 'TODO: continuation prompt generation not yet implemented',
    confidence: 'low',
  };
}

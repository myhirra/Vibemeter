/**
 * Parses ~/.vibemeter/statusline-latest.json written by the patched statusline-command.sh.
 * Claude Code writes this file on every status line render with current session context.
 * All fields come directly from Claude Code internals — confidence='high'.
 */

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { dataDir } from '../data-dir';

export const STATUSLINE_PATH = path.join(dataDir(), 'statusline-latest.json');

const StatuslineSchema = z.object({
  session_id: z.string().optional(),
  session_name: z.string().optional(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  model: z.object({ id: z.string(), display_name: z.string() }).optional(),
  cost: z.object({ total_cost_usd: z.number() }).optional(),
  context_window: z.object({
    total_input_tokens: z.number(),
    total_output_tokens: z.number(),
    used_percentage: z.number(),
  }).optional(),
  rate_limits: z.object({
    five_hour: z.object({
      used_percentage: z.number(),
      resets_at: z.number().optional(), // unix seconds
    }).optional(),
    seven_day: z.object({
      used_percentage: z.number(),
      resets_at: z.number().optional(),
    }).optional(),
  }).optional(),
}).passthrough();

export type StatuslineData = z.infer<typeof StatuslineSchema>;

export interface StatuslineUsage {
  window_5h_used_pct: number | null;
  window_weekly_used_pct: number | null;
  reset_at_5h: number | null;       // unix ms
  reset_at_weekly: number | null;   // unix ms
  raw_output: string;
  confidence: 'high';
  /** Also returned for session upsert */
  session_id: string | null;
  session_name: string | null;
  cwd: string | null;
  /** Claude Code 直接报的上下文占比（%），confidence='high'。模型窗口无关，
   * 1M 窗口的 Fable 5 等新模型也自动正确。缺失时为 null，调用方回退到自算。 */
  context_used_pct: number | null;
  /** Claude Code 报的上下文已用 token 总数（input+output），和占比同源，自洽。 */
  context_tokens: number | null;
  /** 当前会话模型 id（如 claude-opus-4-8 / claude-fable-5），用于倍率提示。 */
  model_id: string | null;
}

export function parseStatuslineJson(): StatuslineUsage | null {
  let raw: string;
  try {
    raw = fs.readFileSync(STATUSLINE_PATH, 'utf8');
  } catch {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }

  const parsed = StatuslineSchema.safeParse(json);
  if (!parsed.success) return null;

  const d = parsed.data;
  const rl = d.rate_limits;

  return {
    window_5h_used_pct: rl?.five_hour?.used_percentage ?? null,
    window_weekly_used_pct: rl?.seven_day?.used_percentage ?? null,
    // resets_at from Claude Code is unix seconds — convert to ms
    reset_at_5h: rl?.five_hour?.resets_at != null ? rl.five_hour.resets_at * 1000 : null,
    reset_at_weekly: rl?.seven_day?.resets_at != null ? rl.seven_day.resets_at * 1000 : null,
    raw_output: raw.slice(0, 2000),
    confidence: 'high',
    session_id: d.session_id ?? null,
    session_name: d.session_name ?? null,
    cwd: d.cwd ?? null,
    context_used_pct: d.context_window?.used_percentage ?? null,
    context_tokens: d.context_window
      ? d.context_window.total_input_tokens + d.context_window.total_output_tokens
      : null,
    model_id: d.model?.id ?? null,
  };
}

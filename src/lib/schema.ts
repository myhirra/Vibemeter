import { z } from 'zod';

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ToolSchema = z.enum(['claude-code', 'codex', 'cursor', 'other']);
export type Tool = z.infer<typeof ToolSchema>;

export const ChangeTypeSchema = z.enum(['modified', 'created', 'deleted']);
export type ChangeType = z.infer<typeof ChangeTypeSchema>;

// ── sessions ──────────────────────────────────────────────────────────────────

export const SessionRowSchema = z.object({
  id: z.string().uuid(),
  tool: ToolSchema,
  started_at: z.number().int(),
  ended_at: z.number().int().nullable(),
  exit_code: z.number().int().nullable(),
  cwd: z.string().nullable(),
  cli_args: z.string().nullable(),
  summary: z.string().nullable(),
  ai_title: z.string().nullable(),
  tags: z.string().nullable(), // JSON array string e.g. '["blocked","poc"]'
  codex_category: z.string().nullable(),
  confidence: ConfidenceSchema,
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

// ── usage_snapshots ───────────────────────────────────────────────────────────

export const UsageSnapshotRowSchema = z.object({
  id: z.number().int(),
  captured_at: z.number().int(),
  source: z.enum(['claude_usage_cmd', 'statusline', 'manual', 'codex']),
  account_id: z.string().nullable(),
  window_5h_used_pct: z.number().nullable(),
  window_weekly_used_pct: z.number().nullable(),
  // Only set when /usage output explicitly contains a reset timestamp — never inferred
  reset_at_5h: z.number().int().nullable(),
  reset_at_weekly: z.number().int().nullable(),
  raw_output: z.string().nullable(),
  confidence: ConfidenceSchema,
});
export type UsageSnapshotRow = z.infer<typeof UsageSnapshotRowSchema>;

// ── file_changes ──────────────────────────────────────────────────────────────

export const FileChangeRowSchema = z.object({
  id: z.number().int(),
  session_id: z.string().uuid(),
  path: z.string(),
  change_type: ChangeTypeSchema,
  detected_at: z.number().int(),
});
export type FileChangeRow = z.infer<typeof FileChangeRowSchema>;

// ── input shapes used by collectors ──────────────────────────────────────────

export const NewSessionSchema = SessionRowSchema.omit({ id: true }).partial({
  ended_at: true,
  exit_code: true,
  cwd: true,
  cli_args: true,
  summary: true,
}).extend({
  id: z.string().uuid(),
});
export type NewSession = z.infer<typeof NewSessionSchema>;

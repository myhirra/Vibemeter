#!/usr/bin/env tsx
/**
 * Inserts 2 mock sessions and reads them back to verify SQLite read/write.
 * Run: npx tsx scripts/seed.ts
 */
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../src/lib/db';
import { SessionRowSchema } from '../src/lib/schema';

const db = getDb();

const sessions = [
  {
    id: uuidv4(),
    tool: 'claude-code' as const,
    started_at: Date.now() - 60_000 * 30,
    ended_at: Date.now() - 60_000 * 5,
    exit_code: 0,
    cwd: '/Users/hanlu/codes/ai-tools/ai-sessions',
    cli_args: JSON.stringify(['--no-update-notifier']),
    summary: null, // TODO: Day 2 — generate via LLM
    confidence: 'medium' as const,
  },
  {
    id: uuidv4(),
    tool: 'claude-code' as const,
    started_at: Date.now() - 60_000 * 3,
    ended_at: null,
    exit_code: null,
    cwd: '/Users/hanlu/codes/ai-tools/hirra-con',
    cli_args: JSON.stringify([]),
    summary: null,
    confidence: 'medium' as const,
  },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO sessions
    (id, tool, started_at, ended_at, exit_code, cwd, cli_args, summary, confidence)
  VALUES
    (@id, @tool, @started_at, @ended_at, @exit_code, @cwd, @cli_args, @summary, @confidence)
`);

for (const s of sessions) {
  insert.run(s);
}

const rows = db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all();

console.log(`\n=== sessions table (${rows.length} rows) ===`);
for (const row of rows) {
  const parsed = SessionRowSchema.safeParse(row);
  if (parsed.success) {
    const { id, tool, started_at, ended_at, cwd, confidence } = parsed.data;
    console.log({
      id: id.slice(0, 8) + '…',
      tool,
      started_at: new Date(started_at).toISOString(),
      ended_at: ended_at ? new Date(ended_at).toISOString() : null,
      cwd,
      confidence,
    });
  } else {
    console.error('zod parse failed:', parsed.error.format());
  }
}

console.log('\nSeed OK ✓');

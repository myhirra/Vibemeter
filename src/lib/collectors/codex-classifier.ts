import fs from 'fs';
import path from 'path';
import os from 'os';
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';

const HISTORY_PATH = path.join(os.homedir(), '.codex', 'history.jsonl');

const CATEGORIES = ['deploy', 'debug', 'explore', 'ops', 'browser', 'other'] as const;
type Category = typeof CATEGORIES[number];

interface HistoryEntry { session_id: string; text: string; }

function readUnclassified(): Map<string, string[]> {
  const db = getDb();
  const unclassified = new Set<string>(
    (db.prepare(`SELECT id FROM sessions WHERE tool='codex' AND codex_category IS NULL`).all() as { id: string }[])
      .map((r) => r.id)
  );
  if (unclassified.size === 0) return new Map();

  const bySession = new Map<string, string[]>();
  try {
    for (const line of fs.readFileSync(HISTORY_PATH, 'utf8').split('\n').filter(Boolean)) {
      try {
        const e = JSON.parse(line) as HistoryEntry;
        if (!unclassified.has(e.session_id)) continue;
        const arr = bySession.get(e.session_id) ?? [];
        arr.push(e.text.slice(0, 200));
        bySession.set(e.session_id, arr);
      } catch { /* malformed */ }
    }
  } catch { /* no history */ }
  return bySession;
}

export async function classifyCodexSessions(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 0;

  const bySession = readUnclassified();
  if (bySession.size === 0) return 0;

  const client = new Anthropic({ apiKey });

  // Batch all prompts in one API call
  const entries = [...bySession.entries()].slice(0, 100); // max 100 at once
  const listText = entries
    .map(([id, texts], i) => `${i + 1}. [${id}] ${texts.slice(0, 3).join(' / ')}`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: `Classify each coding session prompt into exactly one category:
deploy = deployment, server ops, pushing code
debug = fixing bugs, errors, crashes
explore = research, reading docs, exploration
ops = file management, config, system tasks
browser = browser automation, web scraping, web browsing
other = anything else

Reply with ONLY a JSON array of objects: [{"id":"<uuid>","category":"<category>"},...]`,
    messages: [{ role: 'user', content: listText }],
  });

  const text = response.content.find((c) => c.type === 'text')?.text ?? '[]';
  let results: { id: string; category: string }[] = [];
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) results = JSON.parse(match[0]) as typeof results;
  } catch { return 0; }

  const db = getDb();
  const update = db.prepare(`UPDATE sessions SET codex_category = ? WHERE id = ?`);
  const updateAll = db.transaction(() => {
    for (const { id, category } of results) {
      const cat = CATEGORIES.includes(category as Category) ? category : 'other';
      update.run(cat, id);
    }
  });
  updateAll();
  return results.length;
}

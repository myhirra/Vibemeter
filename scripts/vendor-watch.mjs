#!/usr/bin/env node
// Polls public Atom/RSS feeds for signs that Anthropic/OpenAI changed Pro/Max
// or ChatGPT/Codex weekly limits. Strict keyword whitelist; on hit, pushes to
// the first wxwork channel configured in ~/.vibemeter/alerts.json.
//
// Standalone Node ESM. No deps. Run via LaunchAgent every 10 min.
// First run records all current entries as "seen" without pushing — so we
// never spam on bootstrap.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DATA_DIR = process.env.VIBEMETER_DATA_DIR ?? path.join(os.homedir(), '.vibemeter');
const STATE_PATH = path.join(DATA_DIR, 'vendor-watch-state.json');
const CONFIG_PATH = path.join(DATA_DIR, 'alerts.json');
const TIMEOUT_MS = 15_000;
const STATE_CAP = 2000;

const FEEDS = [
  { id: 'anthropic-status', url: 'https://status.anthropic.com/history.atom', label: 'Anthropic Status', kind: 'xml' },
  { id: 'openai-status', url: 'https://status.openai.com/history.atom', label: 'OpenAI Status', kind: 'xml' },
  { id: 'claude-code-releases', url: 'https://github.com/anthropics/claude-code/releases.atom', label: 'Claude Code Releases', kind: 'xml' },
  { id: 'codex-releases', url: 'https://github.com/openai/codex/releases.atom', label: 'Codex Releases', kind: 'xml' },
  { id: 'r-claudeai', url: 'https://www.reddit.com/r/ClaudeAI/new/.rss?limit=25', label: 'r/ClaudeAI', kind: 'xml' },
  { id: 'r-chatgptpro', url: 'https://www.reddit.com/r/ChatGPTPro/new/.rss?limit=25', label: 'r/ChatGPTPro', kind: 'xml' },
  { id: 'hn-claude', url: 'https://hn.algolia.com/api/v1/search_by_date?query=claude+limit&tags=story&hitsPerPage=20', label: 'HN: claude+limit', kind: 'hn' },
  { id: 'hn-codex', url: 'https://hn.algolia.com/api/v1/search_by_date?query=codex+limit&tags=story&hitsPerPage=20', label: 'HN: codex+limit', kind: 'hn' },
  { id: 'hn-anthropic', url: 'https://hn.algolia.com/api/v1/search_by_date?query=anthropic+limit&tags=story&hitsPerPage=20', label: 'HN: anthropic+limit', kind: 'hn' },
];

// Whitelist: text must hit at least one of these to even be a candidate.
const POS = /\b(weekly\s+(limit|cap|quota)|rate[\s-]?limit|fair[\s-]?use|usage\s+(cap|limit|quota)|throttl(e|ed|ing)|nerf(ed|ing)?|cap\s+reset|new\s+limits?|halved|slashed|reduced|prorate[d]?|extended\s+limit|tighten(ed|ing)?\s+limit)\b/i;
// Blacklist: API/enterprise-side noise.
const NEG = /\b(api\s+tier|\bTPM\b|\bRPM\b|organization\s+(tier|limit)|enterprise\s+(tier|plan)|workspace\s+(tier|limit)|service\s+tier|dev\s+tier|developer\s+tier|tokens?\s+per\s+(minute|second))\b/i;
// If a NEG hit also mentions a consumer-side term, treat as consumer-side.
const CONSUMER = /\b(pro\s+plan|max\s+plan|plus\s+plan|team\s+plan|claude\s+code|claude\s+pro|claude\s+max|chatgpt\s+(pro|plus|team)|codex|subscription|monthly\s+plan|weekly\s+(limit|cap|quota))\b/i;

function loadJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; }
}

function saveJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function loadWebhook() {
  if (process.env.VIBEMETER_VENDOR_WATCH_WEBHOOK) {
    return { webhook: process.env.VIBEMETER_VENDOR_WATCH_WEBHOOK, label: 'env' };
  }
  const cfg = loadJson(CONFIG_PATH, { channels: [] });
  const ch = (cfg.channels ?? []).find((c) => c.type === 'wxwork' && c.webhook);
  return ch ? { webhook: ch.webhook, label: ch.label || 'wxwork' } : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'vibemeter-vendor-watch/1.0', Accept: 'application/atom+xml, application/rss+xml, application/xml, application/json, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

function parseXmlFeed(xml) {
  const entries = [];
  const blocks = xml.match(/<(entry|item)\b[\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const idRaw = block.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1]
      ?? block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ?? '';
    const linkHref = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? '';
    const linkText = block.match(/<link\b[^>]*>([^<]+)<\/link>/i)?.[1] ?? '';
    const sumRaw = block.match(/<(summary|description|content)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ?? '';
    const link = linkHref || linkText.trim();
    const id = (stripHtml(idRaw) || link || stripHtml(title)).slice(0, 240);
    if (!id) continue;
    entries.push({ id, title: stripHtml(title) || '(no title)', link, summary: stripHtml(sumRaw) });
  }
  return entries;
}

function parseHnFeed(text) {
  const data = JSON.parse(text);
  return (data.hits ?? []).map((h) => ({
    id: `hn-${h.objectID}`,
    title: h.title || h.story_title || '(no title)',
    link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    summary: stripHtml(h.story_text ?? ''),
  }));
}

function matches(title, summary) {
  const text = `${title}\n${summary}`;
  if (!POS.test(text)) return false;
  if (NEG.test(text) && !CONSUMER.test(text)) return false;
  return true;
}

async function loadFeed(feed) {
  const text = await fetchText(feed.url);
  return feed.kind === 'hn' ? parseHnFeed(text) : parseXmlFeed(text);
}

async function pushWxwork(webhook, content) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: data?.errcode === 0, message: `errcode=${data?.errcode ?? '?'} ${data?.errmsg ?? ''}`.trim() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(timer); }
}

function fmtHit({ feed, entry }) {
  const lines = [`**[${feed.label}]** [${entry.title}](${entry.link})`];
  if (entry.summary) {
    const s = entry.summary.slice(0, 200);
    lines.push(`> ${s}${entry.summary.length > 200 ? '…' : ''}`);
  }
  return lines.join('\n');
}

async function main() {
  const target = loadWebhook();
  if (!target) {
    console.error(`[vendor-watch] no wxwork channel in ${CONFIG_PATH} and no VIBEMETER_VENDOR_WATCH_WEBHOOK env — configure one in Vibemeter Settings`);
    process.exit(1);
  }

  const state = loadJson(STATE_PATH, { seen: [], lastRunAt: 0 });
  const seenSet = new Set(state.seen ?? []);
  const firstRun = seenSet.size === 0;

  const results = await Promise.all(FEEDS.map(async (f) => {
    try { return { feed: f, entries: await loadFeed(f), err: null }; }
    catch (e) { return { feed: f, entries: [], err: e instanceof Error ? e.message : String(e) }; }
  }));

  const hits = [];
  const nextSeen = [...seenSet];
  for (const { feed, entries, err } of results) {
    if (err) { console.error(`[vendor-watch] ${feed.id} failed: ${err}`); continue; }
    for (const e of entries) {
      const key = `${feed.id}:${e.id}`;
      if (seenSet.has(key)) continue;
      nextSeen.push(key);
      if (firstRun) continue;
      if (matches(e.title, e.summary)) hits.push({ feed, entry: e });
    }
  }

  saveJson(STATE_PATH, { seen: nextSeen.slice(-STATE_CAP), lastRunAt: Date.now() });

  if (firstRun) {
    console.log(`[vendor-watch] first run, seeded ${nextSeen.length} entries, no push`);
    return;
  }
  if (hits.length === 0) {
    console.log('[vendor-watch] no hits');
    return;
  }

  const header = '## Claude / Codex 政策可能变更';
  const body = hits.map(fmtHit).join('\n\n');
  const content = `${header}\n\n${body}`.slice(0, 3800);
  const r = await pushWxwork(target.webhook, content);
  console.log(`[vendor-watch] ${hits.length} hits → wxwork(${target.label}): ${r.ok ? 'ok' : `fail ${r.message}`}`);
  if (!r.ok) process.exit(2);
}

main().catch((e) => { console.error('[vendor-watch] fatal:', e); process.exit(1); });

# AI Coding Continuity Console — v1 local-first MVP

Keeps your AI coding sessions from "forgetting" context. v1 collects session metadata from Claude Code and displays it on a local dashboard. The hero feature — **session continuation prompt generation** — ships in Day 2.

## Quick start

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Import your Claude Code sessions

Sessions are auto-imported from `~/.claude/projects/` on each `cc-wrap` invocation. To import manually at any time:

```bash
npx tsx bin/cc-wrap.ts --version   # triggers import, then shows claude version
```

### Optional: alias `claude` to auto-import on every session

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
alias claude='npx tsx /Users/hanlu/codes/ai-sessions/bin/cc-wrap.ts'
```

Then `source ~/.zshrc`. After that, every `claude` invocation will automatically sync sessions to the local database.

## Dashboard

`http://localhost:3000` shows:

- **5h window / weekly budget** — currently "no data yet" (see Known Limitations)
- **Recent Sessions** — last 20 sessions from `~/.claude/projects/`, with project, duration, and active/done status

## Data storage

All data lives in `.data/continuity.sqlite` (gitignored). Nothing leaves your machine.

## Current limitations (Day 1)

| Feature | Status |
|---------|--------|
| Session list | ✅ real data from `~/.claude/projects/` |
| Active session detection | ✅ via `~/.claude/sessions/` |
| 5h / weekly usage % | ✅ real data via `statusline-command.sh` → `statusline-latest.json` |
| Reset time countdown | ✅ `resets_at` from Claude Code context JSON |
| Continuation prompt | ⏳ stub — Day 2 |
| Session summary | ⏳ stub — Day 2 |
| `cli_args` for imported sessions | ❌ not available without wrapper; `null` |

## Architecture

```
~/.claude/projects/{path}/{session-uuid}.jsonl  →  session-importer  →  SQLite
~/.claude/sessions/{pid}.json                   →  active detection
```

Session data is parsed from Claude Code's own files (`confidence='high'`). No prompt content, source code, or API keys are stored — only session-level metadata (timestamps, cwd, git branch, session title).

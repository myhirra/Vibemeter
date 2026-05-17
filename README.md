# Vibemeter

> Measure your AI coding vibe. A local-first dashboard for Claude Code, Codex, and Cursor.

![Vibemeter dashboard](docs/demo1.png)

## What you get

- **5h / 7-day rate-limit windows** for both Claude Code (statusline) and Codex (rollout files)
- **Spending & consumption** — Claude Code USD + Codex tokens, with a 14-day trend chart
- **Activity** — hour-of-week heatmap with peak-slot detection + today's timeline ribbon
- **Project leaderboard** — top projects by hours / sessions / tools used
- **Achievements** — 16 unlockable milestones
- **Burndown chart** — 7-day usage history with hover tooltip
- **Sessions table** — searchable, tag-able, filterable by tool and date range

Everything runs locally. **No data ever leaves your machine.**

## Quick start

```bash
npx @hirra/vibemeter
```

Open <http://localhost:3000>. Vibemeter stores its data in `~/.vibemeter/`.

That's it. The dashboard automatically reads from:

| Tool        | Source                                                       |
| ----------- | ------------------------------------------------------------ |
| Claude Code | `~/.claude/projects/**/*.jsonl`                              |
| Claude Code | `~/.claude/sessions/*.json` (active-session flag)            |
| Codex       | `~/.codex/state_5.sqlite` (thread metadata)                  |
| Codex       | `~/.codex/sessions/**/rollout-*.jsonl` (rate-limit windows)  |
| Cursor      | `~/Library/Application Support/Cursor/User/workspaceStorage/**/state.vscdb` |

If a tool's files don't exist, its cards just show "no data yet" — everything else still works.

### Different port

```bash
PORT=8080 npx @hirra/vibemeter
```

### Demo mode

Add `?demo=1` to the URL — anonymizes project names and injects mock sessions. Useful for screenshots and screen-sharing.

```
http://localhost:3000/?demo=1
```

## Claude Code 5h / 7-day cards (optional)

These cards need a statusline hook. Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.vibemeter');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'statusline-latest.json'),fs.readFileSync(0));\""
  }
}
```

Claude Code will start writing `~/.vibemeter/statusline-latest.json` on every status-line render. Vibemeter picks it up on next page load.

Codex needs **no setup** — its 5h/7d data lives in `~/.codex/sessions/**/rollout-*.jsonl` already.

## Run from source

```bash
git clone https://github.com/myhirra/Vibemeter.git
cd Vibemeter
npm install
npm run dev
```

Source mode uses `./.data/` instead of `~/.vibemeter/`. Override with `VIBEMETER_DATA_DIR=...`.

## Tech stack

- Next.js 16 (App Router, Turbopack), React 19, Tailwind v4
- better-sqlite3 for local storage — no external services, no telemetry

## License

[MIT](./LICENSE)

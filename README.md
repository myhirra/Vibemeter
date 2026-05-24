# Vibemeter

> Measure your AI coding vibe. A local-first dashboard for Claude Code, Codex, and Cursor.

> 🔒 **Everything runs locally. No data ever leaves your machine.** No telemetry, no tracking, no cloud, no API calls out. Vibemeter reads files already on your disk and renders a dashboard from them. That's it.

![Vibemeter dashboard](docs/demo1.png)

Website: <https://vibemeter.siney.top>

Install and launch with one command:

```bash
curl -fsSL https://vibemeter.siney.top/install.sh | bash
```

The installer downloads Vibemeter from npm, registers the local background service, waits for it to start, and opens the macOS floating widget. The dashboard runs on your own machine at <http://localhost:9527>.

## What you get

- **5h / 7-day rate-limit windows** for both Claude Code (statusline) and Codex (rollout files)
- **Spending & consumption** — Claude Code USD + Codex tokens, with a 14-day trend chart
- **Activity** — hour-of-week heatmap with peak-slot detection + today's timeline ribbon
- **Project leaderboard** — top projects by hours / sessions / tools used
- **Achievements** — 16 unlockable milestones
- **Burndown chart** — 7-day usage history with hover tooltip
- **Sessions table** — searchable, tag-able, filterable by tool and date range

## Quick start

The one-command installer is the recommended path for new users. It keeps everything local: data lives in `~/.vibemeter/`, and nothing is sent to Vibemeter or any cloud service.

Prefer doing it manually?

```bash
npm install -g @hirra/vibemeter
vibemeter install
vibemeter float
```

## Run in the foreground

```bash
vibemeter
```

Open <http://localhost:9527>. Hit Ctrl-C to stop.

## Run as a background service (macOS)

`vibemeter install` registers a LaunchAgent at `~/Library/LaunchAgents/com.hirra.vibemeter.plist`. It boots on login, restarts if it crashes, and writes logs to `~/.vibemeter/vibemeter.log`.

```bash
vibemeter status      # see if it's loaded + tail the log
vibemeter uninstall   # remove the LaunchAgent
```

On Linux, run `vibemeter install` and it'll print a systemd-user unit you can drop in `~/.config/systemd/user/vibemeter.service`.

## CLI reference

| Command                | What it does                                         |
| ---------------------- | ---------------------------------------------------- |
| `vibemeter`            | start the server in the foreground (Ctrl-C to stop)  |
| `vibemeter install`    | register a LaunchAgent so it runs on login (macOS)   |
| `vibemeter float`      | open the native macOS floating widget                |
| `vibemeter uninstall`  | remove the auto-start config                         |
| `vibemeter status`     | show whether the daemon is loaded + tail log         |
| `vibemeter help`       | print usage                                          |

| Env var               | Default          |
| --------------------- | ---------------- |
| `PORT`                | `9527`           |
| `VIBEMETER_DATA_DIR`  | `~/.vibemeter`   |

## Where the data comes from

Vibemeter reads these files directly. Nothing is sent anywhere.

| Tool        | Source                                                                       |
| ----------- | ---------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/**/*.jsonl`                                              |
| Claude Code | `~/.claude/sessions/*.json` (active-session flag)                            |
| Codex       | `~/.codex/state_5.sqlite` (thread metadata)                                  |
| Codex       | `~/.codex/sessions/**/rollout-*.jsonl` (rate-limit windows)                  |
| Cursor      | `~/Library/Application Support/Cursor/User/workspaceStorage/**/state.vscdb`  |

If a tool's files don't exist, its cards just show "no data yet". Everything else still works.

## Claude Code 5h / 7-day cards (optional setup)

These cards need a statusline hook. Add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node -e \"const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.vibemeter');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'statusline-latest.json'),fs.readFileSync(0));\""
  }
}
```

Claude Code starts writing `~/.vibemeter/statusline-latest.json` on every status-line render. Vibemeter picks it up automatically.

Codex needs **no setup** — its 5h/7d data lives in `~/.codex/sessions/**/rollout-*.jsonl` already.

## Demo mode

Append `?demo=1` to the URL — anonymizes project names and injects mock sessions. Useful for screenshots and screen-sharing.

```
http://localhost:9527/?demo=1
```

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
- better-sqlite3 for local storage
- Zero external services. Zero telemetry. Zero tracking.

## License

[MIT](./LICENSE)

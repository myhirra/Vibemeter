# Vibemeter

> Don’t let Claude Code or Codex hit limits mid-task. Vibemeter is a local quota runway and completion console for AI coding agents.

> 🔒 **Everything runs locally. No data ever leaves your machine.** No telemetry, no tracking, no cloud, no API calls out. Vibemeter reads files already on your disk and shows quota runway, sessions, and completion alerts from them. That's it.

![Vibemeter dashboard](docs/demo1.png)

<p align="center">
  <img src="public/float-ball.png" alt="Vibemeter floating ball" width="380">
  &nbsp;&nbsp;
  <img src="public/float-expanded.png" alt="Vibemeter floating widget expanded" width="380">
</p>

<p align="center"><sub>Native macOS floating widget — always-on quota ring (left) and expanded panel (right). Stays above your editor; click to refresh, click again to collapse.</sub></p>

Website: <https://vibemeter.siney.top>

Install and launch with one command:

```bash
curl -fsSL 'https://vibemeter.siney.top/install.sh?src=readme' | bash
```

The installer downloads Vibemeter from npm, registers the local background service, waits for it to start, and opens the macOS floating widget. The dashboard runs on your own machine at <http://localhost:9527>.

## What you get

- **Quota runway** — 5h / 7-day rate-limit windows for both Claude Code (statusline) and Codex (rollout files)
- **Burn-rate & reset visibility** — see recent usage history before a long agent task runs into a limit
- **Completion alerts** — optional macOS voice + notification hooks when Claude Code or Codex finishes
- **Project cost context** — top projects by hours / sessions / tools used, plus Claude Code USD and Codex tokens
- **Sessions table** — searchable, tag-able, filterable by tool and date range
- **Activity review** — hour-of-week heatmap, today's timeline ribbon, and daily streak context
- **Local dashboard** — everything renders from files already on your machine

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
| `vibemeter`                | start the server in the foreground (Ctrl-C to stop)  |
| `vibemeter install`        | register a LaunchAgent so it runs on login (macOS)   |
| `vibemeter float`          | open the native macOS floating widget                |
| `vibemeter uninstall`      | remove the auto-start config                         |
| `vibemeter status`         | show whether the daemon is loaded + tail log         |
| `vibemeter notify-install` | wire voice + macOS-notification hooks (Claude+Codex) |
| `vibemeter notify-status`  | show which voice hooks are installed                 |
| `vibemeter notify-uninstall` | remove the voice + notification hooks              |
| `vibemeter help`           | print usage                                          |

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

## Voice notifications (macOS)

Want Claude Code and Codex to **speak + show a notification** the moment they finish — no more tabbing back to check? Vibemeter ships a small speaker script and wires it into both tools for you.

```bash
vibemeter notify-install
```

That adds a Stop hook to `~/.claude/settings.json` and sets `notify = [...]` in `~/.codex/config.toml` (both backed up first). When an agent finishes, you'll hear a short *"Claude / Codex {project} 完成"* and see a banner — delivered through a small bundled `Vibemeter.app` so notifications carry the Vibemeter name + icon (system will ask for notification permission the first time). If the bundle isn't built yet, Vibemeter quietly falls back to `osascript`.

Toggle it from <http://localhost:9527/settings> — turn channels on/off, or remove everything with `vibemeter notify-uninstall`. If your Codex config already has a custom `notify` line, Vibemeter detects it and refuses to overwrite. The defaults use the **Tingting** Chinese voice (`say -v Tingting`); set `VIBEMETER_NOTIFY_VOICE` in the hook command to change it.

The installer for new users (`curl ... | bash`) also prompts to enable this during `vibemeter install` — accept or skip, you can always change later in Settings.

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

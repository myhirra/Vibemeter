# Vibemeter Traffic Playbook

Goal: turn Vibemeter from a built product into a product with repeatable qualified traffic.

## Baseline

Measured from `vibemeter.siney.top` nginx logs on 2026-05-30:

- 2026-05-24 to 2026-05-30: 1,449 parsed requests, 227 rough human unique IPs, 73 `/install.sh` GET requests.
- Biggest external referrer so far: V2EX thread `1215117`.
- Search pages exist, but traffic is still concentrated on `/`; `/claude-code-quota/`, `/codex-rate-limit/`, and `/ai-coding-usage-tracker/` each had low double-digit hits.
- Install attribution is mostly `src=none`, so every shared link and install command below must carry a source.

Traffic target for the first loop: 100 qualified human visits/day and 10 installer GETs/day for three consecutive days.

## Positioning

Do not lead with "usage dashboard". That space already has strong tools.

Lead with one of these wedges:

1. Claude Code quota runway: "Should I start this long agent task now, or wait/compact?"
2. AI coding recap card: "Make a screenshot-safe proof-of-work card from Claude Code, Codex, and Cursor."
3. macOS always-on meter: "A small floating risk indicator above the editor."

The strongest public hook is the recap card because it creates a screenshot people can share. The strongest search hook is Claude Code quota because it maps to an urgent problem.

## Tracking

Use these source labels:

- `v2ex-recap`
- `v2ex-quota`
- `hn-show`
- `x-recap-video`
- `reddit-claude`
- `github-readme`
- `team-share`

Landing links should include `?src=<source>`. Install commands should include the same `src`.

Example:

```bash
curl -fsSL 'https://vibemeter.siney.top/install.sh?src=v2ex-recap' | bash
```

## 72-Hour Launch Loop

### Day 1: recap-card launch

Publish the same visual hook to V2EX and X:

Title:

```text
我做了一个本地 AI Coding recap 卡片：统计 Claude Code / Codex / Cursor，但不上传数据
```

Body:

```text
最近 AI coding 用得太重，最大的问题不是“用了多少 token”，而是：

1. 开跑前不知道 Claude Code / Codex 的额度还够不够
2. 跑完以后没有一个可以安全分享的总结
3. 截图里很容易暴露项目名、路径、会话标题

所以我把 Vibemeter 做成了本地工具：

- 读取本机 Claude Code / Codex / Cursor 已经写下的文件
- 看 5h / weekly quota、上下文、burn-rate、reset 时间
- 生成 2x2 recap 卡片：价值、tokens、cache 命中率、sessions
- 支持 redact，公开截图不露项目名
- 不需要账号，不上传 prompt / transcript / usage history

安装：

curl -fsSL 'https://vibemeter.siney.top/install.sh?src=v2ex-recap' | bash

页面：
https://vibemeter.siney.top/ai-coding-recap-card/?src=v2ex-recap

想要反馈两个点：
1. recap 卡片最想看什么指标？
2. 你会不会分享自己的 AI coding 用量卡？
```

X video caption:

```text
I wanted an AI coding "wrapped" card that does not upload prompts or project names.

Vibemeter now generates a local recap card for Claude Code, Codex, and Cursor:
value, tokens, cache hit-rate, sessions.

Install:
curl -fsSL 'https://vibemeter.siney.top/install.sh?src=x-recap-video' | bash

https://vibemeter.siney.top/ai-coding-recap-card/?src=x-recap-video
```

### Day 2: Claude Code quota search post

Post as a practical note, not a launch ad.

Title:

```text
Claude Code 长任务开跑前，我现在会先看 5h / weekly runway
```

Body angle:

- Start with the failure case: long refactor dies near quota/context boundary.
- Show the floating meter screenshot.
- Link to `https://vibemeter.siney.top/claude-code-quota/?src=v2ex-quota`.
- Ask for other Claude Code quota failure stories.

### Day 3: Show HN

Only post if the install flow works cleanly on a fresh macOS machine.

Title:

```text
Show HN: Vibemeter, a local quota runway meter for Claude Code and Codex
```

Comment:

```text
I built this because long AI coding agent runs kept failing at the least useful time: after I had already handed over a refactor, migration, or test pass.

Vibemeter runs locally and reads files that Claude Code, Codex, and Cursor already write. It shows 5-hour / weekly quota runway, context risk, reset timing, session history, and can generate a screenshot-safe recap card.

The main difference from token-only dashboards is the macOS floating meter: I wanted the "can I start this task now?" answer to be visible before and during an agent run.

There is no account, no telemetry, and no prompt upload. Install is:

curl -fsSL 'https://vibemeter.siney.top/install.sh?src=hn-show' | bash

Repo: https://github.com/myhirra/Vibemeter
```

## Weekly Experiment Rule

Run five experiments per week until the traffic target is hit. Keep anything that produces at least 20 qualified visits or 3 installer GETs in 48 hours.

Next experiments:

- Build a 20-second red/yellow/green floating-meter video and pin it on X.
- Add `Vibemeter` to relevant awesome lists only when the repo is genuinely useful for that list.
- Write a technical post: "How Claude Code / Codex local usage files can be turned into a quota runway meter."
- Publish one comparison page only after it is fair and factual: Vibemeter vs token-only CLI usage tools.
- Add GitHub badges from `/api/badge/*` to README so other repos can expose "Claude 5h remaining" style badges.

## What Not To Do

- Do not buy ads before organic positioning is proven.
- Do not lead with pricing.
- Do not post the same copy repeatedly.
- Do not ask friends for HN upvotes.
- Do not compete on "supports the most tools"; compete on "decides whether the next agent task can finish" and "recap cards people share."

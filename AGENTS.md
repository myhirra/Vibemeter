<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# marketing/ 私有素材 — 不发 GitHub

`marketing/` 目录是推广 / 销售 / 视频脚本 / 发布 playbook 等**内部素材**。

**规则：**

1. **绝不进主仓库**：`/marketing/` 已在 `.gitignore`，永远不要 `git add -f` 强制提交。
2. **有独立的 git 仓库**：`marketing/` 自己有 `.git`，remote 指向私服：
   - `ssh://git@hirra:2222/home/git/repos/vibemeter-marketing.git`
3. **推送方式**：
   ```bash
   cd marketing
   git add -A
   git commit -m "..."
   git push   # 推到 hirra.cn，不会到 GitHub
   ```
4. **主仓库 commit / push 时**：因为 `marketing/` 已 gitignore，正常 `git add -A` 不会带入；如看到 marketing 文件出现在 staged，立刻 `git reset` 后排查为何 gitignore 失效。
5. **不要在主仓库的 README / docs / 任何会发布到 npm 的位置引用 marketing/ 内容**，避免线索泄露。
6. 内容主题包括：HN/PH/Twitter/Reddit/V2EX/小红书/公众号文案、demo 视频脚本、发布日 playbook、功能候选清单、quick wins / bug 列表、GitHub 推广策略。这些是商业敏感信息（含定价、KOL 名单、内部时间表），不该公开。

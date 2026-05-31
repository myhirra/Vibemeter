# 截图语义台账（screenshots manifest）

> **用途**：固定 README / 首页里每张「会随 UI 变化而过期」的截图的*语义*——文件名、取景内容、截图参数、存放路径。
> 只要语义不变，文件名和引用就不用动，发布时按本表重截「同语义」的图、原地替换即可。
>
> **发布纪律**：本次发布若动过 UI（浮窗 / Dashboard / 首页），在 release 流程里会先问「要不要更新截图」。
> 要更新就照下表逐张重截，**保持同名同取景**，替换后再继续 commit / 上传。详见 `~/.claude/skills/vibemeter-release/SKILL.md` 的「Screenshot check」一步。
>
> 🔴 **铁律 · 截图脱敏（不可逆，务必遵守）**：任何对外截图**绝不能出现真实账号与真实项目名**。
> 涵盖：Codex/Claude **账号标签**（email / 账号名 / `accountLabel`）、Codex 账号切换里的账号、浮窗「最近会话 · 项目名」、Dashboard 的**项目列 / 会话标题 / cwd 路径**。
> 截图前**必须**满足其一：① 开 redact 脱敏；② 或先把账号切到中性/演示、项目切到中性名。
> 真实账号或私有仓库名一旦进了公开素材（README / 首页 / 分享卡），缓存与转载无法收回。**宁可用演示数据，也不要真实账号 / 仓库名。**

## 总览

「变更触发源」列是核心：**只有 diff 动了对应的源，这张图才需要重截**。发布时按它反查，命中哪张截哪张，别全截。获取方式见后文「怎么截」分节。

| 语义名 | 文件 | 引用处 | 取景（截什么） | 变更触发源（动了这些才重截） |
| --- | --- | --- | --- | --- |
| `float-expanded` | `public/float-expanded.png` | 首页 `MarketingPage.tsx` 右栏 | 浮窗**展开态**：剩余环 + 今天/7天/30天 切换 + Token/价值/命中率三卡 + 操作行 | `bin/vibemeter-float.swift` 展开态绘制：`drawRingBlock` / `drawStats` / `drawPeriodTabs` / `drawActions` / `preferredSize`(expanded 分支) |
| `float-collapsed` | `public/float-collapsed.png` | 首页 `MarketingPage.tsx` 右栏 | 浮窗**收起圆球态**：剩余百分比环 | `bin/vibemeter-float.swift` 收起态绘制：`drawBallCollapsed` / `drawDualBallCollapsed` / `drawPillsCollapsed` |
| `site-homepage` | `docs/site-homepage.png` | README hero（第 9 行） | 营销首页整页 hero：浮窗展开+收起两张图、安装命令、Before/During/After | `src/components/MarketingPage.tsx`（含其内嵌的 `float-expanded`/`float-collapsed`——这俩变了，整页 hero 图也跟着过期） |
| `dashboard-widget-demo` | `docs/dashboard-widget-demo.gif` | README（第 7 行） | Dashboard + 浮窗 popover 并排动图：live runway、redact 开、Claude 9% + exhausts-in-30m 告警 | `src/components/Dashboard.tsx` 及其卡片 + 浮窗展开态（swift）。**叙事/数据流变了才重录**；纯样式微调可不动 |
| `guard-demo` | `docs/guard-demo.gif` | README（第 171 行） | guard 演示动图：「下个任务会不会在额度/上下文耗尽前完成」 | `src/lib/quota-guard.ts` + Runway/NowRunway 卡。**判定逻辑/文案变了才重录** |
| `recap-sample` | `docs/recap-sample.png` | 暂未在仓库引用（疑似 marketing/ 用） | recap 分享卡样张 | `src/lib/recap-card-render.ts` / `ShareReportCard` 渲染 |
| `demo1` | `public/demo1.png`、`docs/demo1.png` | 暂未在 src/README 引用 | 待确认是否仍在用，可能可删 | — |
| `float-ball` | `public/float-ball.png` | 暂未在 src 引用 | 待确认是否仍在用，可能可删 | — |

> 上表前 5 张是**活跃维护**对象；后 3 张语义不明，发布时若发现仍无引用，问一句是否清理。

## 只截改动点（变更 → 截图 映射）

发布时**不要无脑全截**。按这个判断：

1. `git diff <上个 tag>..HEAD --stat` 看本次动了哪些文件。
2. 对照上表「变更触发源」列，命中哪张就重截哪张；没命中的**保持原图不动**。
3. 注意级联：`float-expanded` / `float-collapsed` 变了，`site-homepage`（内嵌这两张）也要一起更新。
4. gif（`dashboard-widget-demo` / `guard-demo`）只在**叙事或逻辑**变化时才重录，纯样式微调不动。

**实例（本次 period 三卡 + ring 居中改动）**：diff 只动了 `bin/vibemeter-float.swift` 的 `drawStats` / `drawPeriodTabs` / `drawRingBlock` / `preferredSize` 和后端 `float-stats.ts`。
- 命中 → `float-expanded`（展开态变了）、`site-homepage`（内嵌展开图）。
- **不命中** → `float-collapsed`（收起态绘制没动）、`guard-demo`、`recap-sample`。
- gif `dashboard-widget-demo` 含浮窗 popover，但若只是样式微调可不重录；叙事不变就放着。

## 固定语义参数（截「同语义」的关键）

这些默认值就是「语义」。除非另行决定，每次照此截：

- **语言 locale**：`zh`（中文 UI）。如果以后给 README 英文版单配英文图，用 `-en` 后缀另存，不要覆盖中文图。
- **脱敏 redact（硬性，见顶部铁律）**：公开图（README / 首页）一律**开 redact**；并逐一确认这些位置无真实信息——**账号标签 `accountLabel` / Codex 账号名**、浮窗「最近会话 · 项目」、Dashboard **项目列 / 会话标题 / cwd**。宁可用演示数据，也不要真实账号与仓库名。
- **浮窗 agent**：单 `Claude`（`agentDisplay = claude-code`）。需要展示 Claude+Codex 双环时另存 `-both` 后缀，不覆盖默认图。
- **浮窗 period（展开态）**：选 **7天**。`今天` 的 token/命中率常为 0（当天 session 明细还没导入），7天数据饱满、最能体现 Token/价值/命中率三卡。
- **窗口样式**：`float-collapsed` 用圆球（ball）样式，不用横条（pill）。
- **尺寸**：原图保持 Retina @2x 原始像素；首页 `<Image>` 声明的是 520×360 / 520×260，截图比例大致对齐即可（CSS 会缩放）。

## 怎么截：浮窗类（float-expanded / float-collapsed）

浮窗是原生 macOS 窗口，无法用网页截图工具，用 `screencapture` 截单窗口：

```bash
# 1. 起浮窗（已是单例，重复调用只会聚焦）
vibemeter float

# 2. 在浮窗上调到目标态：
#    - float-expanded：点开展开，agent=Claude，period 切到「7天」
#    - float-collapsed：收起成圆球（右键菜单 → 样式 → 圆球）
# 3. 交互式截「窗口」（点目标窗口即可，-o 去掉窗口阴影）。从仓库根目录执行：
screencapture -iWo public/float-expanded.png
screencapture -iWo public/float-collapsed.png
```

> 🔴 截前**务必**确认浮窗里**账号标签**与「最近会话 · 项目名」均无真实信息：开 redact，或临时把账号切到中性、项目切到中性名再截。真实账号 / 仓库名泄露不可逆（见顶部铁律）。

## 怎么截：网页类（site-homepage / recap-sample / dashboard）

网页类对着本地 daemon 截（daemon 跑在 `http://localhost:9527`）：

- `site-homepage` → 营销首页路由，`?locale=zh`，浏览器窗口拉到 hero 占满，截可视区或整页。
- `recap-sample` → recap 分享卡页面/接口的渲染结果。
- Dashboard（`dashboard-widget-demo` 的静帧底图）→ 首页 `/`，开 redact。

可用浏览器手动截，或起 headless 浏览器对路由截图后裁剪。无论哪种，**输出文件名和取景必须与上表一致**。

## gif 类（dashboard-widget-demo / guard-demo）

动图只能手动录屏后转 gif（如 `ffmpeg` / Gifski）。保持原文件名与取景叙事（见总览表「取景」列）。这两张通常只在叙事变化时才重录，纯样式微调可不动。

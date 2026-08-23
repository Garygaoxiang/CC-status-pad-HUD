# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

把 TURZX 8.8" 副屏（1920×480）变成一块实时显示 Claude Code 运行状态的编程 HUD。
纯展示 + 强提醒：HUD 只读、不接收输入；会话进入 `waiting`（等待授权/空闲提醒）时整屏强高亮。

**架构第一原则（最高优先级）**：HUD 任何组件故障——服务没起、副屏没接、网络问题——
**绝不能影响 Claude Code 本身的运行**。这条约束高于一切功能需求。

## 常用命令

```bash
npm test                              # 全量测试（node --test，跑 tests/ 全部）
node --test tests/format.test.js      # 跑单个测试文件
npm start                             # 启动采集器（= node src/server.js），端口 4317
node tools/replay.js [间隔ms]         # 回放 fixtures 事件序列，需先 npm start（默认间隔 800ms）
# 以下三条为 Windows 安装/启动/卸载管理命令
powershell -ExecutionPolicy Bypass -File scripts\install.ps1     # 安装：备份并写入 hook/statusline、注册开机自启（需重启 Claude Code 生效）
powershell -ExecutionPolicy Bypass -File scripts\start-hud.ps1   # 启动：拉起采集器、HUD kiosk 铺到副屏
powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1   # 卸载：还原 settings.json、移除开机自启
```

- 端口可用环境变量 `HUD_PORT` 覆盖（默认 4317）。
- 无 npm 依赖、无构建步骤。运行时为 Node.js ESM（`"type": "module"`）。
- 测试用 Node 内置 `node:test` + `node:assert/strict`，无测试框架。

## 数据流与架构

单向数据流，三段：

```
Claude Code 会话（1-3 个并行）
  ├ Hooks  → bin/hud-hook.cmd       → curl POST /hook
  └ Statusline → bin/hud-statusline.* → POST /statusline + 透传 claude-hud 原始输出
            │  （curl -m 1，出错也 exit 0 —— hook 静默失败不影响 Claude Code）
            ▼
src/server.js  采集器 / HTTP 服务（常驻 :4317）
  · 内存维护 sessions Map（键 = session_id）
  · 由事件序列派生会话状态、重建任务、累加 toolCounts/timeline
  · Usage 轮询器：每 5min 调 api.anthropic.com/api/oauth/usage
  · 静态托管 public/ 的 HUD 网页
            │  SSE 推送（GET /events，全量快照）
            ▼
public/  HUD 网页（1920×480 单页，收快照即重绘）
```

**注意**：`docs/spec.md` 写的是 WebSocket，实际实现用的是 **SSE**（`GET /events` + 浏览器
原生 `EventSource`，自带断线重连）。以代码为准。

### 采集器 — `src/`

- `server.js` — `createCollector()` 工厂，返回 `{ server, start, stop, snapshot }`。
  HTTP 端点：`POST /hook`、`POST /statusline`、`GET /state`（JSON 快照）、
  `GET /events`（SSE）、`GET /*`（静态托管 `public/`，带路径穿越防护）。
- `state.js` — **纯函数状态 reducer**。`applyEvent` / `applyStatusline` / `pickFocus` /
  `pruneStale` 等全部返回新对象、不改入参。状态机核心，改这里务必先看 §状态派生。
- `usage.js` — 从 `~/.claude/.credentials.json` 读 OAuth token，拉 usage 接口并解析。

### HUD 网页 — `public/`（浏览器侧）

- `format.js` — 纯标量格式化（状态文案、时钟、配色、进度条宽度、倒计时…）。
- `render.js` — 纯 HTML 片段生成：输入快照/会话，返回 HTML 字符串。所有外来文本经 `esc()`。
- `hud.js` — 薄胶水层：`EventSource` 订阅 `/events`，每帧快照调 `render.js`，
  装配进 `index.html` 的 DOM，并按 `waiting` 切整屏告警态。
- `index.html` / `hud.css` — 静态骨架与科幻仪表盘样式（含 `waiting` 红色强提醒态）。

**关键设计**：`format.js` / `render.js` 是纯函数、无 DOM/浏览器 API，因此浏览器与
Node 测试**共用同一份代码**，可在 Node 里直接 TDD。`hud.js` / `hud.css` / `index.html`
靠 `tools/replay.js` + 浏览器目测验证（见 `docs/spec.md` §8）。

### scripts/ — 安装器 / 启动器（Windows PowerShell）

- `start-hud.ps1` — 启动器：拉起单实例看门狗（`hud-watchdog.ps1`）由它启动并保活采集器；
  轮询等采集器就绪，**就绪才开 kiosk**（8s 内未就绪则记 `logs/start-hud.log`、跳过开窗，
  避免「server 不在却开窗 → 无限重连」）；用 `Screen.AllScreens` 检测副屏坐标，Chrome/Edge
  `--app --kiosk --window-position` 铺到指定屏；检测不到副屏时降级主屏 `--app` 开窗，不崩溃。
- `hud-watchdog.ps1` — 看门狗：单实例（全局 Mutex）常驻，每 10s 巡检 `:4317`，采集器缺席就带日志
  （`logs/watchdog.log` + server stdout/stderr）自动重启；node 路径每轮重解析，应对开机早期
  PATH/盘符未就绪。解决「采集器一次没起来/退出就永久缺席、kiosk 空窗无限重连」的根因。
- `install.ps1` — 安装器：备份用户 `~/.claude/settings.json`（settings.json 存在时整份
  备份、时间戳命名，不存在则按空配置处理、跳过备份），用 `mergeSettings` 写入
  HUD hook 与 statusline；把**看门狗**注册到 Windows 启动文件夹（`shell:startup`，无需管理员权限）——
  开机只保活采集器、不自动开 kiosk 窗口（显示端可能是 iPad/平板走局域网），要铺 TURZX 副屏手动跑 `start-hud.ps1`。
- `uninstall.ps1` — 卸载器：用 `restoreSettings` 还原 settings.json；移除启动文件夹里的启动项。
- `hud-config.json` — 静态配置（端口、目标分辨率、浏览器偏好）。

### tools/install-lib.js — 安装库（纯函数 + dispatch CLI）

Node.js ESM 模块。导出纯函数 `pickScreen`（从屏幕列表挑最优副屏）、
`mergeSettings`（幂等地把 HUD hook/statusline 注入 settings 对象）、
`restoreSettings`（移除 HUD 配置并还原原始 statusline）。
同时作为 CLI 被 PS 脚本调用（`node tools/install-lib.js <pick-screen|merge-settings|restore-settings> [opts]`）。

### bin/ — hook 与 statusline 转发器（Windows）

- `hud-hook.cmd` — 被 Claude Code hooks 调用，把事件 JSON（stdin）curl 转发到 `/hook`。
  `curl -m 1` + `exit /b 0`：超时与失败都静默，绝不影响 Claude Code。
- `hud-statusline.cmd` / `.js` — statusline 包装器：先转发 JSON 给 `/statusline`，
  再调用 claude-hud 原始 statusline 命令并透传其 stdout。原始命令存在本地
  `bin/original-statusline.txt`（不纳入版本控制，安装时生成）。

## 状态派生（改 state.js 前必读）

| hook 事件 | 派生 status |
|---|---|
| `UserPromptSubmit` | `working`（不写时间线） |
| `PreToolUse` | `running`（记录 `currentTool`） |
| `PostToolUse` | `working`（累加 `toolCounts`、追加 `timeline`；`TaskCreate`/`TaskUpdate` 重建 `tasks`） |
| `Notification` | `waiting` → 触发整屏强提醒 |
| `Stop` | `idle` |
| `SessionEnd` | `ended` |

- 聚焦会话（`focusId`）= `lastSeen` 最新者。
- `status === 'ended'` 或超过 `STALE_MS`（10min）无更新的会话会被 `pruneStale` 移除。
- `timeline` 是环形缓冲，上限 `MAX_TIMELINE`（20 条）。

## 数据契约

采集器快照（SSE 与 `/state` 的载荷）：`{ focusId, sessions[], usage, ts }`。

- 会话记录字段以 `state.js` 的 `createSession()` 为准。
- `effort` 来自 statusline 的 `effort.level`（low/medium/high/xhigh/max），反映当次真实值；模型不支持时为 `null`，HUD 不渲染该 chip。Desktop 版不调 statusline，改由 hook 载荷同名字段 `event.effort.level` 供给（CLI 的 hook 也照送，两边同源）；`transcriptPath` 同理，hook 载荷带 `transcript_path` 时直接写入，不必等 `deriveTranscriptPath` 反推。
- `ultra` 布尔值，默认 `false`。由 server 端 transcript 轮询判定（`src/transcript.js` 的 `lastEffortMode` 取末条 effort 命令）——statusline 把 ultracode 也报成 `xhigh`、区分不了，故靠 transcript 兜底。为 `true` 时 HUD 把 effort chip 渲染成紫色 `ULTRA`（覆盖 effort 等级；effort 为 `null` 时也照样显示）。
- `workflow` 来自只读文件轮询（`src/workflow.js` + server `pollWorkflows`）：运行期为
  `{name,runId,status:'running',doneAgents(M),totalAgents(N),phaseTotal}`；完成态 60s 内
  `status:'done'`；其余为 `null`。运行期只有 M/N 计数，当前 phase 不可得（见
  `docs/plans/2026-06-04-workflow-display.md`）。
- `usage` 形如 `{ fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt }`
  （百分比 0-100 整数或 `null`，见 `usage.js` 的 `parseUsage`），未取到时整体为 `null`。
- `usageAuth`：`null` 还没轮询过 / `false` 读不到 `~/.claude/.credentials.json` / `true` 拿到过凭据。
  HUD 靠它区分「同步中」与「无凭据」——Desktop 不写凭据文件，后者是常态，
  额度区显示「无凭据 · 需 CLI 登录一次」而不是永远挂着同步中。
- `filesChanged` 为会话内被 `Edit`/`Write`/`MultiEdit` 改过的**去重文件数**
  （int，由 `state.js` PostToolUse 派生），内部用 `filesChangedPaths` 数组
  记账；`Read`/`Bash`/`Grep`/`Glob` 等只读工具不计。会话级累计，跨 `Stop` 不清零，
  只在 `SessionEnd` 或 `pruneStale` 时随会话一起清。
- `linesAdded` / `linesRemoved` / `durationMs` 为**双来源**：statusline 供数时以它为准
  （CLI，精确）；会话从未收到过 statusline 时（Desktop）由 hook 派生——行数用
  `estimateLines` 从 `Edit`/`Write`/`MultiEdit` 的入参估算（整块替换 = 新块记增、旧块记删；
  `Write` 旧内容不可知故删记 0），时长取「首个事件 → 最新事件」的墙钟。
  `slSeen` 记录本会话是否被 statusline 供过数；`startedAt` 优先取 transcript 首条记录的
  `timestamp`（`firstTimestamp`，会话真实起点，采集器重启也不清零），取不到才退回首个 hook
  事件时间。`pollTranscripts` 每轮也刷一次 `durationMs`，会话空闲无 hook 时墙钟照样走。
  `costUsd` 没有派生来源，Desktop 上恒为 0。
- `contextPct` 由 server `pollTranscripts` 派生：读会话 `transcriptPath`
  的末条 assistant `message.usage`，把 `input_tokens + cache_creation_input_tokens
  + cache_read_input_tokens` 之和除以模型上下文窗口（`parseContextWindow` 从
  `session.model` 解析：statusline 给的 display_name 含 "(1M context)" / "(200k
  context)" 时精确取数；Desktop 兼容路径 transcript 兜底给的是 raw model ID
  时按 family 映射——`claude-opus-*` → 1M，其余保持 200K 默认）取整百分比。
  会话无 `transcriptPath` 或读不到时保持前值（初始 0）。

## Claude Desktop 上的差异（与 CLI 共用同一套 hook）

Desktop 版读同一份 `~/.claude/settings.json`，hook 照常触发，装一次两边都用，无需分别安装。
实测 Desktop 的 hook 载荷带 `session_id / cwd / transcript_path / effort / permission_mode`，
比早期以为的全（早年为 Desktop 写的 `deriveTranscriptPath` 反推因此退化成纯兜底）。
真正的差异只有两处，都是**能力缺失、不是故障**：

- **Desktop 不调 statusline** → 只有 `costUsd` 恒为 0（无派生来源）。`durationMs` 与增删行数
  已由 hook 派生兜底（见 §数据契约，估算值，与 CLI 的精确统计有出入）；
  `model` / `effort` / `contextPct` / `transcriptPath` 由 transcript 轮询与 hook 载荷兜底。
- **Desktop 不写 `~/.claude/.credentials.json`** → `usage`（5h/7d 配额）为 `null`，HUD 配额区留空。
  想要配额：在终端跑一次 CLI 版 `claude` 登录，凭据文件生成后 usage 轮询器自会取到。

## 约定

- 所有代码注释用中文，遵循现有风格。
- 单文件 Write/Edit 输出控制在 ~150 行内，超过分多次（见用户全局指令）。
- TDD：先写失败测试 → 跑确认失败 → 实现 → 跑确认通过 → 提交。每个任务原子提交。
- 提交信息用中文（如 `feat: ...`、`test: ...`），与现有 git 历史一致。
- 实施计划在 `docs/plans/`，设计文档在 `docs/spec.md`。

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

- `start-hud.ps1` — 启动器：检测 :4317 是否在监听，没有则后台拉起 `node src/server.js`；
  用 `Screen.AllScreens` 检测副屏坐标，用 Chrome/Edge `--app --kiosk --window-position`
  把 HUD 铺到指定屏；检测不到副屏时降级到主屏以 `--app` 模式打开窗口，不崩溃。
- `install.ps1` — 安装器：备份用户 `~/.claude/settings.json`（settings.json 存在时整份
  备份、时间戳命名，不存在则按空配置处理、跳过备份），用 `mergeSettings` 写入
  HUD hook 与 statusline；把启动器注册到 Windows 启动文件夹（`shell:startup`，无需管理员权限）。
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
- `usage` 形如 `{ fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt }`
  （百分比 0-100 整数或 `null`，见 `usage.js` 的 `parseUsage`），未取到时整体为 `null`。
- **已知限制**：`state.js` 当前不填充 `contextPct` / `filesChanged`（恒为 0）。
  HUD 照契约忠实渲染，会一直显示 0；这是后续计划项，不要在渲染层 hack 绕过。

## 约定

- 所有代码注释用中文，遵循现有风格。
- 单文件 Write/Edit 输出控制在 ~150 行内，超过分多次（见用户全局指令）。
- TDD：先写失败测试 → 跑确认失败 → 实现 → 跑确认通过 → 提交。每个任务原子提交。
- 提交信息用中文（如 `feat: ...`、`test: ...`），与现有 git 历史一致。
- 实施计划在 `docs/plans/`，设计文档在 `docs/spec.md`。

# Claude Code HUD — TURZX 副屏编程信息面板 · 设计文档

> 状态：设计已确认，待用户审阅
> 日期：2026-05-17
> 项目目录：`H:\turzx\turzx-coding-hud\`

## 1. 概述

把 TURZX 8.8" 副屏（1920×480）变成一块**实时显示 Claude Code 运行状态的编程 HUD**。
副屏在桌面模式下是一块标准 Windows 扩展屏，本项目做一个独立的全屏程序铺在上面，
不依赖 TURZX 软件本身。

定位：**纯展示 + 强提醒**。HUD 只读、不接收输入；当 Claude Code 在等待用户
（请求授权 / 空闲提醒）时，整屏强高亮提醒，让用户从主屏对面也能一眼察觉。

## 2. 背景与约束

- **副屏接入**：桌面模式下 = 标准 Windows 扩展屏，可直接把全屏窗口放上去。
- **现有 statusline**：用户已用 claude-hud 插件作为 statusline。本 HUD 是在
  claude-hud 显示信息基础上「展开铺满整块屏」。HUD 的 statusline 包装脚本
  必须保留并透传 claude-hud 的原始输出，不破坏用户终端体验。
- **会话数量**：用户通常同时跑 1-3 个 Claude Code 会话。HUD 默认聚焦最近活跃
  的会话，多个会话时在横幅里用芯片切换/列出。
- **交互**：无。不从副屏接收任何输入。
- **硬约束（最高优先级）**：HUD 的任何组件故障——服务没起、副屏没接、网络
  问题——都**绝不能影响 Claude Code 本身的运行**。

## 3. 架构

技术方案 A：本地 Node 服务 + 浏览器 kiosk 窗口。单向数据流。

```
┌─ Claude Code 会话（1-3 个并行）──────────────────────┐
│  Hooks（settings.json 配置）                          │
│    UserPromptSubmit / PreToolUse / PostToolUse /      │
│    Notification / Stop / SessionEnd                   │
│  Statusline（claude-hud 包装）                        │
│    模型 / cwd / 花费 / 改动行数 / 上下文用量          │
└───────────────┬───────────────────────────────────────┘
                │  curl POST（1s 超时，永远 exit 0）
                ▼
┌─ Node 采集器 / 服务（常驻，端口 :4317）──────────────┐
│  · 内存维护 1-3 个会话状态记录                        │
│  · 由事件序列派生「当前活动」状态                     │
│  · 解析 TaskCreate/TaskUpdate 重建任务列表            │
│  · Usage 轮询器：每 5min 调 /api/oauth/usage          │
│  · 静态托管 HUD 网页                                  │
└───────────────┬───────────────────────────────────────┘
                │  WebSocket 实时推送
                ▼
┌─ HUD 网页 · 1920×480 ─────────────────────────────────┐
│  HTML/CSS/JS 单页，收数据即时重绘，等待态整屏强提醒   │
└───────────────────────────────────────────────────────┘
        ▲
        └─ 启动器：拉起服务 + Chrome --app --kiosk 定位到副屏（开机自启）
```

**为什么是方案 A**：1920×480 超宽精致布局靠 HTML/CSS 最强；WebSocket 推送让
强提醒即时生效；Node 服务天然聚合多会话；可视化伴侣画的 mockup 直接就是成品。

**容错设计**：hook 上报用 `curl` 带 1 秒超时且强制 `exit 0`。服务没起、副屏
没接时，hook 静默失败，Claude Code 完全不受影响——这是架构的第一原则。

## 4. 组件规格

全部组件位于 `H:\turzx\turzx-coding-hud\`。

### 4.1 Hook 转发器 — `hud-hook.cmd`
Windows 批处理。被 Claude Code hooks 调用，把事件 JSON（stdin）`curl` POST 到
`http://localhost:4317/hook`。要求：`-m 1`（1 秒超时）、出错也强制 `exit /b 0`。
所有相关事件共用这一个脚本——事件类型由 JSON 里的 `hook_event_name` 区分。

### 4.2 Statusline 包装器 — `hud-statusline.cmd`
被配置为 Claude Code 的 statusline 命令。流程：(1) 读取 stdin JSON，转发到
`/statusline`；(2) 调用 claude-hud 原始 statusline 命令，把它的 stdout 透传出去。
安装时由安装器读取并保存用户当前的 `statusLine.command`（claude-hud 的）。

### 4.3 采集器 / 服务 — `server.js`（Node.js）
单进程常驻。职责：
- HTTP 端点：`POST /hook`、`POST /statusline`、`GET /`（静态托管 HUD 网页）
- 内存维护 `sessions` Map（键 = `session_id`）
- 由事件序列派生会话「当前活动」状态
- 解析 `TaskCreate`/`TaskUpdate` 工具调用重建任务列表
- WebSocket 服务：状态变化时把全量状态推给所有连接的 HUD 页面
- 端口 `4317`（可配置）

### 4.4 Usage 轮询器 — server.js 内模块
每 5 分钟（接口本身有 5min 限流窗口）执行：
- 从 `~/.claude/.credentials.json` 读 `claudeAiOauth.accessToken`
- `GET https://api.anthropic.com/api/oauth/usage`，请求头：
  `Authorization: Bearer <token>` · `anthropic-beta: oauth-2025-04-20` ·
  `User-Agent: claude-code/2.1`
- 响应：`{ five_hour:{utilization,resets_at}, seven_day:{utilization,resets_at} }`
- 失败降级：改读 claude-hud 的 `.usage-cache.json`，或显示 token+花费
- token 过期不自刷新——Claude Code 自身会刷新 `.credentials.json`

### 4.5 HUD 网页 — `index.html` + `hud.js` + `hud.css`
visual-final 视觉方案的实现。WebSocket 客户端，收到状态即重绘；断线自动重连。
负责「等待授权」强提醒态的整屏视觉切换。

### 4.6 启动器 — `start-hud.ps1` ✅ 已实现
(1) 检查服务是否在跑，没有则起；(2) 用
`[System.Windows.Forms.Screen]::AllScreens` 检测 1920×480 的副屏并取其坐标；
(3) 用浏览器（优先 Chrome、回退 Edge）
`--app=http://localhost:4317 --kiosk --window-position=X,Y` 打开。
开机自启采用**启动文件夹**方案（`shell:startup` 放隐藏窗口启动器 .cmd，无需管理员权限）。
检测不到副屏时给提示、不崩溃。

### 4.7 安装器 — `install.ps1` / `uninstall.ps1` ✅ 已实现
`install.ps1`：把 hook、statusline 配置写入 `~/.claude/settings.json`（先备份现有
`statusLine.command`），把启动器注册到 Windows 启动文件夹实现开机自启。
`uninstall.ps1`：还原 settings.json、移除启动文件夹启动项。
安装/卸载逻辑由 `tools/install-lib.js` 的纯函数（`mergeSettings`/`restoreSettings`）承载，
可独立单元测试。

### 4.8 回放工具 — `replay.js`（开发用）
回放录制好的 hook 事件序列到采集器，不开真会话也能开发/联调 HUD。

## 5. 数据模型与状态派生

### 5.1 会话记录
采集器为每个 `session_id` 维护：

```
{
  sessionId, model, plan, cwd, projectName, branch,
  status,            // working | running | waiting | idle | ended
  currentTool,       // 如 "Bash · npm test"
  timeline[],        // 环形缓冲，最近 ~20 条工具调用
  tasks[],           // 由 TaskCreate/TaskUpdate 重建
  toolCounts{},      // { Bash:4, Edit:11, ... }
  contextPct, linesAdded, linesRemoved, filesChanged,
  costUsd, durationMs, lastSeen
}
```

### 5.2 状态派生
| 事件 | 派生状态 |
|---|---|
| `UserPromptSubmit` | `working` |
| `PreToolUse` | `running`（记录工具名 + 关键参数） |
| `PostToolUse` | `working`（并累加 toolCounts、追加 timeline） |
| `Notification` | `waiting` → **触发强提醒** |
| `Stop` | `idle` |
| `SessionEnd` | `ended` |

聚焦会话 = `lastSeen` 最新者。超过约 10 分钟无更新的会话标记过期/移除
（阈值可配置）。

### 5.3 任务重建
`PostToolUse` 事件里若 `tool_name` 为 `TaskCreate`/`TaskUpdate`，从其
`tool_input` / `tool_response` 重建任务清单与完成度。

## 6. HUD 布局与视觉

最终视觉方案见可视化伴侣的 `visual-final.html`（已确认）。

### 6.1 布局（1920×480）
- **顶部横幅（~26%）**：六边形 `CC` 徽标 + 脉冲状态点 + 超大状态行
  （`RUNNING · BASH` + 等宽副行显示具体命令）+ 上下文窗口横向条 +
  模型/套餐/项目/分支芯片 + 1-3 个会话切换芯片。
- **第 1 列（40%）· 活动时间线**：hooks 驱动的实时工具调用列表，
  彩色工具类型菱形点，当前项青色高亮 + 左侧亮条。
- **第 2 列（33%）**：任务进度（横向条 + 清单）+ 本会话工具调用计数 +
  代码改动（+/− 行、文件数）+ 花费/时长/token 速率。
- **第 3 列（27%）· Account Usage**：5 小时窗口、7 天窗口两条横向流光条
  （各带重置倒计时），7 天用品红、5 小时用青。
- **底部读数条（~14%）**：LIVE 徽标 / 环境（CLAUDE.md·MCP·hooks）/ 会话
  时长 / 权限模式 / Shell 数 / WS 链接状态，分隔栏样式。

### 6.2 视觉风格
科幻仪表盘风：海军蓝底（径向渐变）、电光青 `#27d3f5` 主色 + 品红 `#ff2d8e`
辅色双霓虹、淡网格、扫描线 + 自上而下扫掠光带、尖角包框（clip-path 缺角）、
四角定位括弧。所有代码/路径/数字用等宽字体。进度条为带分段刻度的横向流光条
（不用圆环）。

### 6.3 强提醒态
会话进入 `waiting`（`Notification` 事件）时：整屏配色由青转品红→红、
扫描线变红、状态行字号放大并闪烁。这是副屏的核心价值——一眼可见。

## 7. 错误处理

| 故障 | 处理 |
|---|---|
| HUD/服务未启动 | hook 的 curl 超时静默失败，Claude Code 零影响 |
| 服务重启 | 内存态丢失；下一个事件/statusline tick 自动重新填充；HUD 网页 WebSocket 自动重连 |
| usage 接口失败 / 限流 | 降级显示 token+花费，或读 claude-hud 的 `.usage-cache.json` |
| OAuth token 过期 | usage 列暂显「同步中」；Claude Code 用时会自动刷新凭证 |
| 副屏未接入 | 启动器检测不到 1920×480 显示器时给提示，不崩溃 |
| 多个 HUD 页面 | 服务向所有 WebSocket 连接广播，互不影响 |

## 8. 测试策略

- **采集器状态机（单元测试）**：喂入 hook 事件序列 → 断言派生状态、时间线
  内容、任务重建结果、toolCounts。
- **回放工具 `replay.js`**：录制一段真实 hook 序列，反复驱动采集器与 HUD，
  无需开真会话即可开发联调。
- **HUD 网页**：靠回放工具 + 浏览器目测；`waiting` 强提醒态单独验证。
- **容错验证**：服务关闭状态下跑 Claude Code，确认 hook 失败不报错、不卡顿。

## 9. 待研究项 / 风险

1. **Chrome/Edge kiosk 定位到指定副屏**：`--window-position` + `--kiosk` 在
   多显示器下的实际行为需实测，可能要配合窗口尺寸/全屏切换。
   **实测结论（2026-05-18）**：Chrome `--app --kiosk --window-position=X,Y --window-size=W,H`
   可正确定位到副屏指定坐标，启动器已采用此方案。

2. **副屏坐标检测**：`Screen.AllScreens` 取虚拟桌面坐标的可靠性需验证。
   **实测结论（2026-05-18）**：`[System.Windows.Forms.Screen]::AllScreens` 可取到多屏
   虚拟桌面坐标（本机：主屏 0,0·3440×1440；副屏 3440,0·1280×800），可靠可用。

3. **hooks 在 Windows 上的调用 shell**：确认 `.cmd` 转发器被正确调用且
   `exit /b 0` 能阻断非零退出码影响 PreToolUse。
4. **statusline 包装**：确认 claude-hud 的 statusline 命令可被外部脚本以同样
   stdin 透明转调。
5. usage 接口确切契约以 claude-hud `usage-api.js` 为准（已查证）。

## 10. 不在范围内（YAGNI）

- 副屏交互（批准工具调用、点选 AskUserQuestion）——明确不做。
- 硬件传感器（CPU/GPU 温度等）集成——纯编程 HUD。
- 历史数据持久化 / 趋势图——内存态即可，重启重建。
- 打包成 Electron 单应用——v1 用裸浏览器 kiosk；后续可作为升级项。
- 4+ 并行会话的复杂编排——按 1-3 个设计。



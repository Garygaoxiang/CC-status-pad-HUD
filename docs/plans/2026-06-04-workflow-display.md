# Workflow 显示（轻量版）· 设计文档

- 日期：2026-06-04
- 状态：设计已批准，待出实施计划
- 范围：运行期 M/N agent 计数 + 完成态短暂收尾；chip + 时间线进度行形态
- 前置：effort 显示已完成（见 `2026-06-04-effort-display.md`，其文末「后续」即本特性立项）

## 背景与目标

Claude Code 的 `Workflow` 工具在后台异步编排多个 subagent。它不在主会话生命周期内：
statusline 看不到、hook 顶多感知「启动过 workflow」，运行期进度只能逆向文件系统采集。
目标：在 HUD 以**轻量**形态实时反映「正在跑 workflow + M/N agent 进度」，跑完短暂收尾后消隐。

## 非目标

- 不做富展示（agent 明细、实时 token、当前 phase 高亮）——撑不进 chip+进度行形态，留作后续。
- 不改 hook / statusline 通道——workflow 不走这两条，纯新增第三条只读文件轮询渠道。
- 不显示历史 workflow 列表——只反映「当前活跃 / 刚完成」单个。

## 数据源（实测锚定的关键事实）

session 目录 = `~/.claude/projects/<slug>/<sid>/`，由快照里 `transcriptPath`（`.../<sid>.jsonl`）去后缀推出。
其下两条路径分工：

```
<sid>/subagents/workflows/<runId>/         ← 运行期 agent 产物（实时增长）
      agent-<id>.meta.json                    每 agent 启动写（内容仅 {"agentType":...}）
      agent-<id>.jsonl                        每 agent 完成写
      journal.jsonl                           started/result 事件（无 phase/label）
<sid>/workflows/<runId>.json               ← 终态汇总，仅完成时落盘（信息极全）
<sid>/workflows/scripts/<name>-<runId>.js  ← 脚本源码，含 meta.phases
```

runId 三处一致（如 `wf_02c8b2a5-ddc`）。判定与取数：

| 信号 | 含义 |
|---|---|
| `workflows/<runId>.json` 不存在 | **运行中** |
| 同上存在且 `now − mtime < DONE_TTL(60s)` | **刚完成**（显示 ✓） |
| 同上存在且 mtime 已旧 | 已收尾，不渲染 |
| M（完成）= `agent-*.jsonl` 数 | 运行期；完成态用 wf json `agentCount` |
| N（已启动）= `agent-*.meta.json` 数 | 运行期；完成态 = `agentCount` |
| name | `scripts/<name>-<runId>.js` 文件名去 runId 后缀；完成态优先 wf json `workflowName` |
| phaseTotal | 脚本源码 `meta.phases.length`；解析失败 → `null`（降级） |

**运行期能力边界**：当前在哪个 phase、agent label、实时 token **拿不到**（journal 仅 started/result，
meta.json 仅 `{agentType}`）；这些只在终态 wf json 的 `workflowProgress` 里有。
故运行期进度行 phase 段显示 `·/总数`（当前 phase 未知）。

## 设计（五段，全部落在现有纯函数架构内）

### 段 1 · 采集层

**新增 `src/workflow.js`**（IO 与纯函数分离，照 `transcript.js` 先例）。

纯函数（Node 直测）：
- `sessionDirFromTranscript(transcriptPath)` — `.../<sid>.jsonl` → `.../<sid>`。
- `parseWorkflowName(scriptFileName, runId)` — `hook-probe-wf_xxx.js` + runId → `hook-probe`。
- `parsePhaseTotal(scriptText)` — 正则抓 `meta.phases` 块内 `title:` 计数；失败 → `null`。
- `deriveWorkflow(raw, now)` — 已读取的原始数据 → `session.workflow` 或 `null`（判定逻辑全在此）。
  多候选优先级：**running 优先于 done**；同类取 mtime 最新（running 按 agent 文件、done 按 wf json）。

IO 函数（在 workflow.js，被 server.js 调）：
- `collectWorkflow(sessionDir, now)` — readdir/stat/readFile 组装 raw，调 deriveWorkflow。薄。

**`session.workflow` 形状**（写进 `createSession()`）：

```js
workflow: null | {
  name, runId,
  status,       // 'running' | 'done'
  doneAgents,   // M
  totalAgents,  // N（running=已启动；done=agentCount）
  phaseTotal,   // 整数 | null
}
```

**`src/server.js`** 新增 `pollWorkflows`（克隆 `pollTranscripts`）：遍历 sessions →
有 transcriptPath 的推导 sessionDir → `collectWorkflow` → 写 `session.workflow`、dirty 才 broadcast。
新增常量 `WF_POLL_MS = 8_000`、`DONE_TTL = 60_000`。整体 try/catch 静默。

**`src/state.js`**：`createSession()` 加 `workflow: null` 一字段。轮询器直接
`sessions.set(id, {...sess, workflow})`，**不经** applyEvent/applyStatusline（与 contextPct 同模式，
不动状态派生表）。

### 段 2 · 格式层 `public/format.js`（纯标量，照 `effortLabel` 先例）

- `workflowChipText(wf)` — running→`⚙ WF 3/8`；done→`⚙ WF ✓ 8/8`；null→`''`。
- `workflowClass(wf)` — running→`wf-run`；done→`wf-done`；null→`''`。
- `workflowPct(wf)` — `M/N*100` 取整；done→100；N=0→0（喂现有 `barWidth`）。
- `workflowPhaseText(wf)` — phaseTotal 有→`phase ·/4`；null→`''`。
- `name` 不进 format（外来文本，留给 render 层 `esc()`）。

### 段 3 · 渲染层 `public/render.js`（照 `effortChip` 先例加两局部函数）

- `workflowChip(wf)` — chips 数组在 `effortChip` 之后插入：`[⚡MAX][⚙ WF 3/8][hud]`。
- `workflowProgress(wf)` — `renderTimeline` 开头插入（currentTool act 行**之上**）：
  name 行 + `M/N` + 复用 `.bar` 进度条 + phase 段；`.wfp` 自带下边框分隔。
- 无 workflow 时两处均返回 `''` → 优雅降级，常态布局零变化。
- 安全：`wf.name` 经 `esc()`；数字字段同 `linesAdded` 信任采集层。

### 段 4 · 样式层 `public/hud.css`（复用 `.chip`/`.bar`/`.sh`）

- `.wf-run` 青 `#27d3f5`、`.wf-done` 绿 `#3ff58f`（照 effort `.e-*` 先例）。
- `.wfp` 进度块容器 + `border-bottom` 分隔；`.wfp-h` flex（name 左、`M/N` 右）。
- **微动克制**：运行中只靠进度条自带 `.sh` shimmer，chip 不额外闪 →
  整屏强提醒仍专属 `waiting` 态。实现时先读 hud.css 对齐变量，不硬编码重复值。

### 段 5 · fixture + 测试（TDD：先红后绿）

- `tests/workflow.test.js`（新建）：`deriveWorkflow` 全覆盖（running / done / hidden /
  无 workflow / 多 runId 取最新）；三个解析纯函数（含降级）；`collectWorkflow` 一个
  `os.tmpdir` 集成测试（造真实 meta/jsonl/wf.json 验 IO 组装）。
- `tests/format.test.js`：4 标量覆盖 running/done/null + N=0 + phaseTotal=null。
- `tests/render.test.js`：banner 有/无 chip、timeline 有/无进度块、`name` 经 `esc()`（XSS 用例）。
- `tests/state.test.js`：`createSession()` 含 `workflow: null`。
- 目测：replay 不覆盖；在本会话 session 目录临时造**无 wf json 的 runId 目录**模拟 running，
  启动 server 看 HUD。收尾按 memory `hud-update-restart` 重启验证。

## 配色 / 文案规格

| status | chip 文案 | class | 配色 |
|--------|-----------|-------|------|
| running | `⚙ WF M/N` | `wf-run` | 青 `#27d3f5`（进度条 shimmer） |
| done | `⚙ WF ✓ N/N` | `wf-done` | 绿 `#3ff58f` |
| 无 | — | — | 不渲染 |

## 架构安全检查（最高优先级）

改动全在 HUD 侧：采集器纯函数 + 一个只读 fs 轮询器 + 网页渲染。**不碰 hook、不碰
statusline 包装器**，其「出错 exit 0」保护不变。`pollWorkflows` 整体 try/catch 静默，
单会话采集失败不影响其他会话与 HUD → **对 Claude Code 运行零风险**。

## 数据契约变更

snapshot 的 session 记录新增 `workflow` 字段（以 `createSession()` 为准，自动纳入契约）。
收尾同步更新 `CLAUDE.md` 数据契约段，标注来源与「运行期只 M/N、当前 phase 不可得」的已知限制。

## 后续（单独立项，非本次范围）

- 当前 phase 高亮：需验证复杂 workflow 的 `journal.jsonl` 是否含 `workflow_phase` 事件。
- 完成态富信息：wf json 的 `totalTokens` / 各 agent `workflowProgress` 明细。
- 多并发 workflow 同时展示。

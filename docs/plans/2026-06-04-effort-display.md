# Effort 显示 · 设计文档

- 日期：2026-06-04
- 状态：设计已批准，待出实施计划
- 范围：仅 effort 等级显示；workflow 单独立项（见文末）

## 背景与目标

Claude Code 近期新增 effort（推理努力等级，`/effort low|medium|high|xhigh|max`）。
当前 HUD 不显示 effort，无法反映会话真实推理档位。目标：在 banner 上以独立
chip 实时显示当前会话的 effort 等级，按等级分色，高 effort 醒目提醒。

## 非目标

- **不做 workflow 显示**。Workflow 是后台异步运行时，不在主会话生命周期里：
  statusline 完全看不到 workflow 进度，hook 顶多能感知"启动过 workflow"。要显示
  phase/agent 进度只能新增第三条采集渠道（读 `~/.claude/projects/<session>/` 下的
  workflow 脚本 + `agent-*.jsonl`），纯逆向、无官方契约、脆弱、工作量大。与 effort
  不同源、不同机制，单独立项再评估。

## 数据源（关键事实）

effort 仅来自 **statusline 命令的 stdin JSON**，字段路径 `effort.level`：

```json
{ "effort": { "level": "max" } }
```

- 取值：`low / medium / high / xhigh / max`（具体档位随模型，按模型校准）。
- **实时**反映 `/effort` 命令的中途改动。
- 当前模型不支持 effort 时，整个 `effort` 对象**缺省**（天然降级信号）。
- hook 事件 payload **不含** effort，无需改 hook 通道。

## 设计（五层改动，全部落在现有纯函数架构内）

### 1. 采集层 `src/state.js`
- `createSession()` 新增字段 `effort: null`。
- `applyStatusline()` 新增：`s.effort = sl.effort?.level ?? null;`

**关键决策（唯一偏离现有模式处）**：其他字段都用"有值才更新"语义，effort 例外，
采用**反映当次真实值**。理由：statusline 是完整快照，effort 缺省明确意味着"当前模型
不支持/未设"，必须能从"有"清回"无"；否则切到不支持 effort 的模型后会残留旧值显示
错误档位。代码注释需写明此区别。

### 2. 格式层 `public/format.js`（纯标量，可 Node 测试）
- `effortLabel(level)`：`low→LOW · medium→MED · high→HIGH · xhigh→XHIGH · max→MAX`；
  未知非空值兜底为大写原值；空值返回 `''`。
- `effortClass(level)`：三档配色类，`low|medium→e-lo` · `high→e-hi` · `xhigh|max→e-max`；
  空值返回 `''`。

### 3. 渲染层 `public/render.js`
- `renderBanner` 的 chips 数组中，`MODEL` chip 之后插入 effort chip：
  `<span class="chip {effortClass}">⚡ {effortLabel}</span>`。
- label 经 `esc()`；`⚡` 为静态图标。
- effort 为空时该 chip 返回 `''` → 不渲染（优雅降级）。

### 4. 样式层 `public/hud.css`
- 复用现有 `.chip` 基础样式，新增三个修饰类：
  - `.e-lo` — 冷青低调（low/medium）
  - `.e-hi` — 橙 `#f0a35e`（high）
  - `.e-max` — 警示金 `#ffcf3f` + 微闪 animation（xhigh/max）
- 微闪克制：仅 chip 自身闪，**不触发整屏告警**（整屏强提醒仍专属 `waiting` 态）。

### 5. fixture + 测试
- `tools/fixtures/statusline.json` 补 `"effort": { "level": "max" }`，让 replay 目测到 chip。
- 测试点：
  - `tests/state.test.js`：applyStatusline 解析 `effort.level`；effort 缺省时清回 null。
  - `tests/format.test.js`：`effortLabel` / `effortClass` 覆盖五等级 + 未知值 + 空值。
  - `tests/render.test.js`：renderBanner 有 effort 时含 chip、无 effort 不含。

## 配色 / 文案规格

| level  | label | class  | 配色           |
|--------|-------|--------|----------------|
| low    | LOW   | e-lo   | 冷青低调       |
| medium | MED   | e-lo   | 冷青低调       |
| high   | HIGH  | e-hi   | 橙 `#f0a35e`   |
| xhigh  | XHIGH | e-max  | 警示金（微闪） |
| max    | MAX   | e-max  | 警示金（微闪） |
| 缺省   | —     | —      | 不渲染         |

## 架构安全检查（最高优先级原则）

改动全部在 HUD 侧（采集器解析 + 网页渲染）；不碰 hook、不碰 statusline 包装器，
后者"出错 exit 0"的保护不变 → **对 Claude Code 运行零风险**。

## 数据契约变更

snapshot 的 session 记录新增 `effort` 字段（以 `createSession()` 为准，自动纳入契约）。
收尾时同步更新 `CLAUDE.md` 的数据契约段，标注 `effort` 来自 statusline `effort.level`。

## 后续（单独立项，非本次范围）

workflow 显示需新增文件轮询采集渠道，解析会话目录下 workflow 产物，重建
phase/agent 进度。需先实测 `Workflow` 工具是否触发 `PreToolUse`（决定能否做轻量
"正在跑 workflow"标记）。留待独立 session 评估。

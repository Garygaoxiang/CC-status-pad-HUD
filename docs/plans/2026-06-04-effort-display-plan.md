# Effort 显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 HUD banner 上以独立 chip 实时显示当前会话的 effort 等级，按等级分色。

**Architecture:** 沿用现有纯函数三层（state 采集 → format 标量 → render HTML），effort 仅来自 statusline 的 `effort.level`，缺省即不渲染。改动全在 HUD 侧，对 Claude Code 零风险。

**Tech Stack:** Node.js ESM、`node:test` + `node:assert/strict`、原生浏览器 ESM、纯 CSS。

设计文档：`docs/plans/2026-06-04-effort-display.md`。

---

### Task 1: 采集层 — state.js 解析 effort

**Files:**
- Modify: `src/state.js`（`createSession` 加字段；`applyStatusline` 加解析）
- Test: `tests/state.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `tests/state.test.js` 末尾：

```js
test('createSession 初始 effort 为 null', () => {
  assert.equal(createSession('abc').effort, null);
});

test('applyStatusline 解析 effort.level，且可从有清回无（反映当次）', () => {
  let s = applyStatusline(createSession('abc'), { effort: { level: 'max' } }, 1);
  assert.equal(s.effort, 'max');
  s = applyStatusline(s, { model: { display_name: 'Opus' } }, 2); // 当次无 effort
  assert.equal(s.effort, null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/state.test.js`
Expected: FAIL —— `s.effort` 为 `undefined`，不等于 `null`/`'max'`。

- [ ] **Step 3: 最小实现**

`src/state.js` 的 `createSession()` 里，把 `model: null,` 那行改为同时含 effort：

```js
    model: null, effort: null, plan: null, cwd: null, projectName: null, branch: null,
```

`applyStatusline()` 里，紧接 `if (sl.model?.display_name) s.model = sl.model.display_name;` 之后加一行：

```js
  // effort 与其他字段不同：反映当次真实值。statusline 是完整快照，
  // effort 缺省即"当前模型不支持/未设"，必须能从有清回无，否则切模型后残留旧档。
  s.effort = sl.effort?.level ?? null;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/state.test.js`
Expected: PASS（含新增两条与全部既有用例）。

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: 采集 statusline effort 等级到会话状态"
```

---

### Task 2: 格式层 — format.js 的 effortLabel / effortClass

**Files:**
- Modify: `public/format.js`（新增两个导出纯函数）
- Test: `tests/format.test.js`

- [ ] **Step 1: 写失败测试**

把 `tests/format.test.js` 顶部 import 改为追加两个名字：

```js
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
  effortLabel, effortClass,
} from '../public/format.js';
```

追加到文件末尾：

```js
test('effortLabel 映射等级、未知大写、空值空串', () => {
  assert.equal(effortLabel('low'), 'LOW');
  assert.equal(effortLabel('medium'), 'MED');
  assert.equal(effortLabel('high'), 'HIGH');
  assert.equal(effortLabel('xhigh'), 'XHIGH');
  assert.equal(effortLabel('max'), 'MAX');
  assert.equal(effortLabel('weird'), 'WEIRD');
  assert.equal(effortLabel(null), '');
});

test('effortClass 三档分色、空与未知不上色', () => {
  assert.equal(effortClass('low'), 'e-lo');
  assert.equal(effortClass('medium'), 'e-lo');
  assert.equal(effortClass('high'), 'e-hi');
  assert.equal(effortClass('xhigh'), 'e-max');
  assert.equal(effortClass('max'), 'e-max');
  assert.equal(effortClass(null), '');
  assert.equal(effortClass('weird'), '');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/format.test.js`
Expected: FAIL —— `effortLabel`/`effortClass` 未导出（ReferenceError / undefined）。

- [ ] **Step 3: 最小实现**

`public/format.js` 末尾追加：

```js
const EFFORT_LABEL = { low: 'LOW', medium: 'MED', high: 'HIGH', xhigh: 'XHIGH', max: 'MAX' };

export function effortLabel(level) {
  if (!level) return '';
  return EFFORT_LABEL[level] || String(level).toUpperCase();
}

export function effortClass(level) {
  if (level === 'high') return 'e-hi';
  if (level === 'xhigh' || level === 'max') return 'e-max';
  if (level === 'low' || level === 'medium') return 'e-lo';
  return ''; // 空值或未知：基础 chip 样式，不分色
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/format.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add public/format.js tests/format.test.js
git commit -m "feat: effort 等级标签与配色映射函数"
```

---

### Task 3: 渲染层 — render.js 的 effort chip

**Files:**
- Modify: `public/render.js`（import 补两个函数；新增 `effortChip`；插入 chips 数组）
- Test: `tests/render.test.js`

- [ ] **Step 1: 写失败测试**

追加到 `tests/render.test.js` 末尾：

```js
test('renderBanner 含 effort chip 并按等级配色', () => {
  const html = renderBanner({ sessions: [] }, { effort: 'max' });
  assert.match(html, /class="chip e-max"/);
  assert.match(html, /⚡ MAX/);
});

test('renderBanner 无 effort 不渲染 effort chip', () => {
  const html = renderBanner({ sessions: [] }, { effort: null });
  assert.doesNotMatch(html, /⚡/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/render.test.js`
Expected: FAIL —— 输出无 `⚡ MAX` 也无 `chip e-max`。

- [ ] **Step 3: 最小实现**

`public/render.js` 顶部 import 改为补两个名字：

```js
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
  effortLabel, effortClass,
} from './format.js';
```

在现有 `chip()` 函数之后新增 `effortChip()`：

```js
function effortChip(level) {
  const label = effortLabel(level);
  if (!label) return '';
  return `<span class="chip ${effortClass(level)}">⚡ ${esc(label)}</span>`;
}
```

在 `renderBanner` 的 `chips` 数组里，`MODEL` chip 之后插入 effort chip：

```js
  const chips = [
    chip(s.model && String(s.model).toUpperCase(), 'k'),
    effortChip(s.effort),
    chip(s.plan, 'm'),
    chip(s.projectName),
    s.branch ? `<span class="chip mono">⎇ ${esc(s.branch)}</span>` : '',
  ].join('');
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/render.test.js`
Expected: PASS（新增两条 + 既有 banner 用例不破坏，因 SNAP 会话无 effort 字段、`effortChip` 返回 `''`）。

- [ ] **Step 5: 提交**

```bash
git add public/render.js tests/render.test.js
git commit -m "feat: banner 渲染 effort 等级 chip"
```

---

### Task 4: 样式层 — hud.css 配色 + fixture

**Files:**
- Modify: `public/hud.css`（新增 `.e-lo` / `.e-hi` / `.e-max` + `@keyframes effortPulse`）
- Modify: `tools/fixtures/statusline.json`（补 `effort` 字段供 replay 目测）

本 Task 是展示/数据样本，无单元测试，靠全量测试不回归 + replay 目测验证。

- [ ] **Step 1: 加配色类**

`public/hud.css` 中，紧接 `.chip.m{...}` 那行之后新增（保持现有 2 空格缩进）：

```css
  .chip.e-lo{border-color:#2f5a7a;color:#86b3d8;background:#0a1a2c}
  .chip.e-hi{border-color:#f0a35e;color:#ffc88f;background:#241606}
  .chip.e-max{border-color:#ffcf3f;color:#ffe79a;background:#241d04;animation:effortPulse 1.1s ease-in-out infinite}
  @keyframes effortPulse{0%,100%{box-shadow:0 0 4px rgba(255,207,63,.35)}50%{box-shadow:0 0 14px rgba(255,207,63,.85)}}
```

- [ ] **Step 2: 补 fixture**

`tools/fixtures/statusline.json` 中，`"model": {...}` 那行之后插入：

```json
  "effort": { "level": "max" },
```

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `npm test`
Expected: 全绿。重点确认 `tests/e2e.test.js` / `tests/server.test.js` 不因 fixture 多了 `effort` 字段而失败（它们不应断言 statusline 对象的精确结构）。若失败，按报错定位是哪条断言过严，再决定调整测试或回退 fixture 改动。

- [ ] **Step 4: replay 目测**

Run（两个终端）：`npm start` 然后 `node tools/replay.js`
Expected: HUD banner 在 MODEL chip 右侧出现金色 `⚡ MAX` chip 并微闪。

- [ ] **Step 5: 提交**

```bash
git add public/hud.css tools/fixtures/statusline.json
git commit -m "style: effort chip 等级配色与 max 微闪"
```

---

### Task 5: 文档 — CLAUDE.md 数据契约

**Files:**
- Modify: `CLAUDE.md`（数据契约段补 effort 来源）

- [ ] **Step 1: 补数据契约说明**

`CLAUDE.md` 的「## 数据契约」段，在 `- 会话记录字段以 \`state.js\` 的 \`createSession()\` 为准。` 这一行之后新增一行：

```markdown
- `effort` 来自 statusline 的 `effort.level`（low/medium/high/xhigh/max），反映当次真实值；模型不支持时为 `null`，HUD 不渲染该 chip。
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: 数据契约补充 effort 字段说明"
```

---

## Self-Review

- **Spec 覆盖**：设计文档五层改动 → Task 1(state)、Task 2(format)、Task 3(render)、Task 4(css+fixture)、Task 5(契约文档)，逐项有对应任务，无遗漏。
- **Placeholder 扫描**：无 TBD/TODO；每个代码步骤均含可直接落地的真实代码与命令。
- **类型/命名一致**：`effort`（字段）、`effortLabel`/`effortClass`（format 导出）、`effortChip`（render 私有）、`e-lo`/`e-hi`/`e-max`（class）在 Task 1→5 间引用一致；`effortClass('max')='e-max'` 与 css `.chip.e-max`、render `class="chip e-max"`、测试正则三处对齐。
- **架构安全**：改动全在 HUD 侧，不碰 hook / statusline 包装器，对 Claude Code 零风险。


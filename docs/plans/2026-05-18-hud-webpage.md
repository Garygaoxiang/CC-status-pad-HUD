# HUD 网页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 1920×480 的单页科幻仪表盘 HUD，订阅采集器的 SSE `GET /events`，把会话状态实时画到副屏；会话进入 `waiting` 时整屏强提醒。

**Architecture:** 零构建、零依赖的静态 HTML/CSS/JS。`format.js` 是纯标量格式化、`render.js` 是纯 HTML 片段生成 —— 二者浏览器与 Node 测试共用，可在 Node 里 TDD。`hud.js` 是薄胶水层：用浏览器原生 `EventSource`（自带断线重连）连 `/events`，每来一帧快照就把 `render.js` 的输出塞进 DOM，并按 `waiting` 切换整屏告警态。采集器 `server.js` 增加 `public/` 静态托管，HUD 由 `GET /` 提供。

**Tech Stack:** 原生 HTML/CSS/JS、ESM（`<script type="module">`）、`EventSource`、Node `node:test` + `node:assert`。无 npm 依赖。

**数据契约:** 采集器快照 `{ focusId, sessions[], usage, ts }`。会话记录字段见 `src/state.js` 的 `createSession`。`usage` 形如 `{ fiveHour, sevenDay, fiveHourResetAt, sevenDayResetAt }`（百分比 0-100 整数或 null，见 `src/usage.js` 的 `parseUsage`），未取到时为 `null`。

**已知限制（不在本计划范围）:** `src/state.js` 当前不填充 `contextPct` / `filesChanged`（恒为 0），HUD 照契约渲染，会一直显示 0。这是计划 1 的后续项，本计划只忠实渲染契约，不改采集器派生逻辑。

**前置条件:** 本计划依赖计划 1 的代码（`src/server.js`、`src/state.js`、`tools/replay.js`）。必须在 `feat/collector-pipeline` 分支或其后继分支上执行 —— 不要从 `master` 起步（计划 1 尚未合并，`master` 上没有采集器代码）。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `public/index.html` | 静态 DOM 骨架：HUD 外框、网格、四角括弧、各动态区容器 |
| `public/hud.css` | 全部样式 —— 科幻仪表盘 + `waiting` 整屏告警态 |
| `public/format.js` | 纯标量格式化：状态文案、时钟、工具配色、进度条宽度、倒计时、时长、HTML 转义 |
| `public/render.js` | 纯 HTML 片段生成：输入快照/会话，返回横幅、时间线、任务、用量、底栏的 HTML 字符串 |
| `public/hud.js` | 胶水层：`EventSource` 订阅 `/events`、装配 `render.js` 输出进 DOM、切换 `waiting` 告警态、连接状态指示 |
| `src/server.js`（改） | 增加 `public/` 静态托管，`GET /` → `index.html` |
| `tests/server.test.js`（改） | 追加静态托管测试 |
| `tests/format.test.js`（新） | `format.js` 单元测试 |
| `tests/render.test.js`（新） | `render.js` 单元测试（断言 HTML 字符串含预期内容） |

`format.js` / `render.js` 是纯函数，无 DOM、无浏览器 API，因此能在 Node 里 TDD。`index.html` / `hud.css` / `hud.js` 靠回放工具 `tools/replay.js` + 浏览器目测验证（符合 `docs/spec.md` 第 8 节测试策略）。

---

## Task 1: 采集器静态托管 + HUD 页面骨架

**Files:**
- Create: `public/index.html`
- Modify: `src/server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: 创建 `public/index.html` 骨架**

只放静态外框与空容器；动态内容由 `hud.js` 在运行时填充。

```html
<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=1920, initial-scale=1">
  <title>Claude Code HUD</title>
  <link rel="stylesheet" href="hud.css">
</head>
<body>
  <div class="hud" id="hud">
    <div class="grid"></div>
    <div class="cnr c1"></div><div class="cnr c2"></div>
    <div class="cnr c3"></div><div class="cnr c4"></div>

    <div class="pnl banner" id="banner"></div>

    <div class="cols">
      <div class="pnl col-tl">
        <div class="lbl">活动时间线 · LIVE</div>
        <div class="tl mono" id="timeline"></div>
      </div>
      <div class="pnl col-mid">
        <div id="tasks"></div>
        <div id="toolcounts"></div>
        <div id="changes"></div>
      </div>
      <div class="pnl col-usage" id="usage"></div>
    </div>

    <div class="pnl footer mono" id="footer"></div>
  </div>
  <div class="alert" id="alert"></div>
  <script type="module" src="hud.js"></script>
</body>
</html>
```

- [ ] **Step 2: 给 `src/server.js` 加静态托管 —— 先写失败测试**

把下面三个测试追加到 `tests/server.test.js`（先读该文件确认 `import` 风格；若已 `import test`/`assert`/`createCollector` 则不要重复导入）。

```js
test('GET / 返回 HUD 页面', async () => {
  const c = createCollector();
  c.start(0, { poll: false });
  const { port } = c.server.address();
  const res = await fetch(`http://localhost:${port}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /id="hud"/);
  await c.stop();
});

test('未知静态文件返回 404', async () => {
  const c = createCollector();
  c.start(0, { poll: false });
  const { port } = c.server.address();
  const res = await fetch(`http://localhost:${port}/nope.css`);
  assert.equal(res.status, 404);
  await c.stop();
});

test('路径穿越被拦截', async () => {
  const c = createCollector();
  c.start(0, { poll: false });
  const { port } = c.server.address();
  const res = await fetch(`http://localhost:${port}/%2e%2e%2f%2e%2e%2fsrc%2fserver.js`);
  assert.ok(res.status === 403 || res.status === 404);
  await c.stop();
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `node --test tests/server.test.js`
Expected: 新增 3 个测试中 `GET /` 与路径穿越失败（当前 `server.js` 对未匹配路径一律 404，`GET /` 会得到 404 而非 200）。

- [ ] **Step 4: 在 `src/server.js` 实现静态托管**

合并 `node:url` 导入并新增三个导入（顶部，第 1-6 行附近）：

```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
```

在 `DEFAULT_PORT` 常量下方新增：

```js
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
```

把 `server` 处理函数末尾那行 `res.writeHead(404).end();`（`/events` 分支之后）替换为静态分支：

```js
    if (req.method === 'GET') {
      let rel;
      try { rel = decodeURIComponent(url.pathname); }
      catch { return res.writeHead(400).end(); }
      const filePath = normalize(join(PUBLIC_DIR, '.' + (rel === '/' ? '/index.html' : rel)));
      if (!filePath.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
      try {
        const buf = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        return res.end(buf);
      } catch {
        return res.writeHead(404).end();
      }
    }
    res.writeHead(404).end();
```

`'.' + rel` 让请求路径恒为相对段，配合 `normalize` + `startsWith(PUBLIC_DIR)`（`PUBLIC_DIR` 末尾带分隔符）拦住一切目录穿越。

- [ ] **Step 5: 运行测试，确认通过**

Run: `node --test tests/server.test.js`
Expected: PASS（含原有测试 + 新增 3 个）。

- [ ] **Step 6: 提交**

```bash
git add public/index.html src/server.js tests/server.test.js
git commit -m "feat: 采集器静态托管 + HUD 页面骨架"
```

---

## Task 2: `format.js` —— 纯标量格式化

**Files:**
- Create: `public/format.js`
- Create: `tests/format.test.js`

- [ ] **Step 1: 写失败测试 `tests/format.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
} from '../public/format.js';

test('esc 转义 HTML 特殊字符', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
  assert.equal(esc(null), '');
});

test('statusText 运行中拆出工具名与命令', () => {
  assert.deepEqual(
    statusText({ status: 'running', currentTool: 'Bash · npm test' }),
    { big: 'RUNNING · BASH', sub: 'npm test' },
  );
});

test('statusText 无工具时回退到项目名', () => {
  assert.deepEqual(
    statusText({ status: 'idle', projectName: 'proj-api' }),
    { big: 'IDLE', sub: 'proj-api' },
  );
  assert.equal(statusText({ status: 'waiting' }).big, 'WAITING');
});

test('clock 格式化为 HH:MM:SS', () => {
  const t = new Date(2026, 4, 18, 14, 2, 31).getTime();
  assert.equal(clock(t), '14:02:31');
  assert.equal(clock(NaN), '--:--:--');
});

test('toolColor 已知工具有色、未知回退', () => {
  assert.equal(toolColor('Bash'), '#27d3f5');
  assert.equal(toolColor('Edit'), '#f0a35e');
  assert.equal(toolColor('Mystery'), '#5878a3');
});

test('barWidth 钳制在 0-100', () => {
  assert.equal(barWidth(44), '44%');
  assert.equal(barWidth(150), '100%');
  assert.equal(barWidth(-5), '0%');
  assert.equal(barWidth(null), '0%');
});

test('countdown 把重置时间转成倒计时', () => {
  const now = Date.now();
  assert.equal(countdown(new Date(now + 121 * 60000).toISOString(), now), '2h 01m');
  assert.equal(countdown(new Date(now + 7560 * 60000).toISOString(), now), '5d 06h');
  assert.equal(countdown(new Date(now + 3 * 60000).toISOString(), now), '3m');
  assert.equal(countdown(new Date(now - 1000).toISOString(), now), '现在');
  assert.equal(countdown(null, now), '—');
});

test('taskProgress 统计完成度', () => {
  assert.deepEqual(
    taskProgress([{ status: 'completed' }, { status: 'pending' }, { status: 'completed' }]),
    { done: 2, total: 3, pct: 67 },
  );
  assert.deepEqual(taskProgress([]), { done: 0, total: 0, pct: 0 });
});

test('duration 格式化时长', () => {
  assert.equal(duration(23 * 60000 + 11000), '23:11');
  assert.equal(duration(3661000), '1:01:01');
  assert.equal(duration(0), '0:00');
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/format.test.js`
Expected: FAIL —— `Cannot find module '../public/format.js'`。

- [ ] **Step 3: 实现 `public/format.js`**

```js
// public/format.js — 纯标量格式化。浏览器与 Node 测试共用，无 DOM 依赖。

const STATUS_LABEL = {
  working: 'WORKING', running: 'RUNNING', waiting: 'WAITING',
  idle: 'IDLE', ended: 'ENDED',
};
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const TOOL_COLOR = {
  Bash: '#27d3f5', Edit: '#f0a35e', Write: '#f0a35e', NotebookEdit: '#f0a35e',
  Read: '#6ea8ff', Grep: '#b58bff', Glob: '#b58bff', Task: '#3ff58f',
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ESC_MAP[c]);
}

export function statusText(session) {
  const s = session || {};
  const label = STATUS_LABEL[s.status] || 'IDLE';
  if (s.currentTool) {
    const [tool, ...rest] = String(s.currentTool).split(' · ');
    return { big: `${label} · ${tool.toUpperCase()}`, sub: rest.join(' · ') };
  }
  return { big: label, sub: s.projectName || '' };
}

export function clock(ts) {
  if (!Number.isFinite(ts)) return '--:--:--';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function toolColor(tool) {
  return TOOL_COLOR[tool] || '#5878a3';
}

export function barWidth(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.max(0, Math.min(100, n))}%`;
}

export function countdown(resetsAt, now = Date.now()) {
  if (!resetsAt) return '—';
  const ms = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return '现在';
  const m = Math.floor(ms / 60000);
  const p = (n) => String(n).padStart(2, '0');
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${p(h)}h`;
  if (h > 0) return `${h}h ${p(m % 60)}m`;
  return `${m % 60}m`;
}

export function taskProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;
  const done = list.filter((t) => t && t.status === 'completed').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function duration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/format.test.js`
Expected: PASS（9 个测试）。

- [ ] **Step 5: 提交**

```bash
git add public/format.js tests/format.test.js
git commit -m "feat: HUD 标量格式化模块 format.js"
```

---

## Task 3: `render.js` —— 横幅与时间线片段

**Files:**
- Create: `public/render.js`
- Create: `tests/render.test.js`

`render.js` 是纯函数：输入采集器快照/会话记录，返回 HTML 字符串片段，由 `hud.js` 塞进对应容器。所有外来文本都经 `esc()` 转义。本任务先做选焦、横幅、时间线。

- [ ] **Step 1: 写失败测试 `tests/render.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { focusSession, renderBanner, renderTimeline } from '../public/render.js';

const SNAP = {
  focusId: 's1',
  sessions: [
    {
      sessionId: 's1', status: 'running', currentTool: 'Bash · npm test',
      model: 'Opus 4.7', plan: 'MAX 5x', projectName: 'proj-api', branch: 'main',
      contextPct: 9, lastSeen: 100,
      timeline: [{ ts: 1, tool: 'Edit', label: 'Edit · App.tsx' }],
    },
    { sessionId: 's2', status: 'idle', timeline: [] },
  ],
};

test('focusSession 取 focusId 对应会话，回退首个', () => {
  assert.equal(focusSession(SNAP).sessionId, 's1');
  assert.equal(focusSession({ sessions: SNAP.sessions }).sessionId, 's1');
  assert.equal(focusSession({}), null);
});

test('renderBanner 含状态、芯片、会话切换', () => {
  const html = renderBanner(SNAP, SNAP.sessions[0]);
  assert.match(html, /RUNNING/);
  assert.match(html, /· BASH/);
  assert.match(html, /OPUS 4\.7/);
  assert.match(html, /class="chip m"/);
  assert.match(html, /⎇ main/);
  assert.match(html, /<span class="on">1<\/span>/);
});

test('renderBanner 转义注入字符', () => {
  const html = renderBanner({ sessions: [] }, { projectName: '<script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderTimeline 当前工具置顶为 act 行，历史倒序', () => {
  const html = renderTimeline(SNAP.sessions[0]);
  assert.match(html, /ev act/);
  assert.match(html, /▶ Bash · npm test/);
  assert.match(html, /Edit · App\.tsx/);
});

test('renderTimeline 空时间线给占位', () => {
  assert.match(renderTimeline({ timeline: [] }), /等待事件/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/render.test.js`
Expected: FAIL —— `Cannot find module '../public/render.js'`。

- [ ] **Step 3: 实现 `public/render.js`（横幅与时间线部分）**

```js
// public/render.js — 纯函数：输入快照/会话，返回 HTML 字符串片段。浏览器与 Node 测试共用。
import { esc, statusText, clock, toolColor, barWidth } from './format.js';

export function focusSession(snapshot) {
  const s = snapshot || {};
  const list = Array.isArray(s.sessions) ? s.sessions : [];
  return list.find((x) => x && x.sessionId === s.focusId) || list[0] || null;
}

function chip(text, cls = '') {
  return text ? `<span class="chip ${cls}">${esc(text)}</span>` : '';
}

function bannerStatus(session) {
  const { big, sub } = statusText(session);
  const [head, ...tail] = big.split(' · ');
  const tool = tail.length ? ` <b>· ${esc(tail.join(' · '))}</b>` : '';
  return `<h1>${esc(head)}${tool} <span class="cr">_</span></h1>`
    + `<p class="mono">${esc(sub)}</p>`;
}

export function renderBanner(snapshot, session) {
  const s = session || {};
  const pct = Math.round(Number(s.contextPct) || 0);
  const sessions = Array.isArray((snapshot || {}).sessions) ? snapshot.sessions : [];
  const chips = [
    chip(s.model && String(s.model).toUpperCase(), 'k'),
    chip(s.plan, 'm'),
    chip(s.projectName),
    s.branch ? `<span class="chip mono">⎇ ${esc(s.branch)}</span>` : '',
  ].join('');
  const sess = sessions.map((x, i) =>
    `<span class="${x && x.sessionId === s.sessionId ? 'on' : ''}">${i + 1}</span>`).join('');
  return `<div class="hex">CC</div>
<div class="stdot"></div>
<div class="sttxt">${bannerStatus(s)}</div>
<div class="ctx">
  <div class="top"><span>CONTEXT</span><b>${pct}%</b></div>
  <div class="bar"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
</div>
<div class="chips">${chips}</div>
<div class="sess">${sess}</div>`;
}

export function renderTimeline(session) {
  const s = session || {};
  const rows = [];
  if (s.currentTool) {
    rows.push(`<div class="ev act"><span class="d"></span>`
      + `<span class="t">${clock(s.lastSeen)}</span>`
      + `<span class="x">▶ ${esc(s.currentTool)}</span></div>`);
  }
  const tl = Array.isArray(s.timeline) ? [...s.timeline].reverse() : [];
  for (const e of tl) {
    rows.push(`<div class="ev"><span class="d" style="background:${toolColor(e.tool)}"></span>`
      + `<span class="t">${clock(e.ts)}</span>`
      + `<span class="x">${esc(e.label)}</span></div>`);
  }
  if (!rows.length) {
    rows.push('<div class="ev"><span class="x" style="color:#516a90">等待事件…</span></div>');
  }
  return rows.join('');
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/render.test.js`
Expected: PASS（5 个测试）。

- [ ] **Step 5: 提交**

```bash
git add public/render.js tests/render.test.js
git commit -m "feat: render.js 横幅与时间线片段"
```

---

## Task 4: `render.js` —— 任务、工具计数、代码改动、用量、底栏片段

**Files:**
- Modify: `public/render.js`
- Modify: `tests/render.test.js`

- [ ] **Step 1: 追加失败测试到 `tests/render.test.js`**

把文件顶部的 import 行替换为：

```js
import {
  focusSession, renderBanner, renderTimeline,
  renderTasks, renderToolCounts, renderChanges, renderUsage, renderFooter,
} from '../public/render.js';
```

在文件末尾追加：

```js
test('renderTasks 显示完成度与清单标记', () => {
  const html = renderTasks({ tasks: [
    { id: '1', subject: '建采集器', status: 'completed' },
    { id: '2', subject: '写 HUD', status: 'in_progress' },
    { id: '3', subject: '联调', status: 'pending' },
  ] });
  assert.match(html, /1 \/ 3/);
  assert.match(html, /class="done">✓<\/span> 建采集器/);
  assert.match(html, /class="now">▶<\/span> 写 HUD/);
});

test('renderTasks 无任务给占位', () => {
  assert.match(renderTasks({ tasks: [] }), /暂无任务/);
});

test('renderToolCounts 按次数降序', () => {
  const html = renderToolCounts({ toolCounts: { Bash: 4, Edit: 11 } });
  assert.match(html, /Edit <b>×11<\/b>[\s\S]*Bash <b>×4<\/b>/);
});

test('renderChanges 显示增删行与花费', () => {
  const html = renderChanges({
    linesAdded: 128, linesRemoved: 34, filesChanged: 7, costUsd: 0.84, durationMs: 1391000,
  });
  assert.match(html, /\+128/);
  assert.match(html, /−34/);
  assert.match(html, /\$0\.84/);
  assert.match(html, /23:11/);
});

test('renderUsage 已知用量画双窗口条', () => {
  const now = Date.now();
  const html = renderUsage({ usage: {
    fiveHour: 19, sevenDay: 11,
    fiveHourResetAt: new Date(now + 121 * 60000).toISOString(),
    sevenDayResetAt: new Date(now + 7560 * 60000).toISOString(),
  } }, now);
  assert.match(html, /19%/);
  assert.match(html, /2h 01m 后重置/);
  assert.match(html, /11%/);
});

test('renderUsage 无用量显示同步中', () => {
  assert.match(renderUsage({ usage: null }), /同步中/);
});

test('renderFooter 反映连接状态', () => {
  assert.match(renderFooter({ sessions: [{}, {}] }, { projectName: 'p' }, true), /SSE ●/);
  assert.match(renderFooter({ sessions: [] }, {}, false), /重连中/);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `node --test tests/render.test.js`
Expected: FAIL —— `renderTasks is not a function` 等（新函数未定义）。

- [ ] **Step 3: 在 `public/render.js` 补齐余下片段**

把顶部 import 行替换为（补上后三个格式化函数）：

```js
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
} from './format.js';
```

在文件末尾追加：

```js
export function renderTasks(session) {
  const tasks = Array.isArray((session || {}).tasks) ? session.tasks : [];
  const { done, total, pct } = taskProgress(tasks);
  const items = tasks.map((t) => {
    const st = t && t.status;
    const mark = st === 'completed' ? '<span class="done">✓</span>'
      : st === 'in_progress' ? '<span class="now">▶</span>' : '<span>·</span>';
    return `${mark} ${esc(t && t.subject)}`;
  }).join('&nbsp; ');
  return `<div class="sec" style="margin-top:0">
  <div class="h"><span class="lbl">任务进度</span><span class="n">${done} / ${total}</span></div>
  <div class="bar" style="margin-top:8px"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
  <div class="tk mono">${items || '<span style="color:#516a90">暂无任务</span>'}</div>
</div>`;
}

export function renderToolCounts(session) {
  const counts = (session || {}).toolCounts || {};
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const body = entries.length
    ? entries.map(([k, v]) => `${esc(k)} <b>×${v}</b>`).join(' &nbsp; ')
    : '<span style="color:#516a90">暂无调用</span>';
  return `<div class="sec">
  <span class="lbl">本会话工具调用</span>
  <div class="toolc mono">${body}</div>
</div>`;
}

export function renderChanges(session) {
  const s = session || {};
  const cost = `$${(Number(s.costUsd) || 0).toFixed(2)}`;
  return `<div class="sec">
  <span class="lbl">代码改动 · 花费</span>
  <div class="kv mono"><span style="color:#3ff58f">+${Number(s.linesAdded) || 0}</span><span style="color:#ff5ca3">−${Number(s.linesRemoved) || 0}</span><span class="m">${Number(s.filesChanged) || 0} 个文件</span></div>
  <div class="kv mono"><span>${cost}</span><span class="m">${duration(s.durationMs)}</span></div>
</div>`;
}

function gauge(name, pct, resetAt, grad, accent, now) {
  const known = Number.isFinite(pct);
  return `<div class="gz">
  <div class="g1"><span class="nm">${name}</span><span class="pc" style="color:${known ? accent : '#516a90'}">${known ? pct + '%' : '—'}</span></div>
  <div class="bar"><i style="width:${barWidth(known ? pct : 0)};background:${grad}"><span class="sh"></span></i></div>
  <div class="rs mono">${known ? '⟳ ' + countdown(resetAt, now) + ' 后重置' : '同步中…'}</div>
</div>`;
}

export function renderUsage(snapshot, now = Date.now()) {
  const u = (snapshot || {}).usage || {};
  return `<div class="lbl">Account Usage</div>
${gauge('5 小时窗口', u.fiveHour, u.fiveHourResetAt, 'linear-gradient(90deg,#27d3f5,#3ff58f)', '#27d3f5', now)}
${gauge('7 天窗口', u.sevenDay, u.sevenDayResetAt, 'linear-gradient(90deg,#ff2d8e,#ff8ac0)', '#ff5ca3', now)}
<div class="rs mono" style="margin-top:17px">SYNC 每 5min · /api/oauth/usage</div>`;
}

export function renderFooter(snapshot, session, connected) {
  const s = session || {};
  const count = Array.isArray((snapshot || {}).sessions) ? snapshot.sessions.length : 0;
  const link = connected
    ? '<span class="v cy">SSE ●</span>'
    : '<span class="v" style="color:#ff5ca3">SSE ○ 重连中</span>';
  return `<div class="rd"><span class="live"><i></i>LIVE</span></div>
<div class="rd"><span class="k">项目</span><span class="v">${esc(s.projectName || '—')}</span></div>
<div class="rd"><span class="k">会话时长</span><span class="v cy">${duration(s.durationMs)}</span></div>
<div class="rd grow"><span class="k">活动会话</span><span class="v">${count}</span></div>
<div class="rd"><span class="k">连接</span>${link}</div>`;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `node --test tests/render.test.js`
Expected: PASS（12 个测试）。

- [ ] **Step 5: 提交**

```bash
git add public/render.js tests/render.test.js
git commit -m "feat: render.js 任务/用量/底栏片段"
```

---

## Task 5: `hud.css` —— 科幻仪表盘样式

**Files:**
- Create: `public/hud.css`

视觉定稿在 `.superpowers/brainstorm/7277-1779007038/content/visual-final.html`。该文件 `<style>…</style>` 之间的内容就是成品样式表，只需搬过来并去掉 mockup 缩放包装、补上列宽与告警占位类。无单元测试 —— CSS 验证靠选择器自检 + Task 8 浏览器目测（符合 `docs/spec.md` 第 8 节）。

- [ ] **Step 1: 创建 `public/hud.css`，搬入定稿样式**

读取 `.superpowers/brainstorm/7277-1779007038/content/visual-final.html`，把 `<style>` 与 `</style>` 之间的**全部内容**逐字复制为 `public/hud.css`。

- [ ] **Step 2: 改造为整屏样式**

对 `public/hud.css` 做以下精确修改：

1. **删除** `.vp{...}` 整条规则（那是 mockup 预览框包装）。
2. **`.hud` 规则**：删除 `transform:scale(.46)` 和 `transform-origin:top left` 两个声明（副屏原生就是 1920×480，不缩放）。其余声明（`width:1920px;height:480px;box-sizing:border-box;padding:18px;…background`）保留。
3. **在文件顶部新增**页面级复位：

```css
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}
```

4. **在文件末尾追加**列宽与告警占位（`index.html` 用类名代替了定稿里的内联 `width`）：

```css
.col-tl{width:40%}
.col-mid{width:33%;display:flex;flex-direction:column}
.col-usage{width:27%}
.alert{display:none}
```

- [ ] **Step 3: 自检**

Run: `node -e "const c=require('fs').readFileSync('public/hud.css','utf8');for(const s of ['.hud','.banner','.bar','.ev','.gz','.footer','.col-tl','.alert'])if(!c.includes(s))throw new Error('缺选择器 '+s);if(c.includes('scale(.46)'))throw new Error('未去掉缩放');if(/\.vp\{/.test(c))throw new Error('未删 .vp');console.log('hud.css 自检通过')"`
Expected: 输出 `hud.css 自检通过`。

- [ ] **Step 4: 提交**

```bash
git add public/hud.css
git commit -m "feat: HUD 科幻仪表盘样式表"
```

---

## Task 6: `hud.js` —— SSE 订阅与 DOM 装配

**Files:**
- Create: `public/hud.js`

`hud.js` 是薄胶水层：用浏览器原生 `EventSource` 连 `/events`，每帧快照调 `render.js` 的纯函数，把结果塞进 `index.html` 的容器。`EventSource` 自带断线重连；额外补一道「连接被永久关闭后定时重连」兜底。逻辑薄，靠 Task 8 浏览器目测验证；本任务只做语法自检。

- [ ] **Step 1: 创建 `public/hud.js`**

```js
// public/hud.js — 胶水层：订阅 SSE，把 render.js 的纯函数输出装配进 DOM。
import {
  focusSession, renderBanner, renderTimeline, renderTasks,
  renderToolCounts, renderChanges, renderUsage, renderFooter,
} from './render.js';

const $ = (id) => document.getElementById(id);
let connected = false;
let snapshot = { focusId: null, sessions: [], usage: null, ts: 0 };

function paint() {
  const session = focusSession(snapshot);
  $('banner').innerHTML = renderBanner(snapshot, session);
  $('timeline').innerHTML = renderTimeline(session);
  $('tasks').innerHTML = renderTasks(session);
  $('toolcounts').innerHTML = renderToolCounts(session);
  $('changes').innerHTML = renderChanges(session);
  $('usage').innerHTML = renderUsage(snapshot);
  $('footer').innerHTML = renderFooter(snapshot, session, connected);
  // waiting 整屏告警态 —— Task 7 扩展 #alert 内容与配色
  document.body.classList.toggle('waiting', !!session && session.status === 'waiting');
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { connected = true; paint(); };
  es.onmessage = (e) => {
    connected = true;
    try { snapshot = JSON.parse(e.data); } catch { return; }
    paint();
  };
  es.onerror = () => {
    connected = false;
    paint();
    // EventSource 默认会自动重连；仅在连接被永久关闭时手动兜底
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

paint();      // 数据到达前先画占位态
connect();
```

- [ ] **Step 2: 语法自检**

Run: `node --check public/hud.js`
Expected: 无输出（ESM 语法正确）。`document` / `EventSource` 不会在 `--check` 下执行，只校验语法。

- [ ] **Step 3: 跑全量测试，确认无回归**

Run: `node --test`
Expected: PASS —— 计划 1 的 18 个测试 + 本计划新增的 server/format/render 测试全部通过。

- [ ] **Step 4: 提交**

```bash
git add public/hud.js
git commit -m "feat: hud.js SSE 订阅与 DOM 装配"
```

---

## Task 7: `waiting` 整屏强提醒态

**Files:**
- Modify: `public/hud.css`

会话进入 `waiting`（`Notification` 事件）时 `hud.js` 已给 `<body>` 加 `waiting` 类（Task 6）。本任务纯靠 CSS：整屏配色青转红、扫描线转红、状态行字号放大并闪烁、`#alert` 浮层做边缘红色脉冲晕影。无 JS 改动。

- [ ] **Step 1: 在 `public/hud.css` 末尾追加 `waiting` 态规则**

```css
/* —— waiting 整屏强提醒态 —— */
@keyframes pulse-r{0%,100%{box-shadow:0 0 7px 2px rgba(255,45,110,.5)}50%{box-shadow:0 0 20px 8px rgba(255,45,110,.95)}}
@keyframes alertvig{0%,100%{box-shadow:inset 0 0 60px 10px rgba(255,45,110,.22)}50%{box-shadow:inset 0 0 170px 55px rgba(255,45,110,.72)}}

.alert{position:fixed;inset:0;z-index:20;pointer-events:none}

body.waiting .hud{background:radial-gradient(115% 130% at 50% 34%,#3a0e1c 0%,#1a0408 73%)}
body.waiting .hud::after{background:linear-gradient(180deg,transparent,rgba(255,45,110,.16),transparent)}
body.waiting .cnr{border-color:#ff2d6e}
body.waiting .grid{background-image:linear-gradient(rgba(255,45,110,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,45,110,.05) 1px,transparent 1px)}
body.waiting .stdot{background:#ff2d6e;animation:pulse-r .7s infinite}
body.waiting .sttxt h1{color:#ffd6e2;font-size:58px;text-shadow:0 0 24px rgba(255,45,110,.95);animation:blink .8s steps(1) infinite}
body.waiting .sttxt h1 b,body.waiting .sttxt h1 .cr{color:#ff5ca3}
body.waiting .alert{display:block;animation:alertvig 1.1s ease-in-out infinite}
```

- [ ] **Step 2: 自检**

Run: `node -e "const c=require('fs').readFileSync('public/hud.css','utf8');for(const s of ['body.waiting','alertvig','pulse-r'])if(!c.includes(s))throw new Error('缺 '+s);console.log('waiting 态自检通过')"`
Expected: 输出 `waiting 态自检通过`。

- [ ] **Step 3: 提交**

```bash
git add public/hud.css
git commit -m "feat: waiting 整屏强提醒态样式"
```

---

## Task 8: 联调与最终验证

**Files:** 无新增（除非补录 fixture）。

本任务用回放工具驱动采集器、在浏览器里目测 HUD。`hud.js` / `hud.css` / `index.html` 是浏览器侧代码，无法在 Node 里单测 —— 这里靠回放 + 目测验证（`docs/spec.md` 第 8 节）。Step 4-6 需人工看屏，由执行编排者/用户完成，不能交给无头子代理。

- [ ] **Step 1: 启动采集器**

Run（独立终端，前台保持）：`node src/server.js`
Expected: 输出 `HUD 采集器已启动 :4317`。

- [ ] **Step 2: 自动冒烟 —— 静态资源可达**

Run:
```bash
for f in / /hud.css /hud.js /format.js /render.js; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:4317$f")
  echo "$f -> $code"
done
```
Expected: 每行均为 `200`。

- [ ] **Step 3: 回放真实事件序列**

Run: `node tools/replay.js`
Expected: 回放无报错跑完（采集器在 Step 1 已起；若提示端口占用说明已有实例，正常）。

- [ ] **Step 4: 浏览器目测 —— 运行态**

Run: `start http://localhost:4317/`（Windows 默认浏览器；副屏联调时改用 `start chrome --app=http://localhost:4317/`）
目测核对：
- 横幅显示状态行（如 `RUNNING · BASH`）、模型/项目/分支芯片、上下文条；
- 第 1 列时间线有彩色菱形点的工具调用列表，当前项青色高亮；
- 第 2 列任务进度条 + 清单、工具调用计数、代码改动行/花费；
- 第 3 列 Account Usage 双窗口条（取不到用量时显示「同步中…」属正常）；
- 底栏显示 LIVE、项目、时长、活动会话数、`SSE ●`。
- 整体为科幻仪表盘风（海军蓝、扫描线、尖角包框、四角括弧）。

- [ ] **Step 5: 目测 —— waiting 整屏强提醒态**

Run: `curl -s -X POST http://localhost:4317/hook -d "{\"hook_event_name\":\"Notification\",\"session_id\":\"demo\"}"`
Expected: HUD 立即整屏转红 —— 背景红、扫描线红、四角括弧红、状态行 `WAITING` 放大并闪烁、屏幕边缘红色脉冲晕影。
解除：`curl -s -X POST http://localhost:4317/hook -d "{\"hook_event_name\":\"Stop\",\"session_id\":\"demo\"}"`，HUD 应恢复青色常态。

- [ ] **Step 6: 目测 —— 断线重连**

在 Step 1 的终端按 `Ctrl+C` 停掉采集器。
Expected: HUD 底栏连接指示在数秒内变为 `SSE ○ 重连中`（红色）。
重新 `node src/server.js`，Expected: HUD 自动恢复，底栏回到 `SSE ●`，无需手动刷新。

- [ ] **Step 7: 最终全量测试**

Run: `node --test`
Expected: PASS —— 计划 1 的 18 个测试 + 本计划 server/format/render 全部测试通过。

- [ ] **Step 8: 收尾提交（仅当 Step 3-6 期间补录了 fixture 或修了 bug）**

```bash
git add -A
git commit -m "test: HUD 网页联调收尾"
```
若 Task 1-7 已逐任务提交且本任务无文件改动，跳过此步。

---

## 验证清单（对照 `docs/spec.md`）

- 第 4.5 节 HUD 网页（`index.html` + `hud.css` + `hud.js`）→ Task 1/5/6
- 第 4.3 节 `GET /` 静态托管 → Task 1
- 第 5.1 节会话记录字段全部渲染 → Task 3/4（`contextPct`/`filesChanged` 采集器未填充，照契约渲染，见计划开头「已知限制」）
- 第 6.1 节横幅 + 三列 + 底栏布局 → Task 1（骨架）/ 3 / 4
- 第 6.2 节科幻仪表盘视觉 → Task 5
- 第 6.3 节 `waiting` 整屏强提醒 → Task 6（类切换）/ 7（样式）
- 第 7 节容错：服务重启 → HUD SSE 自动重连 → Task 6 / Task 8 Step 6
- 第 8 节测试策略：纯函数 Node 单测 + 回放目测 → Task 2/3/4（单测）/ Task 8（目测）









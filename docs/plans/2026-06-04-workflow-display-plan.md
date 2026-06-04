# Workflow 显示（轻量版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HUD 以只读文件轮询采集 Claude Code workflow 进度，banner chip + 时间线进度行展示运行中 M/N 与完成态收尾。

**Architecture:** 新增第三条采集渠道——纯函数 `src/workflow.js`（解析 + 判定）+ server.js `pollWorkflows` 轮询器（克隆现有 `pollTranscripts`，只读 fs、try/catch 静默），写入 `session.workflow` 字段；HUD 侧 format/render/css 照 effort chip 先例渲染。改动全在 HUD 侧，不碰 hook/statusline，对 Claude Code 零风险。

**Tech Stack:** Node.js ESM、`node:fs/promises`、`node:test` + `node:assert/strict`，无第三方依赖。

设计文档：`docs/plans/2026-06-04-workflow-display.md`。数据源事实见该文档「数据源」段与 memory `workflow-file-layout`。

---

## File Structure

- `src/workflow.js`（**新建**）— 纯函数 `sessionDirFromTranscript`/`parseWorkflowName`/`parsePhaseTotal`/`deriveWorkflow` + 薄 IO `collectWorkflow` + 常量 `DONE_TTL`。一个文件一职责：workflow 采集。
- `src/state.js`（改）— `createSession()` 加 `workflow: null` 一字段。
- `src/server.js`（改）— `pollWorkflows` 轮询器 + start/stop 接线 + 常量 `WF_POLL_MS`。
- `public/format.js`（改）— 4 个 workflow 纯标量。
- `public/render.js`（改）— `workflowChip` + `workflowProgress` 两局部函数，接入 banner/timeline。
- `public/hud.css`（改）— `.wf-run`/`.wf-done`/`.wfp` 样式。
- `tests/workflow.test.js`（**新建**）、`tests/{state,format,render}.test.js`（各追加）。

---

## Task 1: state.js 新增 workflow 字段

**Files:** Modify `src/state.js`（`createSession`）；Test `tests/state.test.js`

- [ ] **Step 1: 写失败测试** — 追加到 `tests/state.test.js` 末尾：

```js
test('createSession 初始 workflow 为 null', () => {
  assert.equal(createSession('abc').workflow, null);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/state.test.js` — Expected: FAIL（`workflow` 为 undefined）

- [ ] **Step 3: 最小实现** — `src/state.js` 的 `createSession()` 返回对象里，`transcriptPath: null,` 那行后加一行：

```js
    workflow: null,
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/state.test.js` — Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: 会话状态新增 workflow 字段"
```

---

## Task 2: workflow.js 三个解析纯函数

**Files:** Create `src/workflow.js`；Create `tests/workflow.test.js`

- [ ] **Step 1: 写失败测试** — 新建 `tests/workflow.test.js`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionDirFromTranscript, parseWorkflowName, parsePhaseTotal,
} from '../src/workflow.js';

test('sessionDirFromTranscript 去 .jsonl 后缀', () => {
  assert.equal(sessionDirFromTranscript('/a/b/sid.jsonl'), '/a/b/sid');
  assert.equal(sessionDirFromTranscript('/a/b.txt'), null);
  assert.equal(sessionDirFromTranscript(null), null);
});

test('parseWorkflowName 从脚本文件名提取 name', () => {
  assert.equal(parseWorkflowName('hook-probe-wf_02c8b2a5-ddc.js', 'wf_02c8b2a5-ddc'), 'hook-probe');
  assert.equal(parseWorkflowName('other.js', 'wf_02c8b2a5-ddc'), null);
});

test('parsePhaseTotal 数 meta.phases 内 title 个数，失败 null', () => {
  assert.equal(parsePhaseTotal("meta = { phases: [{title:'A'},{title:'B'}] }"), 2);
  assert.equal(parsePhaseTotal("phases: [{ title: 'Probe' }]"), 1);
  assert.equal(parsePhaseTotal('no phases here'), null);
  assert.equal(parsePhaseTotal('phases: []'), null);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/workflow.test.js` — Expected: FAIL（找不到模块 `../src/workflow.js`）

- [ ] **Step 3: 最小实现** — 新建 `src/workflow.js`：

```js
// src/workflow.js — workflow 进度采集。纯函数 + 薄 IO，照 transcript.js 先例。
export const DONE_TTL = 60_000;

// transcriptPath ".../<sid>.jsonl" → session 目录 ".../<sid>"；非 jsonl 返回 null
export function sessionDirFromTranscript(transcriptPath) {
  const p = String(transcriptPath || '');
  return p.endsWith('.jsonl') ? p.slice(0, -6) : null;
}

// scripts 文件名 "<name>-<runId>.js" + runId → name；不匹配返回 null
export function parseWorkflowName(scriptFileName, runId) {
  const f = String(scriptFileName || '');
  const suffix = `-${runId}.js`;
  return f.endsWith(suffix) ? (f.slice(0, -suffix.length) || null) : null;
}

// 脚本源码 → meta.phases 内 title 计数；解析失败或空数组返回 null（降级）
export function parsePhaseTotal(scriptText) {
  const m = String(scriptText || '').match(/phases\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const count = (m[1].match(/title\s*:/g) || []).length;
  return count > 0 ? count : null;
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/workflow.test.js` — Expected: PASS（3 个测试通过）

- [ ] **Step 5: 提交**

```bash
git add src/workflow.js tests/workflow.test.js
git commit -m "feat: workflow 采集的路径/名称/phase 解析纯函数"
```

---

## Task 3: workflow.js deriveWorkflow 判定逻辑

**Files:** Modify `src/workflow.js`、`tests/workflow.test.js`

`deriveWorkflow(raw, now)` 输入 `{ runs: [...] }`，每个 run 含字段 `runId / wfJsonExists / wfJsonMtime / metaCount / jsonlCount / agentMtime / name / wfName / agentCount / phaseTotal`。

- [ ] **Step 1: 写失败测试** — 把 `tests/workflow.test.js` 顶部 import 改为（加 `deriveWorkflow, DONE_TTL`）：

```js
import {
  sessionDirFromTranscript, parseWorkflowName, parsePhaseTotal, deriveWorkflow, DONE_TTL,
} from '../src/workflow.js';
```

并追加以下测试：

```js
test('deriveWorkflow running：无 wf json，数 agent 文件得 M/N', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: false, metaCount: 8, jsonlCount: 3, agentMtime: 100, name: 'rev', phaseTotal: 4 },
  ] }, 1000);
  assert.deepEqual(wf, { name: 'rev', runId: 'wf_a', status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 });
});

test('deriveWorkflow done：wf json 新鲜，用 agentCount + workflowName', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: true, wfJsonMtime: 980, wfName: 'rev', agentCount: 8, phaseTotal: 4 },
  ] }, 1000);
  assert.equal(wf.status, 'done');
  assert.equal(wf.doneAgents, 8);
  assert.equal(wf.totalAgents, 8);
  assert.equal(wf.name, 'rev');
});

test('deriveWorkflow hidden：wf json mtime 已旧 → null', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: true, wfJsonMtime: 0, agentCount: 8 },
  ] }, DONE_TTL + 1);
  assert.equal(wf, null);
});

test('deriveWorkflow 无 run / 空 → null', () => {
  assert.equal(deriveWorkflow({ runs: [] }, 1), null);
  assert.equal(deriveWorkflow({}, 1), null);
});

test('deriveWorkflow 多候选：running 优先于 done', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_done', wfJsonExists: true, wfJsonMtime: 999, agentCount: 5, wfName: 'd' },
    { runId: 'wf_run', wfJsonExists: false, metaCount: 4, jsonlCount: 1, agentMtime: 500, name: 'r' },
  ] }, 1000);
  assert.equal(wf.runId, 'wf_run');
  assert.equal(wf.status, 'running');
});

test('deriveWorkflow 多 running 取 agentMtime 最新', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_old', wfJsonExists: false, metaCount: 2, jsonlCount: 1, agentMtime: 100, name: 'old' },
    { runId: 'wf_new', wfJsonExists: false, metaCount: 3, jsonlCount: 2, agentMtime: 900, name: 'new' },
  ] }, 1000);
  assert.equal(wf.runId, 'wf_new');
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/workflow.test.js` — Expected: FAIL（`deriveWorkflow` 未导出）

- [ ] **Step 3: 最小实现** — 在 `src/workflow.js` 末尾追加：

```js
// 原始目录数据 { runs } → session.workflow 或 null。
// running（无 wf json）优先于 done（wf json 新鲜）；同类取 mtime 最新；wf json 旧则忽略。
export function deriveWorkflow(raw, now = Date.now()) {
  const runs = Array.isArray(raw && raw.runs) ? raw.runs : [];
  const cands = [];
  for (const r of runs) {
    if (!r.wfJsonExists) {
      if (r.metaCount > 0) cands.push({ r, status: 'running', sortKey: r.agentMtime || 0 });
    } else if (now - (r.wfJsonMtime || 0) < DONE_TTL) {
      cands.push({ r, status: 'done', sortKey: r.wfJsonMtime || 0 });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) =>
    (a.status !== b.status) ? (a.status === 'running' ? -1 : 1) : b.sortKey - a.sortKey);
  const { r, status } = cands[0];
  if (status === 'running') {
    return { name: r.name || r.runId, runId: r.runId, status: 'running',
      doneAgents: r.jsonlCount, totalAgents: r.metaCount, phaseTotal: r.phaseTotal ?? null };
  }
  return { name: r.wfName || r.name || r.runId, runId: r.runId, status: 'done',
    doneAgents: r.agentCount, totalAgents: r.agentCount, phaseTotal: r.phaseTotal ?? null };
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/workflow.test.js` — Expected: PASS（全部 9 个测试）

- [ ] **Step 5: 提交**

```bash
git add src/workflow.js tests/workflow.test.js
git commit -m "feat: workflow 运行中/完成/隐藏判定逻辑"
```

---

## Task 4: workflow.js collectWorkflow 薄 IO 层

**Files:** Modify `src/workflow.js`、`tests/workflow.test.js`

- [ ] **Step 1: 写失败测试** — `tests/workflow.test.js`：workflow import 行再加 `collectWorkflow`，并在 import 区追加三行 Node 内置：

```js
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

追加两个集成测试：

```js
test('collectWorkflow 从真实目录采集 running 态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hud-wf-'));
  const sid = join(root, 'sid');
  const runId = 'wf_test123-abc';
  const runDir = join(sid, 'subagents', 'workflows', runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(join(sid, 'workflows', 'scripts'), { recursive: true });
  await writeFile(join(runDir, 'agent-a1.meta.json'), '{"agentType":"x"}');
  await writeFile(join(runDir, 'agent-a2.meta.json'), '{"agentType":"x"}');
  await writeFile(join(runDir, 'agent-a1.jsonl'), '{}');
  await writeFile(join(sid, 'workflows', 'scripts', `myflow-${runId}.js`),
    "export const meta = { name: 'myflow', phases: [{title:'A'},{title:'B'}] }");
  const wf = await collectWorkflow(sid, 2000);
  assert.equal(wf.status, 'running');
  assert.equal(wf.doneAgents, 1);
  assert.equal(wf.totalAgents, 2);
  assert.equal(wf.name, 'myflow');
  assert.equal(wf.phaseTotal, 2);
  await rm(root, { recursive: true, force: true });
});

test('collectWorkflow 无 workflow 目录 → null', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hud-wf-'));
  assert.equal(await collectWorkflow(join(root, 'empty'), 1000), null);
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/workflow.test.js` — Expected: FAIL（`collectWorkflow` 未导出）

- [ ] **Step 3: 最小实现** — `src/workflow.js` 顶部（`DONE_TTL` 之前）加 import：

```js
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
```

文件末尾追加：

```js
// 薄 IO：扫 session 目录 workflow 产物，组装 raw 交 deriveWorkflow。全程容错，最坏返回 null。
export async function collectWorkflow(sessionDir, now = Date.now()) {
  if (!sessionDir) return null;
  const subRoot = join(sessionDir, 'subagents', 'workflows');
  const wfRoot = join(sessionDir, 'workflows');
  const scriptsRoot = join(wfRoot, 'scripts');
  let runIds;
  try {
    const ents = await readdir(subRoot, { withFileTypes: true });
    runIds = ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return null; } // 从没跑过 workflow
  let scripts = [];
  try { scripts = await readdir(scriptsRoot); } catch { /* 无 scripts 不致命 */ }
  const runs = [];
  for (const runId of runIds) {
    const dir = join(subRoot, runId);
    let files;
    try { files = await readdir(dir); } catch { continue; }
    const metaCount = files.filter((f) => f.endsWith('.meta.json')).length;
    const jsonlCount = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).length;
    let agentMtime = 0;
    for (const f of files) {
      try { const st = await stat(join(dir, f)); if (st.mtimeMs > agentMtime) agentMtime = st.mtimeMs; } catch { /* 跳过 */ }
    }
    let wfJsonExists = false, wfJsonMtime = 0, wfName = null, agentCount = jsonlCount, phaseTotal = null;
    try {
      const wfPath = join(wfRoot, `${runId}.json`);
      wfJsonMtime = (await stat(wfPath)).mtimeMs;
      wfJsonExists = true;
      const j = JSON.parse(await readFile(wfPath, 'utf8'));
      wfName = j.workflowName || null;
      if (Number.isFinite(j.agentCount)) agentCount = j.agentCount;
      if (Array.isArray(j.phases) && j.phases.length) phaseTotal = j.phases.length;
    } catch { /* 无 wf json = 运行中 */ }
    const script = scripts.find((s) => s.endsWith(`-${runId}.js`));
    let name = null;
    if (script) {
      name = parseWorkflowName(script, runId);
      if (phaseTotal == null) {
        try { phaseTotal = parsePhaseTotal(await readFile(join(scriptsRoot, script), 'utf8')); } catch { /* 降级 */ }
      }
    }
    runs.push({ runId, wfJsonExists, wfJsonMtime, metaCount, jsonlCount, agentMtime, name, wfName, agentCount, phaseTotal });
  }
  return deriveWorkflow({ runs }, now);
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/workflow.test.js` — Expected: PASS（11 个测试）

- [ ] **Step 5: 提交**

```bash
git add src/workflow.js tests/workflow.test.js
git commit -m "feat: collectWorkflow 扫描 session 目录采集 workflow 进度"
```

---

## Task 5: server.js 接入 pollWorkflows 轮询器

**Files:** Modify `src/server.js`

照现有 `pollTranscripts` 先例接线。**注**：server.test.js 一律以 `poll:false` 关轮询只测端点 →
轮询器不做 server 集成测试；核心 `collectWorkflow` 已在 Task 4 覆盖，本任务验证 = 全量回归 + Task 9 目测。

- [ ] **Step 1: 实现** — 改 `src/server.js`：

(1) import 区（`./usage.js` 那行后）加：
```js
import { collectWorkflow, sessionDirFromTranscript } from './workflow.js';
```

(2) `const TRANSCRIPT_POLL_MS = 5_000;` 那行后加：
```js
const WF_POLL_MS = 8_000;
```

(3) `pollTranscripts` 函数定义之后，加 `pollWorkflows`：
```js
let wfTimer = null;
const pollWorkflows = async () => {
  let dirty = false;
  for (const sess of sessions.values()) {
    if (!sess.transcriptPath) continue;
    try {
      const wf = await collectWorkflow(sessionDirFromTranscript(sess.transcriptPath));
      if (JSON.stringify(wf) !== JSON.stringify(sess.workflow)) {
        sessions.set(sess.sessionId, { ...sess, workflow: wf });
        dirty = true;
      }
    } catch { /* 单会话失败不影响其他会话与 HUD */ }
  }
  if (dirty) broadcast();
};
```

(4) `start()` 的 `if (poll) {` 块内、`ctxTimer = setInterval(...)` 之后加：
```js
      pollWorkflows();
      wfTimer = setInterval(pollWorkflows, WF_POLL_MS);
      wfTimer.unref();
```

(5) `stop()` 内 `if (ctxTimer) clearInterval(ctxTimer);` 后加：
```js
    if (wfTimer) clearInterval(wfTimer);
```

- [ ] **Step 2: 跑全量测试确认无回归** — Run: `npm test` — Expected: 全绿（现有测试不受影响）

- [ ] **Step 3: 提交**
```bash
git add src/server.js
git commit -m "feat: server 接入 pollWorkflows 只读轮询器"
```

---

## Task 6: format.js workflow 标量

**Files:** Modify `public/format.js`、`tests/format.test.js`

- [ ] **Step 1: 写失败测试** — `tests/format.test.js`：把 import 改为加 4 个函数 `..., effortLabel, effortClass, workflowChipText, workflowClass, workflowPct, workflowPhaseText`，追加测试：
```js
test('workflow 标量：running/done/null 与边界', () => {
  const run = { status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 };
  const done = { status: 'done', doneAgents: 8, totalAgents: 8, phaseTotal: null };
  assert.equal(workflowChipText(run), '⚙ WF 3/8');
  assert.equal(workflowChipText(done), '⚙ WF ✓ 8/8');
  assert.equal(workflowChipText(null), '');
  assert.equal(workflowClass(run), 'wf-run');
  assert.equal(workflowClass(done), 'wf-done');
  assert.equal(workflowClass(null), '');
  assert.equal(workflowPct(run), 38);
  assert.equal(workflowPct(done), 100);
  assert.equal(workflowPct({ status: 'running', doneAgents: 0, totalAgents: 0 }), 0);
  assert.equal(workflowPhaseText(run), 'phase ·/4');
  assert.equal(workflowPhaseText(done), '');
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/format.test.js` — Expected: FAIL（未导出）

- [ ] **Step 3: 最小实现** — `public/format.js` 末尾追加：
```js
export function workflowChipText(wf) {
  if (!wf) return '';
  const mn = `${wf.doneAgents}/${wf.totalAgents}`;
  return wf.status === 'done' ? `⚙ WF ✓ ${mn}` : `⚙ WF ${mn}`;
}
export function workflowClass(wf) {
  if (!wf) return '';
  return wf.status === 'done' ? 'wf-done' : 'wf-run';
}
export function workflowPct(wf) {
  if (!wf) return 0;
  if (wf.status === 'done') return 100;
  const n = Number(wf.totalAgents) || 0;
  return n > 0 ? Math.round((Number(wf.doneAgents) || 0) / n * 100) : 0;
}
export function workflowPhaseText(wf) {
  return (wf && wf.phaseTotal != null) ? `phase ·/${wf.phaseTotal}` : '';
}
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/format.test.js` — Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add public/format.js tests/format.test.js
git commit -m "feat: workflow chip/进度条标量格式化"
```

---

## Task 7: render.js banner chip + 时间线进度块

**Files:** Modify `public/render.js`、`tests/render.test.js`

- [ ] **Step 1: 写失败测试** — `tests/render.test.js` 追加（照现有 effort chip 测试风格）：
```js
test('renderBanner 含 workflow chip（running）', () => {
  const html = renderBanner({ sessions: [] },
    { workflow: { name: 'rev', status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 } });
  assert.match(html, /class="chip wf-run"/);
  assert.match(html, /⚙ WF 3\/8/);
});

test('renderBanner 无 workflow 不渲染 chip', () => {
  assert.doesNotMatch(renderBanner({ sessions: [] }, { workflow: null }), /⚙ WF/);
});

test('renderTimeline 顶部渲染 workflow 进度块', () => {
  const html = renderTimeline({ timeline: [],
    workflow: { name: 'rev', status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 } });
  assert.match(html, /class="wfp wf-run"/);
  assert.match(html, /⚙ rev/);
  assert.match(html, /3 \/ 8/);
  assert.match(html, /phase ·\/4/);
});

test('renderTimeline 无 workflow 不渲染进度块', () => {
  assert.doesNotMatch(renderTimeline({ timeline: [], workflow: null }), /wfp/);
});

test('renderTimeline workflow 名转义注入', () => {
  const html = renderTimeline({ timeline: [],
    workflow: { name: '<img>', status: 'running', doneAgents: 1, totalAgents: 2, phaseTotal: null } });
  assert.doesNotMatch(html, /<img>/);
  assert.match(html, /&lt;img&gt;/);
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `node --test tests/render.test.js` — Expected: FAIL（chip/wfp 未渲染）

- [ ] **Step 3: 最小实现** — 改 `public/render.js`：

(1) 顶部 import 从 `./format.js` 末尾加 4 个：`workflowChipText, workflowClass, workflowPct, workflowPhaseText`。

(2) `effortChip` 函数之后，加两个局部函数：
```js
function workflowChip(wf) {
  const text = workflowChipText(wf);
  return text ? `<span class="chip ${workflowClass(wf)}">${esc(text)}</span>` : '';
}

function workflowProgress(wf) {
  if (!wf) return '';
  const phase = workflowPhaseText(wf);
  return `<div class="wfp ${workflowClass(wf)}">`
    + `<div class="wfp-h"><span class="nm">⚙ ${esc(wf.name)}</span><span class="n">${esc(String(wf.doneAgents))} / ${esc(String(wf.totalAgents))}</span></div>`
    + `<div class="wfp-b"><div class="bar"><i style="width:${barWidth(workflowPct(wf))}"><span class="sh"></span></i></div>`
    + (phase ? `<span class="ph mono">${esc(phase)}</span>` : '')
    + `</div></div>`;
}
```

(3) `renderBanner` 的 chips 数组里，`effortChip(s.effort),` 那行后插入：
```js
    workflowChip(s.workflow),
```

(4) `renderTimeline` 的 `return rows.join('');` 改为：
```js
  return workflowProgress(s.workflow) + rows.join('');
```

- [ ] **Step 4: 跑测试确认通过** — Run: `node --test tests/render.test.js` — Expected: PASS

- [ ] **Step 5: 提交**
```bash
git add public/render.js tests/render.test.js
git commit -m "feat: banner workflow chip 与时间线进度块渲染"
```

---

## Task 8: hud.css workflow 样式

**Files:** Modify `public/hud.css`

CSS 无自动化测试（纯样式），验证靠 Task 9 目测。配色取自现有调色板（#27d3f5 青 / #3ff58f 绿 / #7f97b5 灰蓝 / #173052 边框），照 effort chip 先例。

- [ ] **Step 1: 实现** — 在 `@keyframes effortPulse{...}` 那行之后追加：

```css
  /* workflow：chip 配色（照 effort）+ 时间线顶部进度块。复用 .chip/.bar/.sh */
  .chip.wf-run{border-color:#27d3f5;color:#8fe9fb;background:#06202f}
  .chip.wf-done{border-color:#3ff58f;color:#9fffce;background:#05231a}
  .wfp{margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #173052}
  .wfp-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
  .wfp-h .nm{font-size:20px;color:#8fe9fb}
  .wfp-h .n{font-size:19px;color:#7f97b5}
  .wfp.wf-done .nm{color:#9fffce}
  .wfp-b{display:flex;align-items:center;gap:10px}
  .wfp-b .bar{flex:1}
  .wfp-b .ph{font-size:17px;color:#7f97b5;white-space:nowrap}
  .wfp.wf-run .bar i{background:linear-gradient(90deg,#27d3f5,#3ff58f)}
  .wfp.wf-done .bar i{background:linear-gradient(90deg,#3ff58f,#9fffce)}
```

- [ ] **Step 2: 提交**（目测留到 Task 9）
```bash
git add public/hud.css
git commit -m "style: workflow chip 配色与时间线进度块样式"
```

---

## Task 9: 收尾——数据契约文档 + 全量回归 + 目测验证

**Files:** Modify `CLAUDE.md`

- [ ] **Step 1: 更新数据契约** — `CLAUDE.md` 数据契约段，`effort` 那条之后加：

```markdown
- `workflow` 来自只读文件轮询（`src/workflow.js` + server `pollWorkflows`）：运行期为
  `{name,runId,status:'running',doneAgents(M),totalAgents(N),phaseTotal}`；完成态 60s 内
  `status:'done'`；其余为 `null`。运行期只有 M/N 计数，当前 phase 不可得（见
  `docs/plans/2026-06-04-workflow-display.md`）。
```

- [ ] **Step 2: 全量回归** — Run: `npm test` — Expected: 全绿（含新增 workflow/format/render/state 测试）

- [ ] **Step 3: 目测 running 态** — 找当前会话目录（`~/.claude/projects/<slug>/<sid>/`，slug 见 CLAUDE.md 顶部路径），造临时 running 目录：

```powershell
$d = "$env:USERPROFILE\.claude\projects\<slug>\<sid>\subagents\workflows\wf_demo-test"
New-Item -ItemType Directory -Force $d
'{"agentType":"x"}' | Out-File -Encoding utf8 "$d\agent-a1.meta.json"
'{"agentType":"x"}' | Out-File -Encoding utf8 "$d\agent-a2.meta.json"
'{}' | Out-File -Encoding utf8 "$d\agent-a1.jsonl"
```

按 memory `hud-update-restart` 重启：杀 :4317 旧 server、重启 `start-hud.ps1`、强刷浏览器。
确认 banner 出现 `⚙ WF 1/2` chip + 时间线顶部进度块（青色）。看完删除：`Remove-Item -Recurse -Force $d`。

- [ ] **Step 4: 提交**
```bash
git add CLAUDE.md
git commit -m "docs: 数据契约补充 workflow 字段说明"
```

---

## 实施顺序与依赖

Task 1（字段）→ 2/3/4（workflow.js 纯函数+IO，渐进）→ 5（server 接线，依赖 1+4）→
6（format）→ 7（render，依赖 6）→ 8（css，依赖 7 的类名）→ 9（收尾，依赖全部）。
每个 Task 原子提交；全程只新增/修改 HUD 侧代码，hook/statusline 通道零改动。

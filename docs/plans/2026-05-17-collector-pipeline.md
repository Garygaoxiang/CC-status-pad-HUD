# 采集器 + 数据管道 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个 headless 的本地采集器，接收 Claude Code 的 hook 事件与 statusline 数据，在内存里维护 1-3 个会话的状态，并通过 SSE 实时推送。

**Architecture:** Node.js 单进程 HTTP 服务。hook/statusline 用 `curl` POST 上报；纯函数 reducer 把事件序列归约成会话状态；通过 SSE（Server-Sent Events）推送给订阅者。SSE 取代 spec 里写的 "WebSocket" —— 单向推送场景下 SSE 零依赖、`EventSource` 原生自动重连，更契合 spec 的实际需求（零依赖 + 断线重连）。

**Tech Stack:** Node.js（仅内置模块 `http`/`https`/`fs`）、`node:test` + `node:assert` 测试、ESM、SSE。无 npm 依赖。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json` | 项目元数据、`test`/`start` 脚本 |
| `src/state.js` | 纯函数状态 reducer（会话记录、状态派生、时间线、任务重建、statusline 归并） |
| `src/usage.js` | 读 OAuth token、调 `/api/oauth/usage`、解析用量 |
| `src/server.js` | HTTP 服务：摄取端点、`/state`、SSE `/events`、静态托管 |
| `bin/hud-hook.cmd` | hook 转发器（curl POST，1s 超时，强制 exit 0） |
| `bin/hud-statusline.cmd` | statusline 包装器（转发 + 透传 claude-hud 输出） |
| `tools/replay.js` | 开发用：回放 fixture 事件序列到采集器 |
| `tools/fixtures/*.json` | 真实 hook/statusline JSON 样本 |
| `tests/state.test.js` | state reducer 单元测试 |
| `tests/usage.test.js` | usage 解析单元测试 |
| `tests/server.test.js` | HTTP 服务集成测试 |

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "turzx-coding-hud",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test",
    "start": "node src/server.js"
  }
}
```

- [ ] **Step 2: 写一个冒烟测试确认测试链路通**

`tests/smoke.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('测试运行器可用', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npm test`
Expected: PASS，输出含 `tests 1` `pass 1`。

- [ ] **Step 4: 提交**

```bash
git add package.json tests/smoke.test.js
git commit -m "chore: 项目脚手架与测试链路"
```

## Task 2: 采集真实 hook / statusline 样本

不写代码先拿真实数据 —— 后续所有 reducer 都按真实 JSON 字段编写，消除字段名臆测。

**Files:**
- Create: `tools/fixtures/` 目录下的样本文件
- 临时修改: `~/.claude/settings.json`（采集后还原）

- [ ] **Step 1: 临时加一个记录 hook**

在 `~/.claude/settings.json` 的 `hooks` 里，为 `PreToolUse`/`PostToolUse`/`UserPromptSubmit`/`Notification`/`Stop`/`SessionEnd` 各加一条命令（Windows）：
`cmd /c "type > %TEMP%\hud-cap-%RANDOM%.json"`
即把每个 hook 的 stdin JSON 落盘。

- [ ] **Step 2: 跑一个真实 Claude Code 会话**

在任意项目里跑一个会触发多种工具（Bash/Edit/Read/TaskCreate）的小任务，并触发一次授权提示。

- [ ] **Step 3: 收集样本到 fixtures**

把 `%TEMP%` 下抓到的 JSON 整理进 `tools/fixtures/`：
`pretooluse-bash.json`、`posttooluse-edit.json`、`userpromptsubmit.json`、
`notification.json`、`stop.json`、`taskcreate.json`、`taskupdate.json`、
`statusline.json`（statusline 的样本：临时把 statusLine.command 换成上面的落盘命令抓一次）。

- [ ] **Step 4: 还原 settings.json**

删掉临时 hook，恢复原 `statusLine.command`。

- [ ] **Step 5: 校验关键字段并记录**

确认每个样本里这些字段确实存在并记到本任务备注：
`hook_event_name` `session_id` `cwd` `tool_name` `tool_input` `tool_response`；
statusline 样本里的 `model.display_name` `workspace.current_dir`
`cost.total_cost_usd` `cost.total_lines_added` `cost.total_lines_removed`，
以及是否存在可用的上下文窗口字段（若无，contextPct 在计划 2/后续由 transcript 解析补充）。

- [ ] **Step 6: 提交**

```bash
git add tools/fixtures
git commit -m "test: 采集真实 hook/statusline JSON 样本"
```

## Task 3: 状态 reducer 核心（事件归约）

`src/state.js` 是纯函数模块：`applyEvent` 把单个 hook 事件归约进会话记录，
所有函数返回新对象、不改入参。

**Files:**
- Create: `src/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: 写失败测试**

`tests/state.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyEvent, formatTool } from '../src/state.js';

test('createSession 给出空闲初始记录', () => {
  const s = createSession('abc');
  assert.equal(s.sessionId, 'abc');
  assert.equal(s.status, 'idle');
  assert.deepEqual(s.timeline, []);
});

test('PreToolUse → running，并带工具标签', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'npm test' } }, 1000);
  assert.equal(s.status, 'running');
  assert.equal(s.currentTool, 'Bash · npm test');
  assert.equal(s.lastSeen, 1000);
});

test('PostToolUse → working，时间线追加 + 计数', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'C:/p/src/app.ts' } }, 2000);
  assert.equal(s.status, 'working');
  assert.equal(s.timeline.length, 1);
  assert.equal(s.timeline[0].label, 'Edit · app.ts');
  assert.equal(s.toolCounts.Edit, 1);
});

test('Notification → waiting；Stop → idle；SessionEnd → ended', () => {
  let s = createSession('abc');
  assert.equal(applyEvent(s, { hook_event_name: 'Notification' }, 1).status, 'waiting');
  assert.equal(applyEvent(s, { hook_event_name: 'Stop' }, 1).status, 'idle');
  assert.equal(applyEvent(s, { hook_event_name: 'SessionEnd' }, 1).status, 'ended');
});

test('时间线为环形缓冲，上限 MAX_TIMELINE', () => {
  let s = createSession('abc');
  for (let i = 0; i < 30; i++)
    s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Read',
      tool_input: { file_path: `f${i}.ts` } }, i);
  assert.equal(s.timeline.length, 20);
  assert.equal(s.timeline.at(-1).label, 'Read · f29.ts');
});

test('TaskCreate / TaskUpdate 重建任务列表', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate',
    tool_input: { subject: '建采集器' },
    tool_response: 'Task #1 created successfully: 建采集器' }, 1);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].status, 'pending');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate',
    tool_input: { taskId: '1', status: 'completed' } }, 2);
  assert.equal(s.tasks[0].status, 'completed');
});

test('applyEvent 不修改入参', () => {
  const s0 = createSession('abc');
  applyEvent(s0, { hook_event_name: 'Stop' }, 1);
  assert.equal(s0.status, 'idle');
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/state.js'`。

- [ ] **Step 3: 实现 src/state.js**

```js
// 纯函数状态 reducer。所有导出函数返回新对象，不改入参。
export const MAX_TIMELINE = 20;
export const STALE_MS = 10 * 60 * 1000;

const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const truncate = (str, n) => {
  str = String(str ?? '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
};

export function createSession(sessionId) {
  return {
    sessionId, status: 'idle', currentTool: null,
    model: null, plan: null, cwd: null, projectName: null, branch: null,
    timeline: [], tasks: [], toolCounts: {},
    contextPct: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0,
    costUsd: 0, durationMs: 0, lastSeen: 0,
  };
}

export function formatTool(name = 'Tool', input = {}) {
  switch (name) {
    case 'Bash': return `Bash · ${truncate(input.command, 48)}`;
    case 'Edit': case 'Write': case 'Read': case 'NotebookEdit':
      return `${name} · ${basename(input.file_path || input.notebook_path)}`;
    case 'Grep': return `Grep · ${truncate(input.pattern, 32)}`;
    case 'Glob': return `Glob · ${truncate(input.pattern, 32)}`;
    case 'Task': return `Task · ${truncate(input.description, 36)}`;
    default: return name;
  }
}

function applyTaskTool(s, name, input = {}, response = '') {
  if (name === 'TaskCreate') {
    const m = String(response || '').match(/#(\d+)/);
    const id = m ? m[1] : String(s.tasks.length + 1);
    s.tasks.push({ id, subject: input.subject || '(task)', status: 'pending' });
  } else if (name === 'TaskUpdate') {
    const t = s.tasks.find((x) => x.id === String(input.taskId ?? ''));
    if (t && input.status) t.status = input.status;
    if (t && input.subject) t.subject = input.subject;
  }
}

export function applyEvent(session, event, now = Date.now()) {
  const s = {
    ...session,
    timeline: [...session.timeline],
    toolCounts: { ...session.toolCounts },
    tasks: session.tasks.map((t) => ({ ...t })),
    lastSeen: now,
  };
  if (event.cwd) { s.cwd = event.cwd; s.projectName = basename(event.cwd); }
  switch (event.hook_event_name) {
    case 'UserPromptSubmit': s.status = 'working'; s.currentTool = null; break;
    case 'PreToolUse':
      s.status = 'running';
      s.currentTool = formatTool(event.tool_name, event.tool_input);
      break;
    case 'PostToolUse': {
      s.status = 'working'; s.currentTool = null;
      const name = event.tool_name || 'Tool';
      s.toolCounts[name] = (s.toolCounts[name] || 0) + 1;
      s.timeline.push({ ts: now, tool: name, label: formatTool(name, event.tool_input) });
      if (s.timeline.length > MAX_TIMELINE) s.timeline = s.timeline.slice(-MAX_TIMELINE);
      if (name === 'TaskCreate' || name === 'TaskUpdate')
        applyTaskTool(s, name, event.tool_input, event.tool_response);
      break;
    }
    case 'Notification': s.status = 'waiting'; break;
    case 'Stop': s.status = 'idle'; s.currentTool = null; break;
    case 'SessionEnd': s.status = 'ended'; break;
  }
  return s;
}
```

- [ ] **Step 4: 运行，确认全部通过**

Run: `npm test`
Expected: PASS，state.test.js 全部用例通过。

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: 状态 reducer 核心 — 事件归约与时间线"
```

## Task 4: statusline 归并 + 聚焦/过期

往 `src/state.js` 增加 statusline 数据归并、聚焦会话选取、过期清理。

**Files:**
- Modify: `src/state.js`（追加导出函数）
- Test: `tests/state.test.js`（追加用例）

- [ ] **Step 1: 追加失败测试**

`tests/state.test.js` 末尾追加：

```js
import { applyStatusline, pickFocus, pruneStale, STALE_MS } from '../src/state.js';

test('applyStatusline 归并模型与花费', () => {
  let s = createSession('abc');
  s = applyStatusline(s, {
    model: { display_name: 'Opus 4.7' },
    workspace: { current_dir: 'C:/proj/api' },
    cost: { total_cost_usd: 0.84, total_lines_added: 128, total_lines_removed: 34 },
  }, 5000);
  assert.equal(s.model, 'Opus 4.7');
  assert.equal(s.projectName, 'api');
  assert.equal(s.costUsd, 0.84);
  assert.equal(s.linesAdded, 128);
});

test('pickFocus 取 lastSeen 最新的会话', () => {
  const m = new Map([
    ['a', { ...createSession('a'), lastSeen: 100 }],
    ['b', { ...createSession('b'), lastSeen: 300 }],
  ]);
  assert.equal(pickFocus(m).sessionId, 'b');
});

test('pruneStale 移除过期与已结束会话', () => {
  const now = 1_000_000;
  const m = new Map([
    ['fresh', { ...createSession('fresh'), lastSeen: now }],
    ['stale', { ...createSession('stale'), lastSeen: now - STALE_MS - 1 }],
    ['ended', { ...createSession('ended'), status: 'ended', lastSeen: now }],
  ]);
  pruneStale(m, now);
  assert.deepEqual([...m.keys()], ['fresh']);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`applyStatusline` 等未导出。

- [ ] **Step 3: 在 src/state.js 末尾追加实现**

```js
export function applyStatusline(session, sl, now = Date.now()) {
  const s = { ...session, lastSeen: now };
  if (sl.model?.display_name) s.model = sl.model.display_name;
  if (sl.workspace?.current_dir) {
    s.cwd = sl.workspace.current_dir;
    s.projectName = basename(s.cwd);
  }
  const c = sl.cost || {};
  if (c.total_cost_usd != null) s.costUsd = c.total_cost_usd;
  if (c.total_duration_ms != null) s.durationMs = c.total_duration_ms;
  if (c.total_lines_added != null) s.linesAdded = c.total_lines_added;
  if (c.total_lines_removed != null) s.linesRemoved = c.total_lines_removed;
  return s;
}

export function pruneStale(sessions, now = Date.now()) {
  for (const [id, s] of sessions)
    if (s.status === 'ended' || now - s.lastSeen > STALE_MS) sessions.delete(id);
}

export function pickFocus(sessions) {
  let focus = null;
  for (const s of sessions.values())
    if (!focus || s.lastSeen > focus.lastSeen) focus = s;
  return focus;
}
```

- [ ] **Step 4: 运行，确认全部通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/state.js tests/state.test.js
git commit -m "feat: statusline 归并与聚焦/过期"
```

## Task 5: Usage 模块

`src/usage.js`：读 OAuth token、调 `/api/oauth/usage`、解析用量。
契约取自 claude-hud 的 `usage-api.js`（已查证）。

**Files:**
- Create: `src/usage.js`
- Test: `tests/usage.test.js`

- [ ] **Step 1: 写失败测试（只测纯函数 parseUsage）**

`tests/usage.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage } from '../src/usage.js';

test('parseUsage 取整并夹紧 0-100', () => {
  const u = parseUsage({
    five_hour: { utilization: 19.4, resets_at: '2026-05-17T20:00:00Z' },
    seven_day: { utilization: 11.6, resets_at: '2026-05-23T00:00:00Z' },
  });
  assert.equal(u.fiveHour, 19);
  assert.equal(u.sevenDay, 12);
  assert.equal(u.fiveHourResetAt, '2026-05-17T20:00:00Z');
});

test('parseUsage 容忍缺字段', () => {
  const u = parseUsage({});
  assert.equal(u.fiveHour, null);
  assert.equal(u.sevenDay, null);
});

test('parseUsage 夹紧越界值', () => {
  const u = parseUsage({ five_hour: { utilization: 250 }, seven_day: { utilization: -5 } });
  assert.equal(u.fiveHour, 100);
  assert.equal(u.sevenDay, 0);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/usage.js'`。

- [ ] **Step 3: 实现 src/usage.js**

```js
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';

const USAGE_HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';

export function readToken(home = homedir()) {
  try {
    const raw = readFileSync(join(home, '.claude', '.credentials.json'), 'utf8');
    const oauth = JSON.parse(raw).claudeAiOauth || {};
    if (!oauth.accessToken) return null;
    if (oauth.expiresAt != null && oauth.expiresAt <= Date.now()) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

export function parseUsage(apiJson) {
  const pct = (v) =>
    Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : null;
  const j = apiJson || {};
  return {
    fiveHour: pct(j.five_hour?.utilization),
    sevenDay: pct(j.seven_day?.utilization),
    fiveHourResetAt: j.five_hour?.resets_at || null,
    sevenDayResetAt: j.seven_day?.resets_at || null,
  };
}

export function fetchUsage(token) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: USAGE_HOST, path: USAGE_PATH, method: 'GET', timeout: 15000,
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(parseUsage(JSON.parse(body))); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 手动验证真实接口（可选但推荐）**

`node -e "import('./src/usage.js').then(async m=>console.log(await m.fetchUsage(m.readToken())))"`
Expected: 打印 `{ fiveHour, sevenDay, ... }`（需 Claude Code 已登录）。

- [ ] **Step 6: 提交**

```bash
git add src/usage.js tests/usage.test.js
git commit -m "feat: usage 模块 — OAuth 用量获取与解析"
```

## Task 6: HTTP 采集器服务

`src/server.js` 用工厂函数 `createCollector()` 构造一份全新的服务实例
（便于测试隔离）。端点：`POST /hook`、`POST /statusline`、`GET /state`、
`GET /events`（SSE）。每次状态变化向所有 SSE 客户端广播快照。

**Files:**
- Create: `src/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: 写失败的集成测试**

`tests/server.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from '../src/server.js';

async function listen(c) {
  c.start(0, { poll: false });               // 端口 0 = 随机；poll 关闭避免测试联网
  await new Promise((r) => c.server.once('listening', r));
  return c.server.address().port;
}

test('POST /hook 归约状态，GET /state 可读', async () => {
  const c = createCollector();
  const port = await listen(c);
  await fetch(`http://localhost:${port}/hook`, {
    method: 'POST',
    body: JSON.stringify({ session_id: 's1', hook_event_name: 'PreToolUse',
      tool_name: 'Bash', tool_input: { command: 'ls' } }),
  });
  const state = await (await fetch(`http://localhost:${port}/state`)).json();
  assert.equal(state.focusId, 's1');
  assert.equal(state.sessions[0].currentTool, 'Bash · ls');
  c.stop();
});

test('坏 JSON 不致服务出错，仍返回 204', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/hook`,
    { method: 'POST', body: '不是json' });
  assert.equal(res.status, 204);
  c.stop();
});

test('GET /events 立即推送一份 SSE 快照', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/events`);
  const { value } = await res.body.getReader().read();
  assert.match(new TextDecoder().decode(value), /^data: /);
  c.stop();
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/server.js'`。

- [ ] **Step 3: 实现 src/server.js**

```js
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  applyEvent, applyStatusline, createSession, pickFocus, pruneStale,
} from './state.js';
import { readToken, fetchUsage } from './usage.js';

const DEFAULT_PORT = Number(process.env.HUD_PORT) || 4317;

export function createCollector() {
  const sessions = new Map();
  const clients = new Set();
  let usage = null;
  let timer = null;

  const getSession = (id) => {
    if (!sessions.has(id)) sessions.set(id, createSession(id));
    return sessions.get(id);
  };
  const snapshot = () => {
    pruneStale(sessions);
    const focus = pickFocus(sessions);
    return {
      focusId: focus?.sessionId || null,
      sessions: [...sessions.values()],
      usage, ts: Date.now(),
    };
  };
  const broadcast = () => {
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/hook') {
      try {
        const ev = JSON.parse(await readBody(req));
        const id = ev.session_id || 'default';
        sessions.set(id, applyEvent(getSession(id), ev));
        broadcast();
      } catch { /* 坏 JSON 静默忽略 */ }
      return res.writeHead(204).end();
    }
    if (req.method === 'POST' && url.pathname === '/statusline') {
      try {
        const sl = JSON.parse(await readBody(req));
        const id = sl.session_id || 'default';
        sessions.set(id, applyStatusline(getSession(id), sl));
        broadcast();
      } catch { /* 同上 */ }
      return res.writeHead(204).end();
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404).end();
  });

  const pollUsage = async () => {
    const token = readToken();
    if (!token) return;
    const u = await fetchUsage(token);
    if (u) { usage = u; broadcast(); }
  };

  function start(port = DEFAULT_PORT, { poll = true } = {}) {
    server.listen(port);
    if (poll) {
      pollUsage();
      timer = setInterval(pollUsage, 5 * 60 * 1000);
      timer.unref();
    }
    return server;
  }
  function stop() {
    if (timer) clearInterval(timer);
    for (const res of clients) res.end();
    clients.clear();
    server.close();
  }
  return { server, start, stop, snapshot };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  createCollector().start();
  console.log(`HUD 采集器已启动 :${DEFAULT_PORT}`);
}
```

- [ ] **Step 4: 运行，确认全部通过**

Run: `npm test`
Expected: PASS，server.test.js 三个用例通过。

- [ ] **Step 5: 手动验证常驻启动**

`npm start` → 另开终端 `curl http://localhost:4317/state`
Expected: 返回 `{"focusId":null,"sessions":[],...}` 的 JSON。Ctrl+C 关闭。

- [ ] **Step 6: 提交**

```bash
git add src/server.js tests/server.test.js
git commit -m "feat: HTTP 采集器服务 — 摄取端点与 SSE 推送"
```

## Task 7: Hook 转发器与 Statusline 包装器

`.cmd` 脚本无法做单元测试，靠手动验证。核心验证点：**采集器没起时
hud-hook.cmd 必须 exit 0**。

**Files:**
- Create: `bin/hud-hook.cmd`
- Create: `bin/hud-statusline.cmd`
- Create: `bin/hud-statusline.js`
- Create: `bin/original-statusline.txt`

- [ ] **Step 1: 写 bin/hud-hook.cmd**

```bat
@echo off
rem HUD hook 转发器 — 把 stdin 的 hook JSON POST 给采集器。
rem 1 秒超时；无论 curl 成败都强制 exit 0，绝不影响 Claude Code。
curl -s -m 1 -X POST http://localhost:4317/hook --data-binary @- >nul 2>&1
exit /b 0
```

- [ ] **Step 2: 验证 hud-hook.cmd（采集器在跑）**

先 `npm start`，另开终端：
`echo {"session_id":"t1","hook_event_name":"Stop"} | bin\hud-hook.cmd`
再 `curl http://localhost:4317/state`
Expected: `/state` 里出现 `t1` 会话、`status` 为 `idle`。

- [ ] **Step 3: 验证 hud-hook.cmd（采集器没起 → 必须 exit 0）**

停掉 `npm start`，运行：
`echo {"x":1} | bin\hud-hook.cmd` 然后 `echo EXIT=%errorlevel%`
Expected: `EXIT=0`，且命令在 1 秒内返回。

- [ ] **Step 4: 抓取原始 statusline 命令到 bin/original-statusline.txt**

读取用户当前 `settings.json` 的 statusLine 命令（claude-hud 的）并落盘：

```bat
node -e "const fs=require('fs');const p=process.env.USERPROFILE+'/.claude/settings.json';const c=JSON.parse(fs.readFileSync(p,'utf8')).statusLine?.command||'';fs.writeFileSync('bin/original-statusline.txt',c)"
```

确认 `bin/original-statusline.txt` 内容是 claude-hud 的 statusline 命令（单行）。
若为空，说明未配 statusline，本文件留空即可。

- [ ] **Step 5: 写 statusline 包装器**

`bin/hud-statusline.cmd`（薄壳，转交 Node）：

```bat
@echo off
node "%~dp0hud-statusline.js"
```

`bin/hud-statusline.js`：

```js
// HUD statusline 包装器：转发 JSON 给采集器，再调用原始 claude-hud
// statusline 命令、透传其输出。stdin 只能读一次，故先整段读入再分发。
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = readFileSync(0, 'utf8');          // fd 0 = stdin

// 1) 转发给采集器（失败静默，不阻断状态栏）
const req = http.request(
  { host: 'localhost', port: 4317, path: '/statusline', method: 'POST', timeout: 800 },
  (res) => res.resume(),
);
req.on('error', () => {});
req.on('timeout', () => req.destroy());
req.end(input);

// 2) 调用原始 claude-hud statusline，喂同样的 JSON，透传 stdout
try {
  const orig = readFileSync(join(here, 'original-statusline.txt'), 'utf8').trim();
  if (orig) {
    const r = spawnSync(orig, { shell: true, input, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
  }
} catch { /* 无原始命令则输出空状态栏 */ }
```

- [ ] **Step 6: 验证 statusline 包装器**

采集器在跑的前提下，用 Task 2 抓的 statusline 样本喂入：
`type tools\fixtures\statusline.json | bin\hud-statusline.cmd`
Expected:（a）stdout 打印出 claude-hud 的状态栏文本（与你平时一致）；
（b）`curl http://localhost:4317/state` 里该会话有了 `model`/`costUsd` 等字段。

- [ ] **Step 7: 提交**

```bash
git add bin/
git commit -m "feat: hook 转发器与 statusline 包装器"
```

## Task 8: 回放工具与端到端冒烟

`tools/replay.js` 把 fixture 事件按一次真实交互流的顺序回放到采集器，
无需开真会话即可开发联调（计划 2 的 HUD 网页也靠它驱动）。

**Files:**
- Create: `tools/replay.js`
- Test: `tests/e2e.test.js`

- [ ] **Step 1: 写端到端失败测试**

`tests/e2e.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from '../src/server.js';

test('E2E：一串事件后快照正确，SSE 收到推送', async () => {
  const c = createCollector();
  c.start(0, { poll: false });
  await new Promise((r) => c.server.once('listening', r));
  const base = `http://localhost:${c.server.address().port}`;

  const res = await fetch(`${base}/events`);
  const reader = res.body.getReader();
  await reader.read();                          // 消费初始快照

  const post = (b) =>
    fetch(`${base}/hook`, { method: 'POST', body: JSON.stringify(b) });
  await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
  await post({ session_id: 's', hook_event_name: 'PreToolUse',
    tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await post({ session_id: 's', hook_event_name: 'PostToolUse',
    tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await post({ session_id: 's', hook_event_name: 'Notification' });

  const state = await (await fetch(`${base}/state`)).json();
  assert.equal(state.focusId, 's');
  assert.equal(state.sessions[0].status, 'waiting');
  assert.equal(state.sessions[0].toolCounts.Bash, 1);
  assert.equal(state.sessions[0].timeline.length, 1);

  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /"status":"/);
  await reader.cancel();
  c.stop();
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: e2e 用例 FAIL（在 reducer/server 行为正确前）—— 若已实现可能直接 PASS，
此时确认它确实驱动了 SSE 推送即可。

- [ ] **Step 3: 实现 tools/replay.js**

```js
// 开发用：把 fixtures 里的事件按一次真实交互流回放到采集器。
// 用法：node tools/replay.js [间隔ms]   （需先 npm start）
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const gap = Number(process.argv[2]) || 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function post(path, body) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: 'localhost', port: 4317, path, method: 'POST' },
      (res) => { res.resume(); res.on('end', resolve); },
    );
    req.on('error', resolve);
    req.end(body);
  });
}

const order = [
  'userpromptsubmit.json', 'statusline.json', 'pretooluse-bash.json',
  'posttooluse-edit.json', 'taskcreate.json', 'taskupdate.json',
  'notification.json', 'stop.json',
];

for (const name of order) {
  let raw;
  try { raw = readFileSync(join(dir, name), 'utf8'); }
  catch { console.log(`跳过缺失样本 ${name}`); continue; }
  const path = name.startsWith('statusline') ? '/statusline' : '/hook';
  await post(path, raw);
  console.log(`回放 ${name} → ${path}`);
  await sleep(gap);
}
console.log('回放结束');
```

- [ ] **Step 4: 运行测试，确认全部通过**

Run: `npm test`
Expected: PASS，全部测试文件通过。

- [ ] **Step 5: 手动验证回放链路**

`npm start` → 另开终端 `node tools/replay.js 300`
全程观察 `curl http://localhost:4317/state`：状态应依次走
`working → running → waiting`，时间线与任务列表被填充。

- [ ] **Step 6: 提交**

```bash
git add tools/replay.js tests/e2e.test.js
git commit -m "feat: 回放工具与端到端冒烟测试"
```

---

## 范围与自检

**本计划覆盖的 spec 组件**：采集器/服务（Task 6）、Hook 转发器（Task 7）、
Statusline 包装器（Task 7）、Usage 轮询器（Task 5 + Task 6 内轮询）、
回放工具（Task 8）、数据模型与状态派生（Task 3-4）。

**有意推迟的部分**：
- HUD 网页 → 计划 2（消费本计划的 `/events` SSE）。
- 启动器、安装器、副屏检测、开机自启 → 计划 3。
- `contextPct`（上下文窗口精确百分比）：statusline JSON 若无现成字段，
  需由 transcript 解析得出，留待计划 2 处理；本计划 reducer 中默认 0。

**SSE 数据契约**（供计划 2 对接）：`GET /events` 持续推送
`data: <JSON>\n\n`，JSON 为 `{ focusId, sessions:[会话记录], usage, ts }`。
会话记录字段见 `src/state.js` 的 `createSession`。






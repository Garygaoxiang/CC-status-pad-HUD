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

test('TodoWrite 整体重建任务列表', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [
      { content: '写测试', status: 'completed', activeForm: '写测试中' },
      { content: '实现功能', status: 'in_progress', activeForm: '实现功能中' },
      { content: '提交', status: 'pending', activeForm: '提交中' },
    ] } }, 1);
  assert.equal(s.tasks.length, 3);
  assert.equal(s.tasks[0].subject, '写测试');
  assert.equal(s.tasks[1].status, 'in_progress');
  // 再次调用应整体替换列表，不累加
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: '收尾', status: 'pending' }] } }, 2);
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].subject, '收尾');
});

test('applyEvent 不修改入参', () => {
  const s0 = createSession('abc');
  applyEvent(s0, { hook_event_name: 'Stop' }, 1);
  assert.equal(s0.status, 'idle');
  // 嵌套结构同样不能被改动
  applyEvent(s0, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'x.ts' } }, 1);
  assert.deepEqual(s0.timeline, []);
  assert.deepEqual(s0.toolCounts, {});
});

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

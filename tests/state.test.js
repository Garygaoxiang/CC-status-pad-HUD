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

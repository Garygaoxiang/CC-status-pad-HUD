import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, applyEvent, applyStatusline, formatTool, estimateLines } from '../src/state.js';

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

import { pickFocus, pruneStale, STALE_MS } from '../src/state.js';

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

test('applyStatusline 存入 transcript_path 到 session.transcriptPath', () => {
  const s = applyStatusline(createSession('abc'), {
    transcript_path: 'C:/foo/bar.jsonl',
    model: { display_name: 'Opus 4.7 (1M context)' },
  }, 100);
  assert.equal(s.transcriptPath, 'C:/foo/bar.jsonl');
  assert.equal(s.model, 'Opus 4.7 (1M context)');
});

test('applyStatusline 无 transcript_path 时保留原值', () => {
  let s = createSession('abc');
  s = applyStatusline(s, { transcript_path: '/a.jsonl' }, 1);
  s = applyStatusline(s, {}, 2); // 无该字段，不应清空
  assert.equal(s.transcriptPath, '/a.jsonl');
});

test('createSession 初始 effort 为 null', () => {
  assert.equal(createSession('abc').effort, null);
});

test('applyStatusline 解析 effort.level，且可从有清回无（反映当次）', () => {
  let s = applyStatusline(createSession('abc'), { effort: { level: 'max' } }, 1);
  assert.equal(s.effort, 'max');
  s = applyStatusline(s, { model: { display_name: 'Opus' } }, 2); // 当次无 effort
  assert.equal(s.effort, null);
});

test('createSession 初始 workflow 为 null', () => {
  assert.equal(createSession('abc').workflow, null);
});

test('createSession 初始 filesChanged 为 0', () => {
  assert.equal(createSession('abc').filesChanged, 0);
});

test('PostToolUse Edit/Write/MultiEdit 累加 filesChanged（去重）', () => {
  let s = createSession('abc');
  // Edit 一个文件 → 1
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'C:/p/a.ts' } }, 1);
  assert.equal(s.filesChanged, 1);
  // Write 另一个文件 → 2
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: 'C:/p/b.ts' } }, 2);
  assert.equal(s.filesChanged, 2);
  // MultiEdit 第三个文件 → 3
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'MultiEdit',
    tool_input: { file_path: 'C:/p/c.ts' } }, 3);
  assert.equal(s.filesChanged, 3);
  // 再 Edit 同一个 a.ts → 仍是 3（去重）
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'C:/p/a.ts' } }, 4);
  assert.equal(s.filesChanged, 3);
});

test('PostToolUse Read/Bash 不影响 filesChanged', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Read',
    tool_input: { file_path: 'C:/p/a.ts' } }, 1);
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'ls' } }, 2);
  assert.equal(s.filesChanged, 0);
});

test('filesChanged 无 file_path 时不崩且不计数', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: {} }, 1);
  assert.equal(s.filesChanged, 0);
});

test('hook 带 transcript_path/effort → 写入会话（Desktop 无 statusline 时的唯一来源）', () => {
  let s = createSession('abc');
  s = applyEvent(s, {
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' },
    transcript_path: 'C:/u/.claude/projects/p/abc.jsonl', effort: { level: 'max' },
  }, 1000);
  assert.equal(s.transcriptPath, 'C:/u/.claude/projects/p/abc.jsonl');
  assert.equal(s.effort, 'max');
});

test('hook 的 effort 缺 level 时清空；整个 effort 键缺席则保持原值', () => {
  let s = { ...createSession('abc'), effort: 'high' };
  assert.equal(applyEvent(s, { hook_event_name: 'Stop' }, 1).effort, 'high');
  assert.equal(applyEvent(s, { hook_event_name: 'Stop', effort: {} }, 1).effort, null);
});

test('estimateLines 按工具入参估增删行数', () => {
  // Edit：整块替换 → 新块记增、旧块记删
  assert.deepEqual(estimateLines('Edit', { old_string: 'a\nb', new_string: 'x\ny\nz' }),
    { added: 3, removed: 2 });
  // Write：新内容整份记增，旧内容不可知、删记 0
  assert.deepEqual(estimateLines('Write', { content: 'l1\nl2\nl3' }), { added: 3, removed: 0 });
  // MultiEdit：各段累加
  assert.deepEqual(estimateLines('MultiEdit', { edits: [
    { old_string: 'a', new_string: 'b\nc' }, { old_string: 'd\ne', new_string: 'f' },
  ] }), { added: 3, removed: 3 });
  // 只读工具与缺参一律 0
  assert.deepEqual(estimateLines('Read', { file_path: 'a.js' }), { added: 0, removed: 0 });
  assert.deepEqual(estimateLines('Edit', {}), { added: 0, removed: 0 });
});

test('无 statusline 时（Desktop）从 hook 派生行数与会话时长', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'UserPromptSubmit' }, 1_000);
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'x\ny' } }, 31_000);
  assert.equal(s.linesAdded, 2);
  assert.equal(s.linesRemoved, 1);
  assert.equal(s.durationMs, 30_000);          // 首个事件 → 最新事件的墙钟
  // 再来一刀，累加而非覆盖
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: 'b.js', content: 'p\nq\nr' } }, 61_000);
  assert.equal(s.linesAdded, 5);
  assert.equal(s.durationMs, 60_000);
});

test('statusline 供过数（CLI）时不再自行派生，以 statusline 为准', () => {
  let s = createSession('abc');
  s = applyEvent(s, { hook_event_name: 'UserPromptSubmit' }, 1_000);
  s = applyStatusline(s, { cost: { total_lines_added: 40, total_lines_removed: 7,
    total_duration_ms: 123_000 } }, 2_000);
  s = applyEvent(s, { hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'a.js', old_string: 'a', new_string: 'x\ny' } }, 99_000);
  assert.equal(s.linesAdded, 40);
  assert.equal(s.linesRemoved, 7);
  assert.equal(s.durationMs, 123_000);
});

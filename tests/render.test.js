import test from 'node:test';
import assert from 'node:assert/strict';
import {
  focusSession, renderBanner, renderTimeline,
  renderTasks, renderToolCounts, renderChanges, renderUsage, renderFooter,
} from '../public/render.js';

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
  assert.match(html, /<span class="s-running on">1<\/span>/);
});

test('renderBanner 编号块按会话状态上色', () => {
  const snap = {
    focusId: 'a',
    sessions: [
      { sessionId: 'a', status: 'running' },
      { sessionId: 'b', status: 'idle' },
      { sessionId: 'c', status: 'waiting' },
    ],
  };
  const html = renderBanner(snap, snap.sessions[0]);
  assert.match(html, /<span class="s-running on">1<\/span>/);  // 焦点会话：状态类 + on
  assert.match(html, /<span class="s-idle">2<\/span>/);        // 完成 → 绿
  assert.match(html, /<span class="s-waiting">3<\/span>/);     // 需决策 → 红
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

test('renderToolCounts 转义工具名注入', () => {
  const html = renderToolCounts({ toolCounts: { '<script>': 1 } });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderTasks 转义任务主题注入', () => {
  const html = renderTasks({ tasks: [{ subject: '<img>', status: 'pending' }] });
  assert.doesNotMatch(html, /<img>/);
});

test('renderUsage 有百分比但无重置时间显示同步中', () => {
  const html = renderUsage({ usage: { fiveHour: 19, sevenDay: 11 } });
  assert.match(html, /19%/);
  assert.match(html, /同步中/);
  assert.doesNotMatch(html, /后重置/);
});

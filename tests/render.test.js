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

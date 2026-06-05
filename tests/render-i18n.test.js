import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTimeline, renderTasks, renderToolCounts,
  renderChanges, renderUsage, renderFooter,
} from '../public/render.js';

// 步②：渲染层接入 i18n。lang='en' 时输出英文文案，缺省回退 zh（既有 render.test.js 守护）。

test('renderTimeline en 空时间线英文占位', () => {
  assert.match(renderTimeline({ timeline: [] }, 'en'), /Waiting for events/);
});

test('renderTasks en 标题与空态英文', () => {
  const html = renderTasks({ tasks: [] }, 'en');
  assert.match(html, /Tasks/);
  assert.match(html, /No tasks/);
});

test('renderToolCounts en 标题与空态英文', () => {
  const html = renderToolCounts({ toolCounts: {} }, 'en');
  assert.match(html, /Tool Calls \(session\)/);
  assert.match(html, /No calls yet/);
});

test('renderChanges en 标题与文件计数英文', () => {
  const html = renderChanges({ filesChanged: 7, costUsd: 0.5, durationMs: 1000 }, 'en');
  assert.match(html, /Changes · Cost/);
  assert.match(html, /7 files/);
  assert.doesNotMatch(html, /个文件/);
});

test('renderChanges en 单文件用单数 file', () => {
  assert.match(renderChanges({ filesChanged: 1 }, 'en'), /\b1 file\b/);
});

test('renderUsage en 标题/窗口/重置/同步注释英文', () => {
  const now = Date.now();
  const html = renderUsage({ usage: {
    fiveHour: 19, sevenDay: 11,
    fiveHourResetAt: new Date(now + 121 * 60000).toISOString(),
    sevenDayResetAt: new Date(now + 7560 * 60000).toISOString(),
  } }, now, 'en');
  assert.match(html, /Account Usage/);
  assert.match(html, /5-Hour Window/);
  assert.match(html, /7-Day Window/);
  assert.match(html, /resets in 2h 01m/);
  assert.match(html, /SYNC every 5min/);
  assert.doesNotMatch(html, /后重置/);
});

test('renderUsage en 无用量显示 Syncing', () => {
  assert.match(renderUsage({ usage: null }, Date.now(), 'en'), /Syncing/);
});

test('renderFooter en 字段标签英文', () => {
  const html = renderFooter({ sessions: [{}, {}] }, { projectName: 'p', durationMs: 1000 }, true, 'en');
  assert.match(html, /Project/);
  assert.match(html, /Duration/);
  assert.match(html, /Sessions/);
});

test('renderFooter en 断连英文文案', () => {
  assert.match(renderFooter({ sessions: [] }, {}, false, 'en'), /reconnecting/);
  assert.doesNotMatch(renderFooter({ sessions: [] }, {}, false, 'en'), /重连中/);
});

test('缺省语言（不传 lang）仍为中文', () => {
  assert.match(renderTasks({ tasks: [] }), /暂无任务/);
  assert.match(renderUsage({ usage: null }), /同步中/);
});

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

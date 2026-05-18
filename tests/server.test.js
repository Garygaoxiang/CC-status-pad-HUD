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
  await c.stop();
});

test('坏 JSON 不致服务出错，仍返回 204', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/hook`,
    { method: 'POST', body: '不是json' });
  assert.equal(res.status, 204);
  await c.stop();
});

test('GET /events 立即推送一份 SSE 快照', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/events`);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /^data: /);
  await reader.cancel();
  await c.stop();
});

test('GET / 返回 HUD 页面', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /id="hud"/);
  await c.stop();
});

test('未知静态文件返回 404', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/nope.css`);
  assert.equal(res.status, 404);
  await c.stop();
});

test('路径穿越被拦截', async () => {
  const c = createCollector();
  const port = await listen(c);
  const res = await fetch(`http://localhost:${port}/%2e%2e%2f%2e%2e%2fsrc%2fserver.js`);
  assert.ok(res.status === 403 || res.status === 404);
  await c.stop();
});

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

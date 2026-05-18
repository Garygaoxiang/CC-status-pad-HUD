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
  await c.stop();
});

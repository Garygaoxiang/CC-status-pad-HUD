import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// pollTranscripts 集成：证明 contextPct 能从 transcript 派生并推到 snapshot。
// 造一个临时 jsonl（末条 assistant usage 合计 100_000 tokens），把 session 的
// transcriptPath 手动打进快照，触发 pollTranscripts，断言 contextPct = 50
// （100_000 / 200K 默认窗口 = 50%）。
test('pollTranscripts 从 transcript 派生 contextPct', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hud-'));
  const jsonlPath = join(dir, 't.jsonl');
  const jsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: {
      input_tokens: 100, cache_creation_input_tokens: 40_000, cache_read_input_tokens: 59_900, output_tokens: 500,
    } } }),
  ].join('\n');
  await writeFile(jsonlPath, jsonl, 'utf8');

  const c = createCollector();
  await listen(c);
  // 用 hook 建 session（PreToolUse 走 applyEvent，会把 cwd 记进 session）
  await fetch(`http://localhost:${c.server.address().port}/hook`, {
    method: 'POST',
    body: JSON.stringify({ session_id: 'ctx1', hook_event_name: 'PreToolUse',
      tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: dir }),
  });
  // statusline 塞 model（决定窗口）与 transcript_path（跳过反推）
  await fetch(`http://localhost:${c.server.address().port}/statusline`, {
    method: 'POST',
    body: JSON.stringify({ session_id: 'ctx1',
      model: { display_name: 'Sonnet (200k context)' }, transcript_path: jsonlPath }),
  });

  await c.pollTranscripts();
  const snap = c.snapshot();
  const sess = snap.sessions.find((s) => s.sessionId === 'ctx1');
  // 100_000 / 200_000 = 50%
  assert.equal(sess.contextPct, 50);
  await c.stop();
  await rm(dir, { recursive: true, force: true });
});

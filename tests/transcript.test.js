import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContextWindow, lastUsageFromTranscript, lastEffortMode,
  lastModelFromTranscript, deriveTranscriptPath, firstTimestamp,
} from '../src/transcript.js';

test('parseContextWindow 识别 1M', () => {
  assert.equal(parseContextWindow('Opus 4.7 (1M context)'), 1_000_000);
  assert.equal(parseContextWindow('Sonnet 4.6 (1M context)'), 1_000_000);
});

test('parseContextWindow 识别 200k / 200K', () => {
  assert.equal(parseContextWindow('Sonnet 4.6 (200k context)'), 200_000);
  assert.equal(parseContextWindow('Haiku (200K context)'), 200_000);
});

test('parseContextWindow 无匹配回退到 200K', () => {
  assert.equal(parseContextWindow('Opus 4.7'), 200_000);
  assert.equal(parseContextWindow(''), 200_000);
  assert.equal(parseContextWindow(null), 200_000);
  assert.equal(parseContextWindow(undefined), 200_000);
});

// Desktop 兼容路径 transcript 兜底给的是 raw model ID（无 "(1M context)" 后缀）；
// 目前用户账户仅确认 Opus 4.x 开了 1M，Sonnet/Haiku 暂无证据故保守留 200K。
test('parseContextWindow 识别 Opus 4.x raw ID → 1M', () => {
  assert.equal(parseContextWindow('claude-opus-4-7'), 1_000_000);
  assert.equal(parseContextWindow('claude-opus-4-8'), 1_000_000);
  assert.equal(parseContextWindow('claude-opus-4-6'), 1_000_000);
});

test('parseContextWindow 其他 raw ID 保持 200K 默认', () => {
  assert.equal(parseContextWindow('claude-haiku-4-5'), 200_000);
  assert.equal(parseContextWindow('claude-sonnet-4-5'), 200_000);
});

test('lastUsageFromTranscript 取最末 assistant 消息的 usage', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: {
      input_tokens: 1, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 50,
    } } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: {
      input_tokens: 2, cache_creation_input_tokens: 522, cache_read_input_tokens: 60565, output_tokens: 373,
    } } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
  ].join('\n');
  // 最末 assistant usage 总和 = 2 + 522 + 60565 = 61089
  assert.equal(lastUsageFromTranscript(jsonl), 61089);
});

test('lastUsageFromTranscript 无 usage 时返回 null', () => {
  const jsonl = JSON.stringify({ type: 'user', message: { role: 'user' } });
  assert.equal(lastUsageFromTranscript(jsonl), null);
  assert.equal(lastUsageFromTranscript(''), null);
});

test('lastUsageFromTranscript 跳过坏行、容忍缺字段', () => {
  const jsonl = [
    '{ broken',
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5 } } }),
    '',
  ].join('\n');
  // 仅 input_tokens=5，其他字段缺失视作 0
  assert.equal(lastUsageFromTranscript(jsonl), 5);
});

const sl = (mode) => JSON.stringify({ type: 'user', message: { role: 'user',
  content: `<local-command-stdout>Set effort level to ${mode} (this session only): xhigh + dynamic workflow orchestration</local-command-stdout>` } });

test('lastEffortMode 取最末一次 effort 设置命令的模式', () => {
  const jsonl = [sl('high'), JSON.stringify({ type: 'assistant', message: {} }), sl('ultracode')].join('\n');
  assert.equal(lastEffortMode(jsonl), 'ultracode');
});

test('lastEffortMode 切回别的模式后返回新模式', () => {
  assert.equal(lastEffortMode([sl('ultracode'), sl('high')].join('\n')), 'high');
});

test('lastEffortMode 忽略 tool_result 数组里的同名文本(防污染)', () => {
  // 工具输出把 "Set effort level to ultracode" 写进了 transcript（content 是数组），不应被误判
  const polluted = JSON.stringify({ type: 'user', message: { role: 'user',
    content: [{ type: 'tool_result', content: 'echo Set effort level to ultracode 这是工具输出污染' }] } });
  assert.equal(lastEffortMode(polluted), null);
});

test('lastEffortMode 无 effort 命令返回 null', () => {
  assert.equal(lastEffortMode(JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })), null);
  assert.equal(lastEffortMode(''), null);
  assert.equal(lastEffortMode(null), null);
});

// lastModelFromTranscript：Desktop 无 statusline 时的 model 兜底数据源。
// message.model 是 model ID（如 "claude-opus-4-7"），非 display_name，原样返回。
test('lastModelFromTranscript 取最末 assistant 消息的 model', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-4-7' } }),
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
  ].join('\n');
  assert.equal(lastModelFromTranscript(jsonl), 'claude-opus-4-7');
});

test('lastModelFromTranscript 无 model 返回 null', () => {
  assert.equal(lastModelFromTranscript(''), null);
  assert.equal(lastModelFromTranscript(null), null);
  assert.equal(lastModelFromTranscript(JSON.stringify({ type: 'user', message: { role: 'user' } })), null);
});

test('lastModelFromTranscript 跳过坏行', () => {
  const jsonl = ['{ broken',
    JSON.stringify({ type: 'assistant', message: { model: 'claude-haiku-4-5' } })].join('\n');
  assert.equal(lastModelFromTranscript(jsonl), 'claude-haiku-4-5');
});

// deriveTranscriptPath：Desktop hook 里只有 session_id + cwd，需按 CLI 规则反推
// transcript 路径。规则实测：cwd 里所有非字母数字字符替换为 '-'。
test('deriveTranscriptPath 按 CLI 规则拼路径（H:\\turzx\\turzx-coding-hud）', () => {
  const sid = 'aeccdd79-e033-436c-9145-a912bb243b0d';
  assert.equal(
    deriveTranscriptPath(sid, 'H:\\turzx\\turzx-coding-hud', '/c/Users/GaryPC'),
    `/c/Users/GaryPC/.claude/projects/H--turzx-turzx-coding-hud/${sid}.jsonl`,
  );
});

test('deriveTranscriptPath 空格/数字按实测规则编码', () => {
  // 实测目录名 "D--Graphisoft-Archicad-28-INT-ArchiApiUtilities" 对应此 cwd
  const sid = 'd488c7d1';
  const cwd = 'D:\\Graphisoft\\Archicad 28 INT\\ArchiApiUtilities';
  assert.equal(
    deriveTranscriptPath(sid, cwd, '/c/Users/GaryPC'),
    `/c/Users/GaryPC/.claude/projects/D--Graphisoft-Archicad-28-INT-ArchiApiUtilities/${sid}.jsonl`,
  );
});

test('deriveTranscriptPath 缺参返回 null', () => {
  assert.equal(deriveTranscriptPath(null, 'a', 'b'), null);
  assert.equal(deriveTranscriptPath('sid', null, 'b'), null);
  assert.equal(deriveTranscriptPath('sid', 'a', null), null);
  assert.equal(deriveTranscriptPath('', 'a', 'b'), null);
});

test('firstTimestamp 取首条带时间戳的记录，作为会话真实起点', () => {
  const jsonl = [
    JSON.stringify({ type: 'queue-operation', timestamp: '2026-08-23T07:04:14.356Z' }),
    JSON.stringify({ type: 'user', timestamp: '2026-08-23T07:05:00.000Z' }),
  ].join('\n');
  assert.equal(firstTimestamp(jsonl), Date.parse('2026-08-23T07:04:14.356Z'));
  // 首行没时间戳就往下找
  assert.equal(firstTimestamp(['{"type":"x"}', '{"timestamp":"2026-08-23T08:00:00.000Z"}'].join('\n')),
    Date.parse('2026-08-23T08:00:00.000Z'));
  // 坏行跳过；全无时间戳、空文本一律 null
  assert.equal(firstTimestamp('不是json\n{"timestamp":"2026-08-23T08:00:00.000Z"}'),
    Date.parse('2026-08-23T08:00:00.000Z'));
  assert.equal(firstTimestamp('{"type":"x"}'), null);
  assert.equal(firstTimestamp(''), null);
  assert.equal(firstTimestamp('{"timestamp":"瞎写"}'), null);
});

test('parseContextWindow：raw model ID 的 opus 家族一律 1M', () => {
  // Desktop 兜底路径给的是 raw ID，没有 "(1M context)" 可解析
  assert.equal(parseContextWindow('claude-opus-5'), 1_000_000);
  assert.equal(parseContextWindow('claude-opus-4-7'), 1_000_000);
  // 非 opus 的 raw ID 保持 200K 默认，宁可低估不虚高
  assert.equal(parseContextWindow('claude-haiku-4-5-20251001'), 200_000);
});

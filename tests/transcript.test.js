import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContextWindow, lastUsageFromTranscript } from '../src/transcript.js';

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

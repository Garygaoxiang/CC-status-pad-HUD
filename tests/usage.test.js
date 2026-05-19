import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUsage, pickProxy } from '../src/usage.js';

test('parseUsage 取整并夹紧 0-100', () => {
  const u = parseUsage({
    five_hour: { utilization: 19.4, resets_at: '2026-05-17T20:00:00Z' },
    seven_day: { utilization: 11.6, resets_at: '2026-05-23T00:00:00Z' },
  });
  assert.equal(u.fiveHour, 19);
  assert.equal(u.sevenDay, 12);
  assert.equal(u.fiveHourResetAt, '2026-05-17T20:00:00Z');
});

test('parseUsage 容忍缺字段', () => {
  const u = parseUsage({});
  assert.equal(u.fiveHour, null);
  assert.equal(u.sevenDay, null);
});

test('parseUsage 夹紧越界值', () => {
  const u = parseUsage({ five_hour: { utilization: 250 }, seven_day: { utilization: -5 } });
  assert.equal(u.fiveHour, 100);
  assert.equal(u.sevenDay, 0);
});

test('pickProxy 优先取环境变量', () => {
  assert.equal(
    pickProxy({ env: { HTTPS_PROXY: 'http://settings:1' } }, { HTTPS_PROXY: 'http://env:2' }),
    'http://env:2',
  );
});

test('pickProxy 回退到 settings.json 的 env 块', () => {
  assert.equal(
    pickProxy({ env: { HTTPS_PROXY: 'http://127.0.0.1:10809' } }, {}),
    'http://127.0.0.1:10809',
  );
});

test('pickProxy 无配置返回 null', () => {
  assert.equal(pickProxy({}, {}), null);
  assert.equal(pickProxy(undefined, undefined), null);
});

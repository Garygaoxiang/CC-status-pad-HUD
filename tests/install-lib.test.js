import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickScreen } from '../tools/install-lib.js';

const S = (x, y, w, h, primary = false) => ({ x, y, width: w, height: h, primary });

test('pickScreen 精确匹配目标分辨率优先', () => {
  const screens = [S(0, 0, 3440, 1440, true), S(3440, 0, 1920, 480)];
  const r = pickScreen(screens, { width: 1920, height: 480 });
  assert.equal(r.x, 3440);
  assert.equal(r.exact, true);
});

test('pickScreen 无精确匹配时回退第一个非主屏', () => {
  const screens = [S(0, 0, 3440, 1440, true), S(3440, 0, 1280, 800)];
  const r = pickScreen(screens, { width: 1920, height: 480 });
  assert.equal(r.x, 3440);
  assert.equal(r.width, 1280);
  assert.equal(r.exact, false);
});

test('pickScreen 只有主屏时返回 null', () => {
  const screens = [S(0, 0, 3440, 1440, true)];
  assert.equal(pickScreen(screens, { width: 1920, height: 480 }), null);
});

test('pickScreen 空列表返回 null', () => {
  assert.equal(pickScreen([], { width: 1920, height: 480 }), null);
});

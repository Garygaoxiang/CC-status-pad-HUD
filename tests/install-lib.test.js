import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickScreen } from '../tools/install-lib.js';

const S = (x, y, w, h, primary = false) => ({ x, y, width: w, height: h, primary });

test('pickScreen 精确匹配目标分辨率优先', () => {
  const screens = [S(0, 0, 3440, 1440, true), S(3440, 0, 1920, 480)];
  const r = pickScreen(screens, { width: 1920, height: 480 });
  assert.equal(r.x, 3440);
  assert.equal(r.width, 1920);
  assert.equal(r.height, 480);
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

import { mergeSettings, restoreSettings } from '../tools/install-lib.js';

const HOOK = 'H:\\turzx\\turzx-coding-hud\\bin\\hud-hook.cmd';
const SL = 'H:\\turzx\\turzx-coding-hud\\bin\\hud-statusline.cmd';
const EVENTS = ['UserPromptSubmit','PreToolUse','PostToolUse','Notification','Stop','SessionEnd'];
const hasHud = (groups) => (groups || []).some((g) => g.hooks.some((h) => h.command === HOOK));

test('mergeSettings 给 6 个事件各加 HUD hook，保留已有 gsd hook', () => {
  const base = {
    hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node gsd.js' }] }] },
    statusLine: { type: 'command', command: 'bun claude-hud' },
  };
  const { nextSettings, savedStatusline } = mergeSettings(base, { hookCmd: HOOK, statuslineCmd: SL });
  for (const ev of EVENTS) assert.ok(hasHud(nextSettings.hooks[ev]), `${ev} 应有 HUD hook`);
  assert.ok(nextSettings.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'node gsd.js')));
  assert.equal(savedStatusline, 'bun claude-hud');
  assert.equal(nextSettings.statusLine.command, SL);
});

test('mergeSettings 幂等：重复合并不重复加 hook', () => {
  let s = { hooks: {}, statusLine: { command: 'orig' } };
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  assert.equal(s.hooks.Stop.filter((g) => g.hooks.some((h) => h.command === HOOK)).length, 1);
});

test('mergeSettings 二次合并时 savedStatusline 不被 HUD 命令污染', () => {
  let r = mergeSettings({ hooks: {}, statusLine: { command: 'orig' } }, { hookCmd: HOOK, statuslineCmd: SL });
  assert.equal(r.savedStatusline, 'orig');
  r = mergeSettings(r.nextSettings, { hookCmd: HOOK, statuslineCmd: SL });
  assert.equal(r.savedStatusline, null);   // 已是 HUD statusline → 不覆盖已存的原始命令
});

test('restoreSettings 移除 HUD hook 并还原 statusLine，不改入参', () => {
  let s = { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node gsd.js' }] }] },
    statusLine: { command: 'orig' } };
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  const before = JSON.stringify(s);
  const restored = restoreSettings(s, { savedStatusline: 'orig' });
  for (const ev of Object.keys(restored.hooks)) assert.ok(!hasHud(restored.hooks[ev]));
  assert.ok(restored.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'node gsd.js')));
  assert.equal(restored.statusLine.command, 'orig');
  assert.equal(JSON.stringify(s), before);   // 入参未被修改
});

test('restoreSettings 原本无 statusLine 时卸载后移除 HUD statusLine', () => {
  const s = mergeSettings({ hooks: {} }, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  const restored = restoreSettings(s, { savedStatusline: '' });
  assert.equal(restored.statusLine, undefined);
});

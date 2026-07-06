import test from 'node:test';
import assert from 'node:assert/strict';
import { reviveClaudeHudPath } from '../bin/statusline-path.js';

// 归一化分隔符后查表的 deps 工厂
function deps(existsKeys, versions) {
  const set = new Set(existsKeys.map((k) => k.replace(/\\/g, '/')));
  return {
    exists: (p) => set.has(String(p).replace(/\\/g, '/')),
    listVersions: () => versions,
  };
}

const BASE = 'C:/Users/Me/.claude/plugins/cache/claude-hud/claude-hud';
const CMD = `"C:/bun" "${BASE}/0.1.0/dist/index.js"`;

test('版本目录仍存在 → 原样返回', () => {
  const d = deps([`${BASE}/0.1.0/dist/index.js`], ['0.1.0']);
  assert.equal(reviveClaudeHudPath(CMD, d), CMD);
});

test('pin 的版本失效、有更新版本 → 替换成现存版本', () => {
  const d = deps([`${BASE}/0.3.0/dist/index.js`], ['0.3.0']);
  const out = reviveClaudeHudPath(CMD, d);
  assert.ok(out.includes('0.3.0/dist/index.js'), out);
  assert.ok(!out.includes('0.1.0'), out);
});

test('非 claude-hud 命令 → 原样返回、不误伤', () => {
  const other = '"C:/bun" "C:/some/other/tool/dist/index.js"';
  assert.equal(reviveClaudeHudPath(other, deps([], [])), other);
});

test('没有任何现存版本 → 原样返回（安全降级，不比现状更糟）', () => {
  assert.equal(reviveClaudeHudPath(CMD, deps([], [])), CMD);
});

test('多个现存版本 → 按 semver 取最大（0.10.0 > 0.2.0，非字符串比较）', () => {
  const d = deps(
    [`${BASE}/0.2.0/dist/index.js`, `${BASE}/0.10.0/dist/index.js`],
    ['0.2.0', '0.10.0'],
  );
  const out = reviveClaudeHudPath(CMD, d);
  assert.ok(out.includes('0.10.0/dist/index.js'), out);
});

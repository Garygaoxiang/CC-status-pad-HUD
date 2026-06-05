import test from 'node:test';
import assert from 'node:assert/strict';
import { dict, LABELS } from '../public/i18n.js';

test('dict 返回对应语言，未知 / 空回退 zh', () => {
  assert.equal(dict('en'), LABELS.en);
  assert.equal(dict('zh'), LABELS.zh);
  assert.equal(dict('fr'), LABELS.zh);   // 未知语言回退中文
  assert.equal(dict(), LABELS.zh);
});

test('zh / en 文案 key 集合完全一致（防漏译）', () => {
  const zk = Object.keys(LABELS.zh).sort();
  const ek = Object.keys(LABELS.en).sort();
  assert.deepEqual(ek, zk);
});

test('files / reset 为插值函数，中英语序正确', () => {
  assert.equal(typeof dict('en').files, 'function');
  assert.equal(typeof dict('en').reset, 'function');
  assert.match(dict('en').files(3), /3 files/);
  assert.match(dict('en').files(1), /1 file\b/);   // 英文单复数
  assert.match(dict('zh').files(3), /3 个文件/);
  assert.match(dict('en').reset('2h 01m'), /resets in 2h 01m/);   // 英文前缀
  assert.match(dict('zh').reset('2h 01m'), /2h 01m 后重置/);      // 中文后缀
});

test('关键标题字符串存在且非空', () => {
  for (const lang of ['zh', 'en']) {
    const L = dict(lang);
    for (const k of ['timelineHeader', 'tasksTitle', 'toolsTitle', 'usageTitle', 'fProject', 'cdNow']) {
      assert.equal(typeof L[k], 'string');
      assert.ok(L[k].length > 0, `${lang}.${k} 不应为空`);
    }
  }
});

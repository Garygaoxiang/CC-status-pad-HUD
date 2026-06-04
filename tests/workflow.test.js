import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionDirFromTranscript, parseWorkflowName, parsePhaseTotal,
} from '../src/workflow.js';

test('sessionDirFromTranscript 去 .jsonl 后缀', () => {
  assert.equal(sessionDirFromTranscript('/a/b/sid.jsonl'), '/a/b/sid');
  assert.equal(sessionDirFromTranscript('/a/b.txt'), null);
  assert.equal(sessionDirFromTranscript(null), null);
});

test('parseWorkflowName 从脚本文件名提取 name', () => {
  assert.equal(parseWorkflowName('hook-probe-wf_02c8b2a5-ddc.js', 'wf_02c8b2a5-ddc'), 'hook-probe');
  assert.equal(parseWorkflowName('other.js', 'wf_02c8b2a5-ddc'), null);
});

test('parsePhaseTotal 数 meta.phases 内 title 个数，失败 null', () => {
  assert.equal(parsePhaseTotal("meta = { phases: [{title:'A'},{title:'B'}] }"), 2);
  assert.equal(parsePhaseTotal("phases: [{ title: 'Probe' }]"), 1);
  assert.equal(parsePhaseTotal('no phases here'), null);
  assert.equal(parsePhaseTotal('phases: []'), null);
});

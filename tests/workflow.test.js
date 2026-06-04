import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sessionDirFromTranscript, parseWorkflowName, parsePhaseTotal, deriveWorkflow, DONE_TTL, collectWorkflow,
} from '../src/workflow.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('deriveWorkflow running：无 wf json，数 agent 文件得 M/N', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: false, metaCount: 8, jsonlCount: 3, agentMtime: 100, name: 'rev', phaseTotal: 4 },
  ] }, 1000);
  assert.deepEqual(wf, { name: 'rev', runId: 'wf_a', status: 'running', doneAgents: 3, totalAgents: 8, phaseTotal: 4 });
});

test('deriveWorkflow done：wf json 新鲜，用 agentCount + workflowName', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: true, wfJsonMtime: 980, wfName: 'rev', agentCount: 8, phaseTotal: 4 },
  ] }, 1000);
  assert.equal(wf.status, 'done');
  assert.equal(wf.doneAgents, 8);
  assert.equal(wf.totalAgents, 8);
  assert.equal(wf.name, 'rev');
});

test('deriveWorkflow hidden：wf json mtime 已旧 → null', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_a', wfJsonExists: true, wfJsonMtime: 0, agentCount: 8 },
  ] }, DONE_TTL + 1);
  assert.equal(wf, null);
});

test('deriveWorkflow 无 run / 空 → null', () => {
  assert.equal(deriveWorkflow({ runs: [] }, 1), null);
  assert.equal(deriveWorkflow({}, 1), null);
});

test('deriveWorkflow 多候选：running 优先于 done', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_done', wfJsonExists: true, wfJsonMtime: 999, agentCount: 5, wfName: 'd' },
    { runId: 'wf_run', wfJsonExists: false, metaCount: 4, jsonlCount: 1, agentMtime: 500, name: 'r' },
  ] }, 1000);
  assert.equal(wf.runId, 'wf_run');
  assert.equal(wf.status, 'running');
});

test('deriveWorkflow 多 running 取 agentMtime 最新', () => {
  const wf = deriveWorkflow({ runs: [
    { runId: 'wf_old', wfJsonExists: false, metaCount: 2, jsonlCount: 1, agentMtime: 100, name: 'old' },
    { runId: 'wf_new', wfJsonExists: false, metaCount: 3, jsonlCount: 2, agentMtime: 900, name: 'new' },
  ] }, 1000);
  assert.equal(wf.runId, 'wf_new');
});

test('collectWorkflow 从真实目录采集 running 态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hud-wf-'));
  const sid = join(root, 'sid');
  const runId = 'wf_test123-abc';
  const runDir = join(sid, 'subagents', 'workflows', runId);
  await mkdir(runDir, { recursive: true });
  await mkdir(join(sid, 'workflows', 'scripts'), { recursive: true });
  await writeFile(join(runDir, 'agent-a1.meta.json'), '{"agentType":"x"}');
  await writeFile(join(runDir, 'agent-a2.meta.json'), '{"agentType":"x"}');
  await writeFile(join(runDir, 'agent-a1.jsonl'), '{}');
  await writeFile(join(sid, 'workflows', 'scripts', `myflow-${runId}.js`),
    "export const meta = { name: 'myflow', phases: [{title:'A'},{title:'B'}] }");
  const wf = await collectWorkflow(sid, 2000);
  assert.equal(wf.status, 'running');
  assert.equal(wf.doneAgents, 1);
  assert.equal(wf.totalAgents, 2);
  assert.equal(wf.name, 'myflow');
  assert.equal(wf.phaseTotal, 2);
  await rm(root, { recursive: true, force: true });
});

test('collectWorkflow 无 workflow 目录 → null', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hud-wf-'));
  assert.equal(await collectWorkflow(join(root, 'empty'), 1000), null);
  await rm(root, { recursive: true, force: true });
});

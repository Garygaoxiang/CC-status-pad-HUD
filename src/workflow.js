// src/workflow.js — workflow 进度采集。纯函数 + 薄 IO，照 transcript.js 先例。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const DONE_TTL = 60_000;

// transcriptPath ".../<sid>.jsonl" → session 目录 ".../<sid>"；非 jsonl 返回 null
export function sessionDirFromTranscript(transcriptPath) {
  const p = String(transcriptPath || '');
  return p.endsWith('.jsonl') ? p.slice(0, -6) : null;
}

// scripts 文件名 "<name>-<runId>.js" + runId → name；不匹配返回 null
export function parseWorkflowName(scriptFileName, runId) {
  const f = String(scriptFileName || '');
  const suffix = `-${runId}.js`;
  return f.endsWith(suffix) ? (f.slice(0, -suffix.length) || null) : null;
}

// 脚本源码 → meta.phases 内 title 计数；解析失败或空数组返回 null（降级）
export function parsePhaseTotal(scriptText) {
  const m = String(scriptText || '').match(/phases\s*:\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const count = (m[1].match(/title\s*:/g) || []).length;
  return count > 0 ? count : null;
}

// 原始目录数据 { runs } → session.workflow 或 null。
// running（无 wf json）优先于 done（wf json 新鲜）；同类取 mtime 最新；wf json 旧则忽略。
export function deriveWorkflow(raw, now = Date.now()) {
  const runs = Array.isArray(raw && raw.runs) ? raw.runs : [];
  const cands = [];
  for (const r of runs) {
    if (!r.wfJsonExists) {
      if (r.metaCount > 0) cands.push({ r, status: 'running', sortKey: r.agentMtime || 0 });
    } else if (now - (r.wfJsonMtime || 0) < DONE_TTL) {
      cands.push({ r, status: 'done', sortKey: r.wfJsonMtime || 0 });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) =>
    (a.status !== b.status) ? (a.status === 'running' ? -1 : 1) : b.sortKey - a.sortKey);
  const { r, status } = cands[0];
  if (status === 'running') {
    return { name: r.name || r.runId, runId: r.runId, status: 'running',
      doneAgents: r.jsonlCount, totalAgents: r.metaCount, phaseTotal: r.phaseTotal ?? null };
  }
  return { name: r.wfName || r.name || r.runId, runId: r.runId, status: 'done',
    doneAgents: r.agentCount, totalAgents: r.agentCount, phaseTotal: r.phaseTotal ?? null };
}

// 薄 IO：扫 session 目录 workflow 产物，组装 raw 交 deriveWorkflow。全程容错，最坏返回 null。
export async function collectWorkflow(sessionDir, now = Date.now()) {
  if (!sessionDir) return null;
  const subRoot = join(sessionDir, 'subagents', 'workflows');
  const wfRoot = join(sessionDir, 'workflows');
  const scriptsRoot = join(wfRoot, 'scripts');
  let runIds;
  try {
    const ents = await readdir(subRoot, { withFileTypes: true });
    runIds = ents.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return null; } // 从没跑过 workflow
  let scripts = [];
  try { scripts = await readdir(scriptsRoot); } catch { /* 无 scripts 不致命 */ }
  const runs = [];
  for (const runId of runIds) {
    const dir = join(subRoot, runId);
    let files;
    try { files = await readdir(dir); } catch { continue; }
    const metaCount = files.filter((f) => f.endsWith('.meta.json')).length;
    const jsonlCount = files.filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')).length;
    let agentMtime = 0;
    for (const f of files) {
      try { const st = await stat(join(dir, f)); if (st.mtimeMs > agentMtime) agentMtime = st.mtimeMs; } catch { /* 跳过 */ }
    }
    let wfJsonExists = false, wfJsonMtime = 0, wfName = null, agentCount = jsonlCount, phaseTotal = null;
    try {
      const wfPath = join(wfRoot, `${runId}.json`);
      wfJsonMtime = (await stat(wfPath)).mtimeMs;
      wfJsonExists = true;
      const j = JSON.parse(await readFile(wfPath, 'utf8'));
      wfName = j.workflowName || null;
      if (Number.isFinite(j.agentCount)) agentCount = j.agentCount;
      if (Array.isArray(j.phases) && j.phases.length) phaseTotal = j.phases.length;
    } catch { /* 无 wf json = 运行中 */ }
    const script = scripts.find((s) => s.endsWith(`-${runId}.js`));
    let name = null;
    if (script) {
      name = parseWorkflowName(script, runId);
      if (phaseTotal == null) {
        try { phaseTotal = parsePhaseTotal(await readFile(join(scriptsRoot, script), 'utf8')); } catch { /* 降级 */ }
      }
    }
    runs.push({ runId, wfJsonExists, wfJsonMtime, metaCount, jsonlCount, agentMtime, name, wfName, agentCount, phaseTotal });
  }
  return deriveWorkflow({ runs }, now);
}

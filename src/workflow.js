// src/workflow.js — workflow 进度采集。纯函数 + 薄 IO，照 transcript.js 先例。
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

// public/format.js — 纯标量格式化。浏览器与 Node 测试共用，无 DOM 依赖。

const STATUS_LABEL = {
  working: 'WORKING', running: 'RUNNING', waiting: 'WAITING',
  idle: 'IDLE', ended: 'ENDED',
};
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const TOOL_COLOR = {
  Bash: '#27d3f5', Edit: '#f0a35e', Write: '#f0a35e', NotebookEdit: '#f0a35e',
  Read: '#6ea8ff', Grep: '#b58bff', Glob: '#b58bff', Task: '#3ff58f',
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ESC_MAP[c]);
}

export function statusText(session) {
  const s = session || {};
  const label = STATUS_LABEL[s.status] || 'IDLE';
  if (s.currentTool) {
    const [tool, ...rest] = String(s.currentTool).split(' · ');
    return { big: `${label} · ${tool.toUpperCase()}`, sub: rest.join(' · ') };
  }
  return { big: label, sub: s.projectName || '' };
}

export function clock(ts) {
  if (!Number.isFinite(ts)) return '--:--:--';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function toolColor(tool) {
  return TOOL_COLOR[tool] || '#5878a3';
}

export function barWidth(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.max(0, Math.min(100, n))}%`;
}

export function countdown(resetsAt, now = Date.now(), nowWord = '现在') {
  if (!resetsAt) return '—';
  const ms = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(ms)) return '—';
  if (ms <= 0) return nowWord;
  const m = Math.floor(ms / 60000);
  const p = (n) => String(n).padStart(2, '0');
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${p(h)}h`;
  if (h > 0) return `${h}h ${p(m % 60)}m`;
  return `${m % 60}m`;
}

export function taskProgress(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;
  const done = list.filter((t) => t && t.status === 'completed').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function duration(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

const EFFORT_LABEL = { low: 'LOW', medium: 'MED', high: 'HIGH', xhigh: 'XHIGH', max: 'MAX' };

export function effortLabel(level, ultra) {
  if (ultra) return 'ULTRA'; // ultracode 覆盖等级，含 effort 为 null 时也显示
  if (!level) return '';
  return EFFORT_LABEL[level] || String(level).toUpperCase();
}

export function effortClass(level, ultra) {
  if (ultra) return 'e-ultra'; // ultracode 专属配色，覆盖等级
  if (level === 'high') return 'e-hi';
  if (level === 'xhigh' || level === 'max') return 'e-max';
  if (level === 'low' || level === 'medium') return 'e-lo';
  return ''; // 空值或未知：基础 chip 样式，不分色
}

// workflow chip 文案：running 显 "⚙ WF M/N"，done 加 ✓，无则空
export function workflowChipText(wf) {
  if (!wf) return '';
  const mn = `${wf.doneAgents}/${wf.totalAgents}`;
  return wf.status === 'done' ? `⚙ WF ✓ ${mn}` : `⚙ WF ${mn}`;
}
// workflow chip / 进度块配色类：running 青、done 绿、无则空
export function workflowClass(wf) {
  if (!wf) return '';
  return wf.status === 'done' ? 'wf-done' : 'wf-run';
}
// workflow 进度百分比：done 恒 100，running 按 M/N，N=0 时 0
export function workflowPct(wf) {
  if (!wf) return 0;
  if (wf.status === 'done') return 100;
  const n = Number(wf.totalAgents) || 0;
  return n > 0 ? Math.round((Number(wf.doneAgents) || 0) / n * 100) : 0;
}
// workflow phase 文案：有 phaseTotal 显 "phase ·/N"（当前 phase 不可得），无则空
export function workflowPhaseText(wf) {
  return (wf && wf.phaseTotal != null) ? `phase ·/${wf.phaseTotal}` : '';
}

// HUD 画布等比缩放比例：把 baseW×baseH 设计稿等比铺进实际窗口，取宽/高较小比、保宽高比、不裁切。
// 非有限或非正（异常窗口尺寸）时回退 1，绝不返回 0/NaN 拖垮渲染。
export function fitScale(winW, winH, baseW = 1920, baseH = 480) {
  const s = Math.min(Number(winW) / baseW, Number(winH) / baseH);
  return Number.isFinite(s) && s > 0 ? s : 1;
}

// 画布基准尺寸：按窗口宽高比在「带状副屏」与「4:3 平板」两套设计稿之间选。
// TURZX 副屏是 1920×480（4:1）；iPad 横屏是 4:3，用带状画布只能等比缩到 1/3 屏、上下全黑边，
// 故给平板另配一张 1440×1080 的竖排稿（配合 body.tall 的 CSS 把三列改上下堆叠）。
// 2.5 是分界：真·带状屏都在 3 以上，平板/常规窗口都在 2 以下，中间没有实际设备。
// 尺寸读不到时兜底 wide —— 保持副屏原行为，绝不把主用设备切成另一套布局。
export function pickCanvas(winW, winH) {
  const r = Number(winW) / Number(winH);
  return Number.isFinite(r) && r < 2.5
    ? { mode: 'tall', baseW: 1440, baseH: 1080 }
    : { mode: 'wide', baseW: 1920, baseH: 480 };
}

// 美化 model 显示：statusline 送的 display_name（"Opus 4.7 (1M context)"）原样透传；
// transcript 兜底出来的 raw ID（"claude-opus-4-7"、"claude-haiku-4-5-20251001"）
// 解析成「Family M.m」。空值→null；claude- 前缀但结构不识别时原样返回避免吞值。
export function modelDisplay(model) {
  if (!model) return null;
  const s = String(model);
  if (!s.startsWith('claude-')) return s;
  const parts = s.split('-');
  if (parts.length < 3) return s;
  const [, family, major, minor] = parts;
  if (!/^\d+$/.test(major)) return s;
  const cap = family.charAt(0).toUpperCase() + family.slice(1);
  if (minor && /^\d+$/.test(minor)) return `${cap} ${major}.${minor}`;
  return `${cap} ${major}`;
}

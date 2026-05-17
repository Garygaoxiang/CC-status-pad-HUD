// public/render.js — 纯函数：输入快照/会话，返回 HTML 字符串片段。浏览器与 Node 测试共用。
import { esc, statusText, clock, toolColor, barWidth } from './format.js';

export function focusSession(snapshot) {
  const s = snapshot || {};
  const list = Array.isArray(s.sessions) ? s.sessions : [];
  return list.find((x) => x && x.sessionId === s.focusId) || list[0] || null;
}

function chip(text, cls = '') {
  return text ? `<span class="${cls ? `chip ${cls}` : 'chip'}">${esc(text)}</span>` : '';
}

function bannerStatus(session) {
  const { big, sub } = statusText(session);
  const [head, ...tail] = big.split(' · ');
  const tool = tail.length ? ` <b>· ${esc(tail.join(' · '))}</b>` : '';
  return `<h1>${esc(head)}${tool} <span class="cr">_</span></h1>`
    + `<p class="mono">${esc(sub)}</p>`;
}

export function renderBanner(snapshot, session) {
  const s = session || {};
  const pct = Math.round(Number(s.contextPct) || 0);
  const sessions = Array.isArray((snapshot || {}).sessions) ? snapshot.sessions : [];
  const chips = [
    chip(s.model && String(s.model).toUpperCase(), 'k'),
    chip(s.plan, 'm'),
    chip(s.projectName),
    s.branch ? `<span class="chip mono">⎇ ${esc(s.branch)}</span>` : '',
  ].join('');
  const sess = sessions.map((x, i) =>
    `<span class="${x && x.sessionId === s.sessionId ? 'on' : ''}">${i + 1}</span>`).join('');
  return `<div class="hex">CC</div>
<div class="stdot"></div>
<div class="sttxt">${bannerStatus(s)}</div>
<div class="ctx">
  <div class="top"><span>CONTEXT</span><b>${pct}%</b></div>
  <div class="bar"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
</div>
<div class="chips">${chips}</div>
<div class="sess">${sess}</div>`;
}

export function renderTimeline(session) {
  const s = session || {};
  const rows = [];
  if (s.currentTool) {
    rows.push(`<div class="ev act"><span class="d"></span>`
      + `<span class="t">${clock(s.lastSeen)}</span>`
      + `<span class="x">▶ ${esc(s.currentTool)}</span></div>`);
  }
  const tl = Array.isArray(s.timeline) ? [...s.timeline].reverse() : [];
  for (const e of tl) {
    if (!e) continue;
    rows.push(`<div class="ev"><span class="d" style="background:${toolColor(e.tool)}"></span>`
      + `<span class="t">${clock(e.ts)}</span>`
      + `<span class="x">${esc(e.label)}</span></div>`);
  }
  if (!rows.length) {
    rows.push('<div class="ev"><span class="x" style="color:#516a90">等待事件…</span></div>');
  }
  return rows.join('');
}

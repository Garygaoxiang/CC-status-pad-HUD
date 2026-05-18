// public/render.js — 纯函数：输入快照/会话，返回 HTML 字符串片段。浏览器与 Node 测试共用。
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
} from './format.js';

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

export function renderTasks(session) {
  const tasks = Array.isArray((session || {}).tasks) ? session.tasks : [];
  const { done, total, pct } = taskProgress(tasks);
  const items = tasks.map((t) => {
    const st = t && t.status;
    const mark = st === 'completed' ? '<span class="done">✓</span>'
      : st === 'in_progress' ? '<span class="now">▶</span>' : '<span>·</span>';
    return `${mark} ${esc(t && t.subject)}`;
  }).join('&nbsp; ');
  return `<div class="sec" style="margin-top:0">
  <div class="h"><span class="lbl">任务进度</span><span class="n">${done} / ${total}</span></div>
  <div class="bar" style="margin-top:8px"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
  <div class="tk mono">${items || '<span style="color:#516a90">暂无任务</span>'}</div>
</div>`;
}

export function renderToolCounts(session) {
  const counts = (session || {}).toolCounts || {};
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const body = entries.length
    ? entries.map(([k, v]) => `${esc(k)} <b>×${Number(v) || 0}</b>`).join(' &nbsp; ')
    : '<span style="color:#516a90">暂无调用</span>';
  return `<div class="sec">
  <span class="lbl">本会话工具调用</span>
  <div class="toolc mono">${body}</div>
</div>`;
}

export function renderChanges(session) {
  const s = session || {};
  const cost = `$${(Number(s.costUsd) || 0).toFixed(2)}`;
  return `<div class="sec">
  <span class="lbl">代码改动 · 花费</span>
  <div class="kv mono"><span style="color:#3ff58f">+${Number(s.linesAdded) || 0}</span><span style="color:#ff5ca3">−${Number(s.linesRemoved) || 0}</span><span class="m">${Number(s.filesChanged) || 0} 个文件</span></div>
  <div class="kv mono"><span>${cost}</span><span class="m">${duration(s.durationMs)}</span></div>
</div>`;
}

function gauge(name, pct, resetAt, grad, accent, now) {
  const known = Number.isFinite(pct);
  return `<div class="gz">
  <div class="g1"><span class="nm">${esc(name)}</span><span class="pc" style="color:${known ? accent : '#516a90'}">${known ? pct + '%' : '—'}</span></div>
  <div class="bar"><i style="width:${barWidth(known ? pct : 0)};background:${grad}"><span class="sh"></span></i></div>
  <div class="rs mono">${known && resetAt ? '⟳ ' + countdown(resetAt, now) + ' 后重置' : '同步中…'}</div>
</div>`;
}

export function renderUsage(snapshot, now = Date.now()) {
  const u = (snapshot || {}).usage || {};
  return `<div class="lbl">Account Usage</div>
${gauge('5 小时窗口', u.fiveHour, u.fiveHourResetAt, 'linear-gradient(90deg,#27d3f5,#3ff58f)', '#27d3f5', now)}
${gauge('7 天窗口', u.sevenDay, u.sevenDayResetAt, 'linear-gradient(90deg,#ff2d8e,#ff8ac0)', '#ff5ca3', now)}
<div class="rs mono" style="margin-top:17px">SYNC 每 5min · /api/oauth/usage</div>`;
}

export function renderFooter(snapshot, session, connected) {
  const s = session || {};
  const count = Array.isArray((snapshot || {}).sessions) ? snapshot.sessions.length : 0;
  const link = connected
    ? '<span class="v cy">SSE ●</span>'
    : '<span class="v" style="color:#ff5ca3">SSE ○ 重连中</span>';
  return `<div class="rd"><span class="live"><i></i>LIVE</span></div>
<div class="rd"><span class="k">项目</span><span class="v">${esc(s.projectName || '—')}</span></div>
<div class="rd"><span class="k">会话时长</span><span class="v cy">${duration(s.durationMs)}</span></div>
<div class="rd grow"><span class="k">活动会话</span><span class="v">${count}</span></div>
<div class="rd"><span class="k">连接</span>${link}</div>`;
}

// public/render.js — 纯函数：输入快照/会话，返回 HTML 字符串片段。浏览器与 Node 测试共用。
import {
  esc, statusText, clock, toolColor, barWidth, countdown, taskProgress, duration,
  effortLabel, effortClass,
  workflowChipText, workflowClass, workflowPct, workflowPhaseText,
  modelDisplay,
} from './format.js';
import { dict } from './i18n.js';

export function focusSession(snapshot) {
  const s = snapshot || {};
  const list = Array.isArray(s.sessions) ? s.sessions : [];
  return list.find((x) => x && x.sessionId === s.focusId) || list[0] || null;
}

function chip(text, cls = '') {
  return text ? `<span class="${cls ? `chip ${cls}` : 'chip'}">${esc(text)}</span>` : '';
}

function effortChip(level, ultra) {
  const label = effortLabel(level, ultra);
  if (!label) return '';
  return `<span class="chip ${effortClass(level, ultra)}">⚡ ${esc(label)}</span>`;
}

// banner workflow chip：照 effort chip 先例，无 workflow 返回空串
function workflowChip(wf) {
  const text = workflowChipText(wf);
  return text ? `<span class="chip ${workflowClass(wf)}">${esc(text)}</span>` : '';
}

// 时间线顶部 workflow 进度块：名称 + M/N + 进度条 + phase（复用 .bar/.sh）
function workflowProgress(wf) {
  if (!wf) return '';
  const phase = workflowPhaseText(wf);
  return `<div class="wfp ${workflowClass(wf)}">`
    + `<div class="wfp-h"><span class="nm">⚙ ${esc(wf.name)}</span><span class="n">${esc(String(wf.doneAgents))} / ${esc(String(wf.totalAgents))}</span></div>`
    + `<div class="wfp-b"><div class="bar"><i style="width:${barWidth(workflowPct(wf))}"><span class="sh"></span></i></div>`
    + (phase ? `<span class="ph mono">${esc(phase)}</span>` : '')
    + `</div></div>`;
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
  const chips = [
    chip(modelDisplay(s.model)?.toUpperCase(), 'k'),
    effortChip(s.effort, s.ultra),
    workflowChip(s.workflow),
    chip(s.plan, 'm'),
    chip(s.projectName),
    s.branch ? `<span class="chip mono">⎇ ${esc(s.branch)}</span>` : '',
  ].join('');
  // 会话编号块已移至 footer（见 footerSessions / renderFooter）。
  return `<div class="hex">CC</div>
<div class="stdot"></div>
<div class="sttxt">${bannerStatus(s)}</div>
<div class="ctx">
  <div class="top"><span>CONTEXT</span><b>${pct}%</b></div>
  <div class="bar"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
</div>
<div class="chips">${chips}</div>`;
}

export function renderTimeline(session, lang) {
  const s = session || {};
  const L = dict(lang);
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
    rows.push(`<div class="ev"><span class="x" style="color:#516a90">${L.timelineEmpty}</span></div>`);
  }
  return workflowProgress(s.workflow) + rows.join('');
}

export function renderTasks(session, lang) {
  const tasks = Array.isArray((session || {}).tasks) ? session.tasks : [];
  const L = dict(lang);
  const { done, total, pct } = taskProgress(tasks);
  const items = tasks.map((t) => {
    const st = t && t.status;
    const mark = st === 'completed' ? '<span class="done">✓</span>'
      : st === 'in_progress' ? '<span class="now">▶</span>' : '<span>·</span>';
    return `${mark} ${esc(t && t.subject)}`;
  }).join('&nbsp; ');
  return `<div class="sec" style="margin-top:0">
  <div class="h"><span class="lbl">${L.tasksTitle}</span><span class="n">${done} / ${total}</span></div>
  <div class="bar" style="margin-top:8px"><i style="width:${barWidth(pct)};background:linear-gradient(90deg,#27d3f5,#3ff58f)"><span class="sh"></span></i></div>
  <div class="tk mono">${items || `<span style="color:#516a90">${L.tasksEmpty}</span>`}</div>
</div>`;
}

export function renderToolCounts(session, lang) {
  const counts = (session || {}).toolCounts || {};
  const L = dict(lang);
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const body = entries.length
    ? entries.map(([k, v]) => `${esc(k)} <b>×${Number(v) || 0}</b>`).join(' &nbsp; ')
    : `<span style="color:#516a90">${L.toolsEmpty}</span>`;
  return `<div class="sec">
  <span class="lbl">${L.toolsTitle}</span>
  <div class="toolc mono">${body}</div>
</div>`;
}

export function renderChanges(session, lang) {
  const s = session || {};
  const L = dict(lang);
  const cost = `$${(Number(s.costUsd) || 0).toFixed(2)}`;
  return `<div class="sec">
  <span class="lbl">${L.changesTitle}</span>
  <div class="kv mono"><span style="color:#3ff58f">+${Number(s.linesAdded) || 0}</span><span style="color:#ff5ca3">−${Number(s.linesRemoved) || 0}</span><span class="m">${L.files(Number(s.filesChanged) || 0)}</span></div>
  <div class="kv mono"><span>${cost}</span><span class="m">${duration(s.durationMs)}</span></div>
</div>`;
}

function gauge(name, pct, resetAt, grad, accent, now, L, tip) {
  const known = Number.isFinite(pct);
  return `<div class="gz">
  <div class="g1"><span class="nm">${esc(name)}</span><span class="pc" style="color:${known ? accent : '#516a90'}">${known ? pct + '%' : '—'}</span></div>
  <div class="bar"><i style="width:${barWidth(known ? pct : 0)};background:${grad}"><span class="sh"></span></i></div>
  <div class="rs mono">${known && resetAt ? L.reset(countdown(resetAt, now, L.cdNow)) : tip}</div>
</div>`;
}

export function renderUsage(snapshot, now = Date.now(), lang) {
  const snap = snapshot || {};
  const u = snap.usage || {};
  const L = dict(lang);
  // 拿不到额度分两种：还没轮询到（同步中）与压根没凭据（usageAuth 为 false，
  // Desktop 不写 ~/.claude/.credentials.json）。后者永远不会好转，别再假装在同步。
  const tip = snap.usageAuth === false ? L.noAuth : L.syncing;
  return `<div class="lbl">${L.usageTitle}</div>
${gauge(L.usage5h, u.fiveHour, u.fiveHourResetAt, 'linear-gradient(90deg,#27d3f5,#3ff58f)', '#27d3f5', now, L, tip)}
${gauge(L.usage7d, u.sevenDay, u.sevenDayResetAt, 'linear-gradient(90deg,#ff2d8e,#ff8ac0)', '#ff5ca3', now, L, tip)}
<div class="rs mono" style="margin-top:17px">${L.syncNote}</div>`;
}

// footer 会话标签：每个会话一个 span，编号+项目名；status 配色 + 当前会话 on 描边
function footerSessions(sessions, currentId) {
  return sessions.map((x, i) => {
    const cls = [
      x && x.status ? `s-${x.status}` : '',
      x && x.sessionId === currentId ? 'on' : '',
    ].filter(Boolean).join(' ');
    const name = x && x.projectName ? ` ${esc(x.projectName)}` : '';
    return `<span class="${cls}">${i + 1}${name}</span>`;
  }).join('');
}

export function renderFooter(snapshot, session, connected, lang) {
  const s = session || {};
  const L = dict(lang);
  const sessions = Array.isArray((snapshot || {}).sessions) ? snapshot.sessions : [];
  const count = sessions.length;
  const link = connected
    ? '<span class="v cy">SSE ●</span>'
    : `<span class="v" style="color:#ff5ca3">${L.linkReconnecting}</span>`;
  // 会话标签夹在「会话时长」与「活动会话」之间；grow 留在「活动会话」撑开两者空隙。
  return `<div class="rd"><span class="live"><i></i>LIVE</span></div>
<div class="rd"><span class="k">${L.fProject}</span><span class="v">${esc(s.projectName || '—')}</span></div>
<div class="rd"><span class="k">${L.fDuration}</span><span class="v cy">${duration(s.durationMs)}</span></div>
<div class="fsess">${footerSessions(sessions, s.sessionId)}</div>
<div class="rd grow"><span class="k">${L.fSessions}</span><span class="v">${count}</span></div>
<div class="rd"><span class="k">${L.fLink}</span>${link}</div>`;
}

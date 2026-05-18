// public/hud.js — 胶水层：订阅 SSE，把 render.js 的纯函数输出装配进 DOM。
import {
  focusSession, renderBanner, renderTimeline, renderTasks,
  renderToolCounts, renderChanges, renderUsage, renderFooter,
} from './render.js';

const $ = (id) => document.getElementById(id);
let connected = false;
let snapshot = { focusId: null, sessions: [], usage: null, ts: 0 };

function paint() {
  const session = focusSession(snapshot);
  $('banner').innerHTML = renderBanner(snapshot, session);
  $('timeline').innerHTML = renderTimeline(session);
  $('tasks').innerHTML = renderTasks(session);
  $('toolcounts').innerHTML = renderToolCounts(session);
  $('changes').innerHTML = renderChanges(session);
  $('usage').innerHTML = renderUsage(snapshot);
  $('footer').innerHTML = renderFooter(snapshot, session, connected);
  // waiting 整屏告警态 —— Task 7 扩展 #alert 内容与配色
  document.body.classList.toggle('waiting', !!session && session.status === 'waiting');
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => { connected = true; paint(); };
  es.onmessage = (e) => {
    connected = true;
    try { snapshot = JSON.parse(e.data); } catch { return; }
    paint();
  };
  es.onerror = () => {
    connected = false;
    paint();
    // EventSource 默认会自动重连；仅在连接被永久关闭时手动兜底
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 3000);
  };
}

paint();      // 数据到达前先画占位态
connect();

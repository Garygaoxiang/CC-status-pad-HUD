// public/hud.js — 胶水层：订阅 SSE，把 render.js 的纯函数输出装配进 DOM。
import {
  focusSession, renderBanner, renderTimeline, renderTasks,
  renderToolCounts, renderChanges, renderUsage, renderFooter,
} from './render.js';
import { dict, pickLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const lang = pickLang(location.search);   // URL ?lang=en 选语言，缺省 zh
let connected = false;
let snapshot = { focusId: null, sessions: [], usage: null, ts: 0 };

// 语言运行期不变：初始化设好 <html lang> 与静态时间线表头（render 层不渲染表头）
document.documentElement.lang = lang;
$('tl-header').textContent = dict(lang).timelineHeader;

function paint() {
  const session = focusSession(snapshot);
  $('banner').innerHTML = renderBanner(snapshot, session);
  $('timeline').innerHTML = renderTimeline(session, lang);
  $('tasks').innerHTML = renderTasks(session, lang);
  $('toolcounts').innerHTML = renderToolCounts(session, lang);
  $('changes').innerHTML = renderChanges(session, lang);
  $('usage').innerHTML = renderUsage(snapshot, undefined, lang);
  $('footer').innerHTML = renderFooter(snapshot, session, connected, lang);
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

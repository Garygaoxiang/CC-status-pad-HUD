import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  applyEvent, applyStatusline, createSession, pickFocus, pruneStale,
} from './state.js';
import { readToken, fetchUsage, readProxy } from './usage.js';
import { lastUsageFromTranscript, parseContextWindow } from './transcript.js';

const TRANSCRIPT_POLL_MS = 5_000;

const DEFAULT_PORT = Number(process.env.HUD_PORT) || 4317;

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

export function createCollector() {
  const sessions = new Map();
  const clients = new Set();
  let usage = null;
  let timer = null;

  const getSession = (id) => {
    if (!sessions.has(id)) sessions.set(id, createSession(id));
    return sessions.get(id);
  };
  const snapshot = () => {
    pruneStale(sessions);
    const focus = pickFocus(sessions);
    return {
      focusId: focus?.sessionId || null,
      sessions: [...sessions.values()],
      usage, ts: Date.now(),
    };
  };
  const broadcast = () => {
    const data = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) res.write(data);
  };
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(b));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/hook') {
      try {
        const ev = JSON.parse(await readBody(req));
        const id = ev.session_id || 'default';
        sessions.set(id, applyEvent(getSession(id), ev));
        broadcast();
      } catch { /* 坏 JSON 静默忽略 */ }
      return res.writeHead(204).end();
    }
    if (req.method === 'POST' && url.pathname === '/statusline') {
      try {
        const sl = JSON.parse(await readBody(req));
        const id = sl.session_id || 'default';
        sessions.set(id, applyStatusline(getSession(id), sl));
        broadcast();
      } catch { /* 同上 */ }
      return res.writeHead(204).end();
    }
    if (req.method === 'GET' && url.pathname === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'GET') {
      let rel;
      try { rel = decodeURIComponent(url.pathname); }
      catch { return res.writeHead(400).end(); }
      const filePath = normalize(join(PUBLIC_DIR, '.' + (rel === '/' ? '/index.html' : rel)));
      if (!filePath.startsWith(PUBLIC_DIR)) return res.writeHead(403).end();
      try {
        const buf = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        return res.end(buf);
      } catch {
        return res.writeHead(404).end();
      }
    }
    res.writeHead(404).end();
  });

  const pollUsage = async () => {
    const token = readToken();
    if (!token) return;
    const u = await fetchUsage(token, readProxy());
    if (u) { usage = u; broadcast(); }
  };

  // 轮询所有活跃会话的 transcript，更新 contextPct。
  // 读取整个 JSONL 文件、找最末 assistant usage —— 对几 MB 文本来说成本可接受。
  // 失败静默：transcript 缺失/路径无效都不应影响其他会话与 HUD 渲染。
  let ctxTimer = null;
  const pollTranscripts = async () => {
    let dirty = false;
    for (const sess of sessions.values()) {
      if (!sess.transcriptPath) continue;
      try {
        const text = await readFile(sess.transcriptPath, 'utf8');
        const used = lastUsageFromTranscript(text);
        if (used == null) continue;
        const win = parseContextWindow(sess.model);
        const pct = Math.max(0, Math.min(100, Math.round((used / win) * 100)));
        if (pct !== sess.contextPct) {
          sessions.set(sess.sessionId, { ...sess, contextPct: pct });
          dirty = true;
        }
      } catch { /* 文件读不到就跳过这一轮 */ }
    }
    if (dirty) broadcast();
  };

  function start(port = DEFAULT_PORT, { poll = true } = {}) {
    server.listen(port);
    if (poll) {
      pollUsage();
      timer = setInterval(pollUsage, 5 * 60 * 1000);
      timer.unref();
      ctxTimer = setInterval(pollTranscripts, TRANSCRIPT_POLL_MS);
      ctxTimer.unref();
    }
    return server;
  }
  function stop() {
    if (timer) clearInterval(timer);
    if (ctxTimer) clearInterval(ctxTimer);
    for (const res of clients) res.end();
    clients.clear();
    return new Promise((resolve) => server.close(resolve));
  }
  return { server, start, stop, snapshot };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  createCollector().start();
  console.log(`HUD 采集器已启动 :${DEFAULT_PORT}`);
}

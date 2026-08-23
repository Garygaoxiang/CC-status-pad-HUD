// 解析 Claude Code transcript JSONL，导出已用上下文 token 数；
// 以及从模型 display_name 中解析上下文窗口大小。纯函数、无 I/O。

const DEFAULT_WINDOW = 200_000;

// "Opus 4.7 (1M context)" → 1_000_000；"Sonnet (200k context)" → 200_000；
// Desktop 兼容路径的 raw model ID（"claude-opus-5"）按 model family 兜底：
// claude-opus-* → 1M（本账户 Opus 均开 1M；实测单会话 237K tokens 未触发压缩，
// 按 200K 算会算出 119% 这种虚高），其余保持 200K 默认，宁可低估不虚高。
export function parseContextWindow(displayName) {
  const s = String(displayName || '');
  const m = s.match(/(\d+)\s*([mMkK])\b/);
  if (m) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'm') return n * 1_000_000;
    if (u === 'k') return n * 1_000;
  }
  if (/^claude-opus-/i.test(s)) return 1_000_000;
  return DEFAULT_WINDOW;
}

// 从 JSONL 文本里取最末一条带 usage 的 assistant 消息，返回
// input_tokens + cache_creation_input_tokens + cache_read_input_tokens 之和。
// 不计 output_tokens（它会在下次调用作为输入被计入 input）。
// 无 usage 或全空时返回 null。
export function lastUsageFromTranscript(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }
    const u = j && j.message && j.message.usage;
    if (!u) continue;
    const used = (Number(u.input_tokens) || 0)
      + (Number(u.cache_creation_input_tokens) || 0)
      + (Number(u.cache_read_input_tokens) || 0);
    return used > 0 ? used : null;
  }
  return null;
}

// 从 JSONL 文本里取最末一条 assistant 消息的 model 字段（如 "claude-opus-4-7"）。
// Desktop 版 Claude Code 不调 statusline，无法从 sl.model.display_name 取，转而从
// transcript 兜底。原样返回 model ID，不做 display 映射——渲染层需要美化时再处理。
export function lastModelFromTranscript(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }
    const m = j && j.message && j.message.model;
    if (typeof m === 'string' && m) return m;
  }
  return null;
}

// 按 CLI transcript 目录规则从 sessionId + cwd + homeDir 反推 jsonl 路径。
// 规则实测：<homeDir>/.claude/projects/<cwd 里所有非字母数字字符替换为 '-'>/<sid>.jsonl。
// Desktop 只从 hook 拿得到 session_id + cwd 却拿不到 transcript_path，靠这个函数补齐。
// 缺参返回 null；不做 fs 存在性检查，调用方按需 readFile 容错。
export function deriveTranscriptPath(sessionId, cwd, homeDir) {
  if (!sessionId || !cwd || !homeDir) return null;
  const enc = String(cwd).replace(/[^A-Za-z0-9]/g, '-');
  return `${homeDir}/.claude/projects/${enc}/${sessionId}.jsonl`;
}

// 取 JSONL 里首条带合法 timestamp 的记录，返回毫秒时间戳；无则 null。
// 会话真实起点——采集器是内存态，重启后 startedAt 会退化成「重启时刻」，
// 用它把会话时长校回真实值（Desktop 无 statusline 时是唯一来源）。
export function firstTimestamp(text) {
  for (const ln of String(text || '').split('\n')) {
    if (!ln.trim()) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }
    const t = j && j.timestamp ? Date.parse(j.timestamp) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return null;
}

// 从 JSONL 文本里取最末一次 "/effort <mode>" 命令的回显，返回设置的 effort 模式
// （如 "ultracode" / "high"），无则 null。statusline 不区分 ultracode 与 xhigh，
// 这是唯一可靠数据源。只认 message.content 为字符串的真命令回显——content 为数组
// （tool_result 等）一律跳过，避免工具输出里偶然出现的同名文本造成误判。
export function lastEffortMode(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (!ln) continue;
    let j;
    try { j = JSON.parse(ln); } catch { continue; }
    const c = j && j.message && j.message.content;
    if (typeof c !== 'string') continue;
    const m = c.match(/^<local-command-stdout>Set effort level to (\w+)/);
    if (m) return m[1];
  }
  return null;
}

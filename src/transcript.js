// 解析 Claude Code transcript JSONL，导出已用上下文 token 数；
// 以及从模型 display_name 中解析上下文窗口大小。纯函数、无 I/O。

const DEFAULT_WINDOW = 200_000;

// "Opus 4.7 (1M context)" → 1_000_000；"Sonnet (200k context)" → 200_000；
// 无识别则回退 200K。匹配大小写不敏感的 1M / 200k / 200K 等常见写法。
export function parseContextWindow(displayName) {
  const m = String(displayName || '').match(/(\d+)\s*([mMkK])\b/);
  if (!m) return DEFAULT_WINDOW;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'm') return n * 1_000_000;
  if (u === 'k') return n * 1_000;
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

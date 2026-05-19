import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const USAGE_HOST = 'api.anthropic.com';
const USAGE_PATH = '/api/oauth/usage';

export function readToken(home = homedir()) {
  try {
    const raw = readFileSync(join(home, '.claude', '.credentials.json'), 'utf8');
    const oauth = JSON.parse(raw).claudeAiOauth || {};
    if (!oauth.accessToken) return null;
    if (oauth.expiresAt != null && oauth.expiresAt <= Date.now()) return null;
    return oauth.accessToken;
  } catch {
    return null;
  }
}

// 纯函数：环境变量优先，回退到 settings.json 的 env 块；都没有则 null。
export function pickProxy(settings = {}, env = {}) {
  const e = env || {};
  const fromEnv = e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy;
  if (fromEnv) return fromEnv;
  const se = (settings && settings.env) || {};
  return se.HTTPS_PROXY || se.HTTP_PROXY || null;
}

// 读取与 Claude Code 同源的代理：~/.claude/settings.json 的 env 块。
export function readProxy(home = homedir(), env = process.env) {
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
  } catch {
    settings = {};
  }
  return pickProxy(settings, env);
}

export function parseUsage(apiJson) {
  const pct = (v) =>
    Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : null;
  const j = apiJson || {};
  return {
    fiveHour: pct(j.five_hour?.utilization),
    sevenDay: pct(j.seven_day?.utilization),
    fiveHourResetAt: j.five_hour?.resets_at || null,
    sevenDayResetAt: j.seven_day?.resets_at || null,
  };
}

// 用 curl 而非 node:https 拉 usage：api.anthropic.com 前置的 Cloudflare 会按
// TLS 握手指纹拦截 node:https（返回 403 forbidden），curl 的握手可通过。
// 配了代理就经代理走（与 Claude Code 网络路径一致）。任何失败都返回 null，
// 静默降级——HUD 故障绝不影响 Claude Code。
export function fetchUsage(token, proxy = null) {
  return new Promise((resolve) => {
    const args = [
      '-sf', '-m', '15',
      '-H', `Authorization: Bearer ${token}`,
      '-H', 'anthropic-beta: oauth-2025-04-20',
      '-H', 'User-Agent: claude-code/2.1',
      `https://${USAGE_HOST}${USAGE_PATH}`,
    ];
    if (proxy) args.unshift('-x', proxy);
    execFile('curl', args, { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(parseUsage(JSON.parse(stdout)));
      } catch {
        resolve(null);
      }
    });
  });
}

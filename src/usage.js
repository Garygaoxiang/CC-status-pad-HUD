import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import https from 'node:https';

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

export function fetchUsage(token) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: USAGE_HOST, path: USAGE_PATH, method: 'GET', timeout: 15000,
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(parseUsage(JSON.parse(body))); } catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

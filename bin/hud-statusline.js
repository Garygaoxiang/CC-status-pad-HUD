// HUD statusline 包装器：转发 JSON 给采集器，再调用原始 claude-hud
// statusline 命令、透传其输出。stdin 只能读一次，故先整段读入再分发。
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const input = readFileSync(0, 'utf8');          // fd 0 = stdin

// 1) 转发给采集器（失败静默，不阻断状态栏）
const req = http.request(
  { host: 'localhost', port: 4317, path: '/statusline', method: 'POST', timeout: 800 },
  (res) => res.resume(),
);
req.on('error', () => {});
req.on('timeout', () => req.destroy());
req.end(input);

// 2) 调用原始 claude-hud statusline，喂同样的 JSON，透传 stdout
try {
  const orig = readFileSync(join(here, 'original-statusline.txt'), 'utf8').trim();
  if (orig) {
    const r = spawnSync(orig, { shell: true, input, encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
  }
} catch { /* 无原始命令则输出空状态栏 */ }

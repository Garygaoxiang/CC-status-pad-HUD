// 纯函数：修复 claude-hud statusline 命令里 pin 死的失效版本路径。
// claude-hud 插件升级后旧版本目录被删，命令里的 .../claude-hud/<ver>/dist/index.js
// 会失效；这里在 spawn 前把它替换成同级现存的最新版本，插件怎么升都不再空白。
// 依赖注入 exists/listVersions，保持纯函数、可离线测试。

// 匹配命令里的 claude-hud 版本目录段：g1=到父目录（含尾分隔符）、g2=版本、g3=/dist/index.js
const RE = /([^\s"']*claude-hud[\/\\]claude-hud[\/\\])([^\/\\"]+)([\/\\]dist[\/\\]index\.js)/;

// semver 数字比较：a>b 返回正数（0.10.0 > 0.2.0）
function cmpSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// deps: { exists(path)->bool, listVersions(baseDir)->string[] }
export function reviveClaudeHudPath(cmd, deps) {
  const m = String(cmd).match(RE);
  if (!m) return cmd;                        // 非 claude-hud 命令，不碰
  const [, base, ver, tail] = m;
  if (deps.exists(base + ver + tail)) return cmd;  // pin 的版本还在，无需改
  const baseDir = base.replace(/[\/\\]$/, '');
  const best = (deps.listVersions(baseDir) || [])
    .filter((v) => deps.exists(base + v + tail))    // 只认真的有 index.js 的版本
    .sort(cmpSemver)
    .pop();
  if (!best) return cmd;                     // 没有可用版本，安全降级为原样
  return cmd.replace(RE, base + best + tail);
}

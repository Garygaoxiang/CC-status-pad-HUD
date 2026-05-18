// HUD 安装/启动期纯逻辑。所有导出函数无副作用、返回新对象。
// 同时作为 CLI 被 PowerShell 脚本调用（见文件末尾 CLI 入口，Task 3 补充）。
import { pathToFileURL } from 'node:url';

// 从屏幕列表中选出 HUD 该铺的副屏。
// 策略：精确匹配目标宽高 → 回退首个非主屏 → null。
export function pickScreen(screens, target = {}) {
  const list = Array.isArray(screens) ? screens : [];
  const hit = list.find(
    (s) => !s.primary && s.width === target.width && s.height === target.height,
  );
  if (hit) return { ...hit, exact: true };
  const fallback = list.find((s) => !s.primary);
  return fallback ? { ...fallback, exact: false } : null;
}

// HUD hook 需要注入的 6 个事件名。
const HUD_EVENTS = [
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Notification', 'Stop', 'SessionEnd',
];

// 深拷贝工具（仅用于纯 JSON 可序列化对象）。
const clone = (o) => structuredClone(o || {});

// 判断某 hook group 是否由 HUD 注入（命令含 hud-hook.cmd，路径大小写不敏感）。
const isHudGroup = (g) => (g?.hooks || []).some((h) => /hud-hook\.cmd/i.test(h?.command || ''));

// 安装：6 个事件各追加一条 HUD hook（先去重保证幂等），statusLine 换成 HUD 包装器。
// 返回 { nextSettings, savedStatusline }。
// savedStatusline：当前 statusLine 不是 HUD 时保存原始命令；已是 HUD 时返回 null。
export function mergeSettings(settings, { hookCmd, statuslineCmd }) {
  const next = clone(settings);
  next.hooks = next.hooks || {};
  for (const ev of HUD_EVENTS) {
    // 先过滤掉已有的 HUD group（去重），再追加新的，保证幂等。
    const groups = (next.hooks[ev] || []).filter((g) => !isHudGroup(g));
    groups.push({ hooks: [{ type: 'command', command: hookCmd }] });
    next.hooks[ev] = groups;
  }
  // 若当前 statusLine 已是 HUD 包装器，则 savedStatusline 为 null（不污染已存储的原始命令）。
  const curr = settings?.statusLine?.command || '';
  const savedStatusline = /hud-statusline/i.test(curr) ? null : curr || null;
  next.statusLine = { type: 'command', command: statuslineCmd };
  return { nextSettings: next, savedStatusline };
}

// 卸载：移除所有 HUD hook（空事件键一并删除），statusLine 还原为 savedStatusline。
// 不修改入参，返回新对象。
export function restoreSettings(settings, { savedStatusline }) {
  const next = clone(settings);
  for (const ev of HUD_EVENTS) {
    if (!next.hooks?.[ev]) continue;
    const groups = next.hooks[ev].filter((g) => !isHudGroup(g));
    if (groups.length) next.hooks[ev] = groups;
    else delete next.hooks[ev];
  }
  // savedStatusline 有值则还原；为空说明用户原本无 statusLine，卸载后也应移除。
  if (savedStatusline) next.statusLine = { type: 'command', command: savedStatusline };
  else delete next.statusLine;
  return next;
}

// CLI 入口：被 start-hud.ps1 调用。`pick-screen --target WxH`
// 从 stdin 读屏幕列表 JSON，把选中的副屏写 stdout（无匹配则空输出、退出码 0）。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
    && process.argv[2] === 'pick-screen') {
  const ti = process.argv.indexOf('--target');
  const [w, h] = (ti >= 0 ? process.argv[ti + 1] : '1920x480').split('x').map(Number);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    let screens = [];
    // 解析失败时 screens 保持 []，pickScreen 返回 null，CLI 空输出降级到主屏。
    try { const j = JSON.parse(raw.replace(/^﻿/, '')); screens = Array.isArray(j) ? j : [j]; } catch {}
    const r = pickScreen(screens, { width: w, height: h });
    if (r) process.stdout.write(JSON.stringify(r));
  });
}

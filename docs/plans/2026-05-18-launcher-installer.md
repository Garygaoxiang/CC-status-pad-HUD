# 启动器 + 安装器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现启动器与安装器，让 HUD 一键安装（配置 hook/statusline、注册开机自启）、一键启动（拉起采集器服务 + 浏览器 kiosk 铺到副屏），并可一键卸载还原。任何环节失败都**绝不能影响 Claude Code 本身的运行**。

**Architecture:** PowerShell 脚本（`.ps1`）为面向用户的入口；把易出错的纯逻辑——副屏选择、`settings.json` 合并/还原——抽成 Node 纯函数模块 `tools/install-lib.js`，用 `node:test` 单元测试覆盖。开机自启采用**启动文件夹**（`shell:startup` 放一个隐藏窗口启动脚本），无需管理员权限、用户可见可删。

**Tech Stack:** PowerShell 5.1（Windows 内置）、Node.js（仅内置模块）、`node:test` + `node:assert`、ESM。无 npm 依赖。

---

## 环境事实（2026-05-18 实测）

- 浏览器：Chrome `C:\Program Files\Google\Chrome\Application\chrome.exe`、Edge
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` 均已装。
- Node `v22.17.1`。
- 显示器：主屏 `DISPLAY1` 3440×1440；第二屏 `DISPLAY2` 1280×800（X=3440）。
  **当前未接 1920×480 副屏** —— 故 `pickScreen` 须设计为「优先精确匹配目标规格、
  匹配不到回退任意非主屏并提示」，Task 3 的 kiosk 实测需 TURZX 副屏实际接入。
- 用户 `~/.claude/settings.json` 现有 hooks：`SessionStart`/`PostToolUse`/`PreToolUse`
  各一条 gsd 脚本；`statusLine.command` 指向 claude-hud（bun 命令）。安装器**追加**
  HUD hook、**不得覆盖**已有 gsd hook。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `tools/install-lib.js` | 纯函数 + CLI：副屏选择 `pickScreen`、settings 合并 `mergeSettings` / 还原 `restoreSettings` |
| `tests/install-lib.test.js` | `install-lib.js` 单元测试 |
| `scripts/hud-config.json` | 配置：端口、目标副屏规格、浏览器偏好 |
| `scripts/start-hud.ps1` | 启动器：检查/拉起采集器、检测副屏、浏览器 kiosk 定位 |
| `scripts/install.ps1` | 安装器：备份并写入 hook/statusline、注册启动文件夹自启 |
| `scripts/uninstall.ps1` | 卸载器：还原 `settings.json`、移除自启项 |

---

## Task 1: 副屏选择算法 + 配置文件

`pickScreen` 是纯函数：给定屏幕列表与目标规格，选出 HUD 该铺的副屏。
策略：① 精确匹配目标宽高 → ② 回退第一个非主屏 → ③ 都没有返回 `null`。

**Files:**
- Create: `tools/install-lib.js`
- Create: `tests/install-lib.test.js`
- Create: `scripts/hud-config.json`

- [ ] **Step 1: 写失败测试 `tests/install-lib.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickScreen } from '../tools/install-lib.js';

const S = (x, y, w, h, primary = false) => ({ x, y, width: w, height: h, primary });

test('pickScreen 精确匹配目标分辨率优先', () => {
  const screens = [S(0, 0, 3440, 1440, true), S(3440, 0, 1920, 480)];
  const r = pickScreen(screens, { width: 1920, height: 480 });
  assert.equal(r.x, 3440);
  assert.equal(r.exact, true);
});

test('pickScreen 无精确匹配时回退第一个非主屏', () => {
  const screens = [S(0, 0, 3440, 1440, true), S(3440, 0, 1280, 800)];
  const r = pickScreen(screens, { width: 1920, height: 480 });
  assert.equal(r.x, 3440);
  assert.equal(r.width, 1280);
  assert.equal(r.exact, false);
});

test('pickScreen 只有主屏时返回 null', () => {
  const screens = [S(0, 0, 3440, 1440, true)];
  assert.equal(pickScreen(screens, { width: 1920, height: 480 }), null);
});

test('pickScreen 空列表返回 null', () => {
  assert.equal(pickScreen([], { width: 1920, height: 480 }), null);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../tools/install-lib.js'`。

- [ ] **Step 3: 创建 `scripts/hud-config.json`**

```json
{
  "port": 4317,
  "targetScreen": { "width": 1920, "height": 480 },
  "browser": "auto"
}
```

- [ ] **Step 4: 创建 `tools/install-lib.js`（先实现 pickScreen）**

```js
// HUD 安装/启动期纯逻辑。所有导出函数无副作用、返回新对象。
// 同时作为 CLI 被 PowerShell 脚本调用（见文件末尾 CLI 入口，Task 3 补充）。

// 从屏幕列表中选出 HUD 该铺的副屏。
// 策略：精确匹配目标宽高 → 回退首个非主屏 → null。
export function pickScreen(screens, target = {}) {
  const list = Array.isArray(screens) ? screens : [];
  const exact = list.find(
    (s) => !s.primary && s.width === target.width && s.height === target.height,
  );
  if (exact) return { ...exact, exact: true };
  const fallback = list.find((s) => !s.primary);
  return fallback ? { ...fallback, exact: false } : null;
}
```

- [ ] **Step 5: 运行，确认通过**

Run: `npm test`
Expected: PASS，install-lib.test.js 4 个用例通过。

- [ ] **Step 6: 提交**

```bash
git add tools/install-lib.js tests/install-lib.test.js scripts/hud-config.json
git commit -m "feat: 副屏选择算法与 HUD 配置文件"
```

## Task 2: settings.json 合并 / 还原逻辑

往 `tools/install-lib.js` 追加 `mergeSettings`（安装时写入 HUD hook + statusline）与
`restoreSettings`（卸载时还原）。两者均为纯函数、返回新对象、不改入参。
**关键约束**：HUD hook 追加到现有 hooks 数组，不得覆盖用户已有的 gsd hook；
重复合并须幂等（用 `hud-hook.cmd` 标识去重）。

**Files:**
- Modify: `tools/install-lib.js`（追加导出）
- Modify: `tests/install-lib.test.js`（追加用例）

- [ ] **Step 1: 追加失败测试**

`tests/install-lib.test.js` 末尾追加：

```js
import { mergeSettings, restoreSettings } from '../tools/install-lib.js';

const HOOK = 'H:\\turzx\\turzx-coding-hud\\bin\\hud-hook.cmd';
const SL = 'H:\\turzx\\turzx-coding-hud\\bin\\hud-statusline.cmd';
const EVENTS = ['UserPromptSubmit','PreToolUse','PostToolUse','Notification','Stop','SessionEnd'];
const hasHud = (groups) => (groups || []).some((g) => g.hooks.some((h) => h.command === HOOK));

test('mergeSettings 给 6 个事件各加 HUD hook，保留已有 gsd hook', () => {
  const base = {
    hooks: { PreToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node gsd.js' }] }] },
    statusLine: { type: 'command', command: 'bun claude-hud' },
  };
  const { nextSettings, savedStatusline } = mergeSettings(base, { hookCmd: HOOK, statuslineCmd: SL });
  for (const ev of EVENTS) assert.ok(hasHud(nextSettings.hooks[ev]), `${ev} 应有 HUD hook`);
  assert.ok(nextSettings.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'node gsd.js')));
  assert.equal(savedStatusline, 'bun claude-hud');
  assert.equal(nextSettings.statusLine.command, SL);
});

test('mergeSettings 幂等：重复合并不重复加 hook', () => {
  let s = { hooks: {}, statusLine: { command: 'orig' } };
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  assert.equal(s.hooks.Stop.filter((g) => g.hooks.some((h) => h.command === HOOK)).length, 1);
});

test('mergeSettings 二次合并时 savedStatusline 不被 HUD 命令污染', () => {
  let r = mergeSettings({ hooks: {}, statusLine: { command: 'orig' } }, { hookCmd: HOOK, statuslineCmd: SL });
  assert.equal(r.savedStatusline, 'orig');
  r = mergeSettings(r.nextSettings, { hookCmd: HOOK, statuslineCmd: SL });
  assert.equal(r.savedStatusline, null);   // 已是 HUD statusline → 不覆盖已存的原始命令
});

test('restoreSettings 移除 HUD hook 并还原 statusLine，不改入参', () => {
  let s = { hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node gsd.js' }] }] },
    statusLine: { command: 'orig' } };
  s = mergeSettings(s, { hookCmd: HOOK, statuslineCmd: SL }).nextSettings;
  const before = JSON.stringify(s);
  const restored = restoreSettings(s, { hookCmd: HOOK, savedStatusline: 'orig' });
  for (const ev of Object.keys(restored.hooks)) assert.ok(!hasHud(restored.hooks[ev]));
  assert.ok(restored.hooks.PreToolUse.some((g) => g.hooks.some((h) => h.command === 'node gsd.js')));
  assert.equal(restored.statusLine.command, 'orig');
  assert.equal(JSON.stringify(s), before);   // 入参未被修改
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npm test`
Expected: FAIL，`mergeSettings` / `restoreSettings` 未导出。

- [ ] **Step 3: 在 `tools/install-lib.js` 追加实现**

```js
// HUD hook 注入的 6 个事件。
const HUD_EVENTS = [
  'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'Notification', 'Stop', 'SessionEnd',
];

const clone = (o) => structuredClone(o || {});
// 判断某 hook group 是否由 HUD 注入（命令含 hud-hook.cmd，路径大小写不敏感）。
const isHudGroup = (g) => (g?.hooks || []).some((h) => /hud-hook\.cmd/i.test(h?.command || ''));

// 安装：6 个事件各追加一条 HUD hook（先按标识去重保证幂等），statusLine 换成 HUD 包装器。
// 返回 { nextSettings, savedStatusline }；savedStatusline 为原始命令，已是 HUD 时为 null。
export function mergeSettings(settings, { hookCmd, statuslineCmd }) {
  const next = clone(settings);
  next.hooks = next.hooks || {};
  for (const ev of HUD_EVENTS) {
    const groups = (next.hooks[ev] || []).filter((g) => !isHudGroup(g));
    groups.push({ hooks: [{ type: 'command', command: hookCmd }] });
    next.hooks[ev] = groups;
  }
  const curr = settings?.statusLine?.command || '';
  const savedStatusline = /hud-statusline/i.test(curr) ? null : curr || null;
  next.statusLine = { type: 'command', command: statuslineCmd };
  return { nextSettings: next, savedStatusline };
}

// 卸载：移除所有 HUD hook（空事件键一并删除），statusLine 还原为 savedStatusline。
export function restoreSettings(settings, { savedStatusline }) {
  const next = clone(settings);
  for (const ev of HUD_EVENTS) {
    if (!next.hooks?.[ev]) continue;
    const groups = next.hooks[ev].filter((g) => !isHudGroup(g));
    if (groups.length) next.hooks[ev] = groups;
    else delete next.hooks[ev];
  }
  if (savedStatusline) next.statusLine = { type: 'command', command: savedStatusline };
  return next;
}
```

- [ ] **Step 4: 运行，确认全部通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tools/install-lib.js tests/install-lib.test.js
git commit -m "feat: settings.json 合并与还原纯函数"
```

## Task 3: 启动器 `start-hud.ps1`

启动器三步：① 采集器没在跑就后台隐藏窗口拉起、轮询等就绪；② 用
`Screen.AllScreens` 取屏幕列表，交给 `install-lib.js` 的 CLI 选副屏；
③ 用 Chrome（回退 Edge）`--app --kiosk` 定位到副屏。检测不到副屏时降级在
主屏开窗、给提示、不崩溃。`.ps1` 无单元测试，靠语法自检 + 手动验证。

**Files:**
- Modify: `tools/install-lib.js`（追加 CLI 入口）
- Create: `scripts/start-hud.ps1`

- [ ] **Step 1: 给 `tools/install-lib.js` 追加 CLI 入口**

文件**顶部**加 `import { pathToFileURL } from 'node:url';`，**末尾**追加：

```js
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
    try { const j = JSON.parse(raw); screens = Array.isArray(j) ? j : [j]; } catch {}
    const r = pickScreen(screens, { width: w, height: h });
    if (r) process.stdout.write(JSON.stringify(r));
  });
}
```

- [ ] **Step 2: 验证 CLI 入口**

```bash
echo [{"x":3440,"y":0,"width":1280,"height":800,"primary":false}] | node tools/install-lib.js pick-screen --target 1920x480
```
Expected: 输出含 `"exact":false` 的 JSON（回退非主屏）。

- [ ] **Step 3: 创建 `scripts/start-hud.ps1`**

```powershell
# HUD 启动器：拉起采集器服务，把 HUD 网页 kiosk 铺到副屏。
# 失败即降级，绝不影响 Claude Code —— 本脚本与 Claude Code 完全解耦。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $PSScriptRoot 'hud-config.json') -Raw | ConvertFrom-Json
$port = $config.port

# 1) 采集器：没监听就后台隐藏窗口拉起，轮询最多 5s 等就绪。
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'node' -ArgumentList "`"$root\src\server.js`"" `
    -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
  }
}

# 2) 副屏检测：Screen.AllScreens → JSON → install-lib.js pick-screen。
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width
     height = $_.Bounds.Height; primary = $_.Primary } })
$target = "$($config.targetScreen.width)x$($config.targetScreen.height)"
$pick = ($screens | ConvertTo-Json -Compress) |
  & node "$root\tools\install-lib.js" pick-screen --target $target
$screen = if ($pick) { $pick | ConvertFrom-Json } else { $null }

# 3) 浏览器 kiosk：优先 Chrome，回退 Edge；检测不到副屏则主屏开窗。
$url = "http://localhost:$port"
if ($screen) {
  $a = "--app=$url --kiosk --window-position=$($screen.x),$($screen.y)" +
       " --window-size=$($screen.width),$($screen.height)"
  Write-Host "HUD -> 副屏 @$($screen.x),$($screen.y) $($screen.width)x$($screen.height) exact=$($screen.exact)"
} else {
  $a = "--app=$url"
  Write-Host "未检测到副屏，HUD 在主屏窗口打开；接好 TURZX 副屏后重跑本脚本。"
}
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$browser = if ($config.browser -eq 'edge' -and (Test-Path $edge)) { $edge }
           elseif ($chrome) { $chrome }
           elseif (Test-Path $edge) { $edge } else { $null }
if ($browser) { Start-Process -FilePath $browser -ArgumentList $a }
else { Write-Host "未找到 Chrome/Edge，无法打开 HUD 窗口。" }
```

- [ ] **Step 4: 语法自检**

```bash
powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content scripts/start-hud.ps1 -Raw))"
```
Expected: 无输出、退出码 0（解析通过即无语法错）。

- [ ] **Step 5: 手动验证启动链路**

`powershell -ExecutionPolicy Bypass -File scripts/start-hud.ps1`
Expected:（a）采集器在 :4317 起来（`curl http://localhost:4317/state` 有响应）；
（b）Chrome 以 app 窗口打开 HUD；（c）副屏接入时定位到副屏并 `exact` 正确，
未接时主屏开窗并打印提示。再跑一次确认**不重复拉起**采集器。

- [ ] **Step 6: 提交**

```bash
git add tools/install-lib.js scripts/start-hud.ps1
git commit -m "feat: HUD 启动器 — 采集器拉起与副屏 kiosk 定位"
```

## Task 4: 安装器 `install.ps1`

安装器：整份备份 `settings.json` → 调 `install-lib` 合并 hook/statusline →
保存原始 statusline 命令 → 写回 → 在启动文件夹注册自启。
**关键：写 `settings.json` 必须用无 BOM 的 UTF-8** —— Node 的 `JSON.parse`
不接受 BOM，带 BOM 会让 Claude Code 读配置失败。

**Files:**
- Modify: `tools/install-lib.js`（CLI 入口扩展为 dispatch）
- Create: `scripts/install.ps1`

- [ ] **Step 1: 把 `install-lib.js` 的 CLI 入口替换为 dispatch 版**

用下面这段替换 Task 3 写入的 `pick-screen` 单命令 CLI 入口块：

```js
// CLI 入口：被 start-hud / install / uninstall 脚本调用。
// 统一约定：stdin 收 JSON、stdout 出 JSON。子命令：
//   pick-screen --target WxH                  选副屏
//   merge-settings --hook P --statusline P    安装期合并
//   restore-settings   (原始 statusline 命令经环境变量 HUD_SAVED_SL 传入)
const cmd = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && cmd) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    if (cmd === 'pick-screen') {
      const [w, h] = arg('--target', '1920x480').split('x').map(Number);
      let scr = [];
      try { const j = JSON.parse(raw); scr = Array.isArray(j) ? j : [j]; } catch {}
      const r = pickScreen(scr, { width: w, height: h });
      if (r) process.stdout.write(JSON.stringify(r));
    } else if (cmd === 'merge-settings') {
      const out = mergeSettings(JSON.parse(raw || '{}'),
        { hookCmd: arg('--hook'), statuslineCmd: arg('--statusline') });
      process.stdout.write(JSON.stringify(out));
    } else if (cmd === 'restore-settings') {
      // 原始命令含空格/引号，走环境变量规避 PS 5.1 原生调用的引号转义坑。
      const out = restoreSettings(JSON.parse(raw || '{}'),
        { savedStatusline: process.env.HUD_SAVED_SL || '' });
      process.stdout.write(JSON.stringify(out));
    }
  });
}
```

- [ ] **Step 2: 验证 dispatch CLI**

```bash
echo {"hooks":{},"statusLine":{"command":"orig"}} | node tools/install-lib.js merge-settings --hook X --statusline Y
```
Expected: 输出 `{"nextSettings":...,"savedStatusline":"orig"}`，`nextSettings.hooks`
含 6 个事件。再确认 `pick-screen`（Task 3 Step 2）仍正常。

- [ ] **Step 3: 创建 `scripts/install.ps1`**

```powershell
# HUD 安装器：备份 settings.json，写入 hook/statusline 配置，注册开机自启。
# 可重复运行（幂等）；写配置一律用无 BOM UTF-8，避免 Claude Code 读取失败。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$hookCmd = Join-Path $root 'bin\hud-hook.cmd'
$slCmd = Join-Path $root 'bin\hud-statusline.cmd'
$utf8 = New-Object System.Text.UTF8Encoding($false)   # $false = 无 BOM

# 1) 读取并整份备份 settings.json。
$raw = Get-Content $settingsPath -Raw
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
[System.IO.File]::WriteAllText((Join-Path $claudeDir "settings.backup-$stamp.json"), $raw, $utf8)

# 2) 调 install-lib 合并 hook/statusline。
$result = ($raw | & node "$root\tools\install-lib.js" merge-settings `
  --hook $hookCmd --statusline $slCmd) | ConvertFrom-Json

# 3) 保存原始 statusline 命令（savedStatusline 为空表示已安装过，不覆盖）。
if ($result.savedStatusline) {
  [System.IO.File]::WriteAllText((Join-Path $root 'bin\original-statusline.txt'),
    $result.savedStatusline, $utf8)
}

# 4) 写回 settings.json（无 BOM；Depth 12 保留 hooks 嵌套）。
$json = $result.nextSettings | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8)

# 5) 注册开机自启：启动文件夹放一个隐藏窗口启动器 .cmd。
$autostart = Join-Path ([Environment]::GetFolderPath('Startup')) 'turzx-hud.cmd'
$line = "@echo off`r`npowershell -NoProfile -WindowStyle Hidden " +
        "-ExecutionPolicy Bypass -File `"$root\scripts\start-hud.ps1`""
[System.IO.File]::WriteAllText($autostart, $line, $utf8)

Write-Host "HUD 已安装。  备份: settings.backup-$stamp.json   自启: $autostart"
Write-Host "重启 Claude Code 使 hook/statusline 生效；或运行 scripts\start-hud.ps1 立即启动 HUD。"
```

- [ ] **Step 4: 语法自检**

```bash
powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content scripts/install.ps1 -Raw))"
```
Expected: 无输出、退出码 0。

- [ ] **Step 5: 手动验证安装（会真实改写 `~/.claude/settings.json`）**

`powershell -ExecutionPolicy Bypass -File scripts/install.ps1`
Expected：（a）`~/.claude/` 下生成 `settings.backup-<时间戳>.json`；
（b）`settings.json` 的 6 个事件各含一条 `hud-hook.cmd`、原有 gsd hook 仍在、
`statusLine.command` 指向 `hud-statusline.cmd`、文件无 BOM；
（c）`bin/original-statusline.txt` 是 claude-hud 的 bun 命令；
（d）启动文件夹有 `turzx-hud.cmd`；（e）**重启 Claude Code，确认终端
statusline 仍正常显示**（claude-hud 输出被透传）。

- [ ] **Step 6: 提交**

```bash
git add tools/install-lib.js scripts/install.ps1
git commit -m "feat: HUD 安装器 — settings 备份合并与开机自启"
```

## Task 5: 卸载器 `uninstall.ps1`

卸载器把 `settings.json` 还原到安装前：移除 6 条 HUD hook、恢复
`statusLine`，并删掉开机自启项。HUD 未运行时执行同样安全。

**Files:**
- Create: `scripts/uninstall.ps1`

- [ ] **Step 1: 创建 `scripts/uninstall.ps1`**

```powershell
# HUD 卸载器：还原 settings.json，移除开机自启。HUD 未运行时执行同样安全。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# 1) 读安装时保存的原始 statusline 命令。
$origPath = Join-Path $root 'bin\original-statusline.txt'
$saved = if (Test-Path $origPath) { (Get-Content $origPath -Raw).Trim() } else { '' }

# 2) 调 install-lib 还原：移除 HUD hook、恢复 statusLine（原命令经环境变量传入）。
$env:HUD_SAVED_SL = $saved
$raw = Get-Content $settingsPath -Raw
$restored = $raw | & node "$root\tools\install-lib.js" restore-settings
$json = $restored | ConvertFrom-Json | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($settingsPath, $json, $utf8)

# 3) 移除开机自启项。
$autostart = Join-Path ([Environment]::GetFolderPath('Startup')) 'turzx-hud.cmd'
if (Test-Path $autostart) { Remove-Item $autostart -Force }

Write-Host "HUD 已卸载：hook/statusline 已还原，开机自启已移除。"
Write-Host "重启 Claude Code 生效。:4317 上的采集器进程如仍在运行可手动结束。"
```

- [ ] **Step 2: 语法自检**

```bash
powershell -NoProfile -Command "[void][scriptblock]::Create((Get-Content scripts/uninstall.ps1 -Raw))"
```
Expected: 无输出、退出码 0。

- [ ] **Step 3: 手动验证卸载（紧接 Task 4 的已安装态执行）**

`powershell -ExecutionPolicy Bypass -File scripts/uninstall.ps1`
Expected：（a）`settings.json` 6 个事件的 HUD hook 全部移除、原有 gsd hook
仍在、`statusLine.command` 还原为 claude-hud 的 bun 命令；（b）启动文件夹的
`turzx-hud.cmd` 已删除；（c）重启 Claude Code，statusline 与 hook 行为
与装 HUD 前一致。

- [ ] **Step 4: 提交**

```bash
git add scripts/uninstall.ps1
git commit -m "feat: HUD 卸载器 — settings 还原与自启移除"
```

## Task 6: 端到端验证与文档

跑通全链路并把安装/启动/卸载落进文档。

**Files:**
- Modify: `CLAUDE.md`、`docs/spec.md`

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: PASS，含 `install-lib.test.js` 全部用例，无回归。

- [ ] **Step 2: 端到端走查**

依次执行：`install.ps1` → `start-hud.ps1` → `node tools/replay.js 300` →
`uninstall.ps1`。确认：采集器被拉起、浏览器开 HUD 窗口、回放时 HUD 实时刷新、
卸载后 `settings.json` 干净还原。

- [ ] **Step 3: 容错验证（架构第一原则）**

确保采集器**没有**运行，正常使用 Claude Code 跑一个含工具调用的小任务。
Expected: hook 转发静默失败，Claude Code 无报错、无卡顿、statusline 正常。

- [ ] **Step 4: 更新 `CLAUDE.md`**

在「常用命令」补充安装/启动/卸载三条 `powershell -File scripts\*.ps1`；
在架构说明里加入 `scripts/` 目录职责（启动器/安装器/卸载器）。

- [ ] **Step 5: 更新 `docs/spec.md`**

§4.6/4.7 标注「已实现」；§9 风险 1/2 标注实测结论（kiosk 定位、
`Screen.AllScreens`）；注明开机自启采用启动文件夹方案。

- [ ] **Step 6: 提交**

```bash
git add CLAUDE.md docs/spec.md
git commit -m "docs: 启动器/安装器文档与 spec 实现状态更新"
```

---

## 范围与自检

**本计划覆盖的 spec 组件**：启动器（§4.6，Task 3）、安装器（§4.7，Task 4）、
卸载能力（§4.7，Task 5）、副屏检测（Task 1 + Task 3）、开机自启（Task 4，
启动文件夹方案）。

**spec §9 待研究项的处理**：
- 风险 1（Chrome/Edge kiosk 多屏定位）→ Task 3 Step 5 实测，需副屏接入。
- 风险 2（`Screen.AllScreens` 坐标）→ 本会话已实测可用（取到双屏坐标）。
- 风险 3/4（hooks/statusline 的 Windows 调用）→ 计划 1 已落地，本计划复用。

**关键约束守护**：启动器/安装器/卸载器均独立进程，与 Claude Code 解耦；
hook 转发器（计划 1）的 `-m 1` + `exit 0` 保证采集器缺席时静默失败。
Task 6 Step 3 专门验证这条第一原则。

**有意推迟**：无。本计划是 spec 三个实施计划的收尾，完成后 HUD 系统功能完整。

**测试策略**：纯逻辑（`pickScreen` / `mergeSettings` / `restoreSettings`）由
`tests/install-lib.test.js` 用 `node:test` 覆盖；`.ps1` 脚本无单元测试，
靠 `[scriptblock]::Create` 语法自检 + 手动验证。


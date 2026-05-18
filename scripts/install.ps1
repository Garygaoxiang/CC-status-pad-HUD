# HUD 安装器：备份 settings.json，写入 hook/statusline 配置，注册开机自启。
# 可重复运行（幂等）；写配置一律用无 BOM UTF-8，避免 Claude Code 读取失败。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$claudeDir = Join-Path $env:USERPROFILE '.claude'
$settingsPath = Join-Path $claudeDir 'settings.json'
$hookCmd = Join-Path $root 'bin\hud-hook.cmd'
$slCmd = Join-Path $root 'bin\hud-statusline.cmd'
$utf8 = New-Object System.Text.UTF8Encoding($false)   # $false = 无 BOM

# 1) 读取并整份备份 settings.json（文件不存在时按空配置处理、不备份）。
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
if (Test-Path $settingsPath) {
  $raw = Get-Content $settingsPath -Raw
  [System.IO.File]::WriteAllText((Join-Path $claudeDir "settings.backup-$stamp.json"), $raw, $utf8)
} else {
  $raw = '{}'
}

# 2) 调 install-lib 合并 hook/statusline。
$result = ($raw | & node "$root\tools\install-lib.js" merge-settings `
  --hook $hookCmd --statusline $slCmd) | ConvertFrom-Json
if (-not $result -or -not $result.nextSettings) {
  throw "merge-settings 返回无效数据，安装中止（settings.json 未修改）"
}

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

# HUD 卸载器：还原 settings.json，移除开机自启。HUD 未运行时执行同样安全。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# 1) 读安装时保存的原始 statusline 命令。
$origPath = Join-Path $root 'bin\original-statusline.txt'
$saved = if (Test-Path $origPath) { (Get-Content $origPath -Raw).Trim() } else { '' }

# 2) 调 install-lib 还原：移除 HUD hook、恢复 statusLine（原命令经环境变量传入）。
#    settings.json 不存在说明从未安装过，跳过还原直接进下一步。
if (Test-Path $settingsPath) {
  $env:HUD_SAVED_SL = $saved
  $raw = Get-Content $settingsPath -Raw
  $restored = $raw | & node "$root\tools\install-lib.js" restore-settings
  if (-not $? -or -not $restored) {
    throw "restore-settings 调用失败或无输出，已中止写入以保护 settings.json。"
  }
  $parsed = $restored | ConvertFrom-Json
  if (-not $parsed) { throw "restore-settings 返回无效 JSON，已中止写入。" }
  $json = $parsed | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($settingsPath, $json, $utf8)
} else {
  Write-Host "未找到 settings.json，跳过配置还原。"
}

# 3) 移除开机自启项。
$autostart = Join-Path ([Environment]::GetFolderPath('Startup')) 'turzx-hud.cmd'
if (Test-Path $autostart) { Remove-Item $autostart -Force }

Write-Host "HUD 已卸载：hook/statusline 已还原，开机自启已移除。"
Write-Host "重启 Claude Code 生效。:4317 上的采集器进程如仍在运行可手动结束。"

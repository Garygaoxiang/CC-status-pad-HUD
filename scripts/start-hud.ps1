# HUD 启动器：拉起采集器服务，把 HUD 网页 kiosk 铺到副屏。
# 失败即降级，绝不影响 Claude Code -- 本脚本与 Claude Code 完全解耦。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $PSScriptRoot 'hud-config.json') -Raw | ConvertFrom-Json
if (-not $config) { Write-Host "缺少配置文件：$PSScriptRoot\hud-config.json，请先运行安装脚本。"; return }
$port = $config.port

# 1) 看门狗：拉起单实例看门狗，由它启动并持续保活采集器（缺席自动重启、带日志回溯）。
#    看门狗自带全局 Mutex 单实例，重复拉起无害（多余实例会自行退出）。
$wd = Join-Path $PSScriptRoot 'hud-watchdog.ps1'
Start-Process powershell -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$wd`"" -WindowStyle Hidden

# 2) 等采集器就绪：轮询最多 ~8s。就绪才往下开 kiosk，避免「server 不在却开窗 -> 无限重连」。
$ready = $false
for ($i = 0; $i -lt 32; $i++) {
  Start-Sleep -Milliseconds 250
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ready = $true; break }
}
$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
if (-not $ready) {
  Add-Content (Join-Path $logDir 'start-hud.log') "$ts  采集器 8s 内未就绪，跳过开 kiosk；看门狗会持续重试，就绪后请重跑本脚本或等下次开机。" -Encoding UTF8
  Write-Host "采集器未就绪，已跳过打开 HUD 窗口；看门狗会持续重试拉起采集器。"
  return
}
Add-Content (Join-Path $logDir 'start-hud.log') "$ts  采集器就绪，打开 HUD kiosk。" -Encoding UTF8

# 3) 副屏检测：Screen.AllScreens -> JSON -> install-lib.js pick-screen
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height; primary = $_.Primary } })
$target = "$($config.targetScreen.width)x$($config.targetScreen.height)"
$screensJson = $screens | ConvertTo-Json -Compress
$pick = $screensJson | & node "$root\tools\install-lib.js" pick-screen --target $target
$screen = if ($pick) { $pick | ConvertFrom-Json } else { $null }

# 4) 浏览器 kiosk：优先 Chrome，回退 Edge；检测不到副屏则主屏开窗。
# HUD 页面语言：config.lang 为 en 时给 URL 加 ?lang=en；zh/缺省/读不到不加参数（页面默认 zh）。
$url = "http://localhost:$port"
if ($config.lang -eq 'en') { $url = "$url/?lang=en" }
if ($screen) {
  $a = "--app=$url --kiosk --window-position=$($screen.x),$($screen.y) --window-size=$($screen.width),$($screen.height)"
  Write-Host "HUD -> 副屏 @$($screen.x),$($screen.y) $($screen.width)x$($screen.height) exact=$($screen.exact)"
} else {
  $a = "--app=$url"
  Write-Host "未检测到副屏，HUD 在主屏窗口打开；接好 TURZX 副屏后重跑本脚本。"
}
# HUD 专用浏览器 profile：与日常浏览器隔离，避免继承用户对本站点的页面缩放（曾导致 67% 缩放未铺满副屏）。
$hudProfile = Join-Path $env:LOCALAPPDATA 'turzx-coding-hud\chrome-profile'
$a = "$a --user-data-dir=`"$hudProfile`" --no-first-run --no-default-browser-check"
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
# 选浏览器：config 指定 edge 且 Edge 在 -> Edge；否则 Chrome；再否则 Edge；都没有 -> $null。
if ($config.browser -eq 'edge' -and (Test-Path $edge)) {
  $browser = $edge
} elseif ($chrome) {
  $browser = $chrome
} elseif (Test-Path $edge) {
  $browser = $edge
} else {
  $browser = $null
}
if ($browser) { Start-Process -FilePath $browser -ArgumentList $a }
else { Write-Host "未找到 Chrome/Edge，无法打开 HUD 窗口。" }

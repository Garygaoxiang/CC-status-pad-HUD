# HUD 启动器：拉起采集器服务，把 HUD 网页 kiosk 铺到副屏。
# 失败即降级，绝不影响 Claude Code -- 本脚本与 Claude Code 完全解耦。
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $PSScriptRoot 'hud-config.json') -Raw | ConvertFrom-Json
if (-not $config) { Write-Host "缺少配置文件：$PSScriptRoot\hud-config.json，请先运行安装脚本。"; return }
$port = $config.port

# 1) 采集器：没监听就后台隐藏窗口拉起，轮询最多 5s 等就绪。
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'node' -ArgumentList "`"$root\src\server.js`"" -WorkingDirectory $root -WindowStyle Hidden
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
  }
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
    Write-Host "警告：采集器在 5s 内未就绪（端口 $port），HUD 页面可能显示空白。"
  }
}

# 2) 副屏检测：Screen.AllScreens -> JSON -> install-lib.js pick-screen
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height; primary = $_.Primary } })
$target = "$($config.targetScreen.width)x$($config.targetScreen.height)"
$screensJson = $screens | ConvertTo-Json -Compress
$pick = $screensJson | & node "$root\tools\install-lib.js" pick-screen --target $target
$screen = if ($pick) { $pick | ConvertFrom-Json } else { $null }

# 3) 浏览器 kiosk：优先 Chrome，回退 Edge；检测不到副屏则主屏开窗。
$url = "http://localhost:$port"
if ($screen) {
  $a = "--app=$url --kiosk --window-position=$($screen.x),$($screen.y) --window-size=$($screen.width),$($screen.height)"
  Write-Host "HUD -> 副屏 @$($screen.x),$($screen.y) $($screen.width)x$($screen.height) exact=$($screen.exact)"
} else {
  $a = "--app=$url"
  Write-Host "未检测到副屏，HUD 在主屏窗口打开；接好 TURZX 副屏后重跑本脚本。"
}
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

# HUD 采集器看门狗：单实例常驻，监控 :端口，server 缺席就带日志自动重启。
# 失败即降级，绝不影响 Claude Code —— 本进程与 Claude Code 完全解耦。
param(
  [int]$IntervalSec = 10
)
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$config = Get-Content (Join-Path $PSScriptRoot 'hud-config.json') -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json
$port = if ($config -and $config.port) { $config.port } else { 4317 }

# 单实例：拿不到全局 Mutex 说明已有看门狗在跑，直接退出，避免多实例叠加。
$mutex = New-Object System.Threading.Mutex($false, 'Global\turzx-coding-hud-watchdog')
if (-not $mutex.WaitOne(0)) { return }

$logDir = Join-Path $root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$wdLog  = Join-Path $logDir 'watchdog.log'
$outLog = Join-Path $logDir 'server-out.log'
$errLog = Join-Path $logDir 'server-err.log'

# 看门狗事件日志：追加，记录每次「发现缺席 → 重启」，便于回溯 server 为何没起。
function Write-Wd($msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $wdLog -Value $line -Encoding UTF8
}

# 解析 node 可执行：优先 PATH，回退常见安装路径。
# 开机早期 PATH/盘符可能未就绪 -> 暂时找不到，靠下一轮循环重试，最终自愈。
function Resolve-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", 'H:\node\node.exe', "$env:LOCALAPPDATA\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

Write-Wd "看门狗启动，监控端口 $port，巡检间隔 ${IntervalSec}s"
while ($true) {
  $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $listening) {
    $node = Resolve-Node
    if ($node) {
      Write-Wd "发现 :$port 无监听，拉起 server（node=$node）"
      try {
        Start-Process -FilePath $node -ArgumentList "`"$root\src\server.js`"" -WorkingDirectory $root `
          -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
      } catch {
        Write-Wd "拉起 server 失败：$($_.Exception.Message)"
      }
    } else {
      Write-Wd "发现 :$port 无监听，但暂时找不到 node 可执行，下一轮重试"
    }
  }
  Start-Sleep -Seconds $IntervalSec
}

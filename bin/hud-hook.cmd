@echo off
rem HUD hook 转发器 — 把 stdin 的 hook JSON POST 给采集器。
rem 1 秒超时；无论 curl 成败都强制 exit 0，绝不影响 Claude Code。
curl -s -m 1 -X POST http://localhost:4317/hook --data-binary @- >nul 2>&1
exit /b 0

@echo off
rem HUD hook forwarder: POST stdin hook JSON to the collector.
rem 1s timeout; always exit 0 regardless of curl result, never affects Claude Code.
curl -s -m 1 -X POST http://localhost:4317/hook --data-binary @- >nul 2>&1
exit /b 0

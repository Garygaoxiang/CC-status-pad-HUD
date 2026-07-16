@echo off
rem HUD hook forwarder: POST stdin hook JSON to the collector.
rem 1s timeout; always exit 0 regardless of curl result, never affects Claude Code.
rem --noproxy "*": curl honors HTTP_PROXY env vars; a local VPN proxy (127.0.0.1:10808)
rem swallows loopback requests, so bypass explicitly or hook events never reach the collector.
rem (ASCII only in .cmd files: cmd.exe parses them in the OEM codepage, UTF-8 breaks.)
curl -s -m 1 --noproxy "*" -X POST http://localhost:4317/hook --data-binary @- >nul 2>&1
exit /b 0

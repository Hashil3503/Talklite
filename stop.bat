@echo off
chcp 65001 > nul

echo ========================================================
echo   [Talklite] One-Click Shutdown
echo ========================================================

echo [1/2] Stopping processes (Backend, Frontend, ngrok)...
taskkill /f /im ngrok.exe > nul 2>&1
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8080, 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" > nul 2>&1

echo [2/2] Stopping Docker (Redis, MariaDB)...
docker compose down

echo.
echo ========================================================
echo   All Talklite Services Stopped Cleanly.
echo ========================================================
echo.
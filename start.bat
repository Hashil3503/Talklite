@echo off
chcp 65001 > nul

echo ========================================================
echo   [Talklite] One-Click Startup
echo ========================================================

echo [1/4] Starting Docker (Redis, MariaDB)...
docker compose up -d
ping 127.0.0.1 -n 4 > nul

echo [2/4] Starting Spring Boot Backend (8080)...
start "Talklite Backend (8080)" /d "%~dp0backend" cmd /k ".\mvnw.cmd spring-boot:run"

echo [3/4] Starting Vite Frontend (5173)...
start "Talklite Frontend (5173)" /d "%~dp0frontend" cmd /k "npm run dev"

echo [4/4] Starting ngrok Tunnel...
set "NGROK_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
if exist "%NGROK_EXE%" (
    start "Talklite ngrok (5173)" cmd /k ""%NGROK_EXE%" http 5173"
) else (
    start "Talklite ngrok (5173)" cmd /k "ngrok http 5173"
)

echo.
echo ========================================================
echo   Talklite Services Started!
echo   - Web App:   http://localhost:5173
echo   - Backend:   http://localhost:8080
echo   - ngrok Web: http://127.0.0.1:4040
echo ========================================================
echo.
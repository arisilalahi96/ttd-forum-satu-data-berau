@echo off
title e-TTD Berita Acara Forum Satu Data Berau 2026 - Online Server
echo =======================================================================
echo   e-TTD Berita Acara Forum Satu Data Kabupaten Berau 2026
echo   Menyiapkan Server Real-time + Tautan Publik HTTPS (50+ Peserta)
echo =======================================================================
echo.

cd /d "%~dp0"

set "NODE_EXE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

set "CLOUDFLARED_EXE=%~dp0cloudflared.exe"
where cloudflared >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "CLOUDFLARED_EXE=cloudflared"
  goto :START_SERVICES
)

if not exist "%CLOUDFLARED_EXE%" (
  echo [1/2] Mengunduh Cloudflare Tunnel resmi ^(cloudflared.exe^)...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '%CLOUDFLARED_EXE%'"
)

:START_SERVICES
echo [2/2] Menjalankan server lokal di port 3000 dan membuka Tunnel HTTPS...
start "Server e-TTD (Port 3000)" cmd /c ""%NODE_EXE%" src\server.js"
timeout /t 2 /nobreak >nul
echo.
echo -----------------------------------------------------------------------
echo   Salin tautan https://....trycloudflare.com yang muncul di kotak
echo   di bawah ini dan bagikan ke peserta rapat!
echo -----------------------------------------------------------------------
echo.
"%CLOUDFLARED_EXE%" tunnel --url http://localhost:3000
pause

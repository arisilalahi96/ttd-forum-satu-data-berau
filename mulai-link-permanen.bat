@echo off
title e-TTD Berita Acara Forum Satu Data Berau 2026 - Link Permanen (ngrok)
echo =======================================================================
echo   e-TTD Berita Acara Forum Satu Data Kabupaten Berau 2026
echo   Link Permanen: https://shortcut-quarrel-reshape.ngrok-free.dev
echo =======================================================================
echo.

cd /d "%~dp0"

set "NODE_EXE=node"
if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

echo [1/2] Menjalankan server lokal di port 3000...
start "Server e-TTD (Port 3000)" cmd /c ""%NODE_EXE%" src\server.js"
timeout /t 2 /nobreak >nul

echo [2/2] Mengaktifkan Link Permanen https://shortcut-quarrel-reshape.ngrok-free.dev ...
echo.
"%~dp0ngrok.exe" http --url=shortcut-quarrel-reshape.ngrok-free.dev 3000
pause

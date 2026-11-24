@echo off
title Push ke GitHub - e-TTD Berita Acara Forum Satu Data Berau 2026
echo =======================================================================
echo   Upload Proyek ke GitHub untuk Deploy Permanen 24 Jam di Render.com
echo =======================================================================
echo.

cd /d "%~dp0"

set /p REPO_URL="Masukkan URL Repository GitHub Anda (contoh: https://github.com/username/ttd-forum-satu-data-berau.git): "

if "%REPO_URL%"=="" (
  echo URL Repository tidak boleh kosong.
  pause
  exit /b 1
)

git remote remove origin >nul 2>nul
git remote add origin "%REPO_URL%"
git branch -M main
echo.
echo Mengunggah kode ke GitHub...
git push -u origin main

echo.
echo =======================================================================
echo   Selesai! Sekarang buka https://dashboard.render.com/select-repo?type=web
echo   dan pilih repository GitHub Anda untuk mengaktifkan link permanen.
echo =======================================================================
pause

@echo off
title Push ke GitHub - e-TTD Berita Acara Forum Satu Data Berau 2026
echo =======================================================================
echo   Upload Proyek ke GitHub: arisilalahi96/ttd-forum-satu-data-berau
echo =======================================================================
echo.

cd /d "%~dp0"

git remote remove origin >nul 2>nul
git remote add origin "https://github.com/arisilalahi96/ttd-forum-satu-data-berau.git"
git branch -M main

echo Mengunggah kode ke https://github.com/arisilalahi96/ttd-forum-satu-data-berau.git ...
echo ^(Jika muncul jendela Sign in GitHub di browser, silakan klik Authorize^).
echo.
git push -u origin main

echo.
echo =======================================================================
echo   Selesai! Sekarang buka https://dashboard.render.com/select-repo?type=web
echo   dan pilih repository ttd-forum-satu-data-berau untuk mengaktifkan link permanen.
echo =======================================================================
pause

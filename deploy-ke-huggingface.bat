@echo off
title Deploy Cloud 24 Jam ke Hugging Face Spaces
echo =======================================================================
echo   Deploy Cloud 24 Jam ^(Laptop Boleh Mati^) ke Hugging Face Spaces
echo   Target: https://huggingface.co/spaces/arisilalahi/ttd-forum-satu-data-berau
echo =======================================================================
echo.
echo 1. Buka https://huggingface.co/settings/tokens/new?tokenType=write di browser Anda
echo 2. Beri nama token bebas ^(misal: deploy^), lalu klik "Create token" dan Copy tokennya ^(hf_...^)
echo.

set /p HF_TOKEN="Tempelkan (Klik Kanan / Paste) Token Hugging Face Anda (hf_...): "

if "%HF_TOKEN%"=="" (
  echo Token tidak boleh kosong.
  pause
  exit /b 1
)

cd /d "%~dp0"

echo.
echo Mengunggah kode ke Server Cloud Hugging Face Spaces...
git push --force "https://arisilalahi:%HF_TOKEN%@huggingface.co/spaces/arisilalahi/ttd-forum-satu-data-berau" main

echo.
echo =======================================================================
echo   BERHASIL DI-DEPLOY KE CLOUD 24 JAM!
echo   Link Permanen Cloud Anda ^(Aktif 24 Jam Walau Laptop Mati^):
echo   1. Tampilan Penuh Langsung : https://arisilalahi-ttd-forum-satu-data-berau.hf.space
echo   2. Halaman Space           : https://huggingface.co/spaces/arisilalahi/ttd-forum-satu-data-berau
echo =======================================================================
pause

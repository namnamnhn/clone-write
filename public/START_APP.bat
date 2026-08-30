@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js tren may.
  echo Hay cai Node.js LTS, sau do chay lai START_APP.bat.
  pause
  exit /b 1
)
title Dịch ^& Biên Tập Truyện AI - Local Server
node.exe "%~dp0serve-local.mjs"
if errorlevel 1 pause

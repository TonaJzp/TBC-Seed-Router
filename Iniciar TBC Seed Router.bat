@echo off
rem Doble clic para abrir TBC Seed Router en el navegador (uso sin internet o en local).
rem Lo normal es usar la web publicada; ver README.md.
cd /d "%~dp0"
chcp 65001 >nul
title TBC Seed Router

where node >/dev/null 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Primera vez: instalando dependencias, puede tardar un minuto...
  call npm install
  if errorlevel 1 (
    echo La instalacion ha fallado.
    pause
    exit /b 1
  )
)

node scripts\start.js
pause

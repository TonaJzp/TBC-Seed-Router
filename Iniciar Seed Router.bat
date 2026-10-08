@echo off
rem Doble clic para abrir BattleCats Seed Router en el navegador.
cd /d "%~dp0"
chcp 65001 >nul
title BattleCats Seed Router

where node >nul 2>nul
if errorlevel 1 (
  echo No se encuentra Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Primera vez: instalando dependencias, puede tardar un par de minutos...
  call npm install
  if errorlevel 1 (
    echo La instalacion ha fallado.
    pause
    exit /b 1
  )
)

node server.js --open
pause

@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js and add it to PATH first.
  pause
  exit /b 1
)
node server.cjs
pause

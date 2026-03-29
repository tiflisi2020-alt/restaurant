@echo off
cd /d "%~dp0"
title Restaurant Tiflis — site
echo.
if not exist "node_modules\express\package.json" (
  echo Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo.
REM Force port 3000 so the URL always matches (clears a wrong PORT from environment)
set "PORT=3000"
set "HOST=127.0.0.1"
echo Starting server — keep this window open.
echo.
node server.js
if errorlevel 1 pause

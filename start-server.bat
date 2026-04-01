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
REM Dedicated port for Restaurant Tiflis (override: set PORT=… before running)
set "PORT=8844"
set "HOST=localhost"
REM Optional: Google Sign-In for /admin (same Client ID as in Google Cloud Console)
REM set "GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com"
REM Optional: allow more than one admin Google account (comma-separated, lowercase)
REM set "ADMIN_GOOGLE_EMAILS=tiflisi2020@gmail.com"
echo Starting server — keep this window open.
echo.
node server.js
if errorlevel 1 pause

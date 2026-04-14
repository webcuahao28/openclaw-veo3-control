@echo off
title VEO3 Auto Pipeline
cd /d C:\Users\ADMIN\openClawVeo3

echo [1/4] Kill Chrome cu...
taskkill /f /im chrome.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/4] Mo Chrome debug...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="C:\Users\ADMIN\chrome-cdp" ^
  --profile-directory="Profile 1"
timeout /t 4 /nobreak >nul

echo [3/4] Generate tasks...
node generate-tasks.js
if %errorlevel% neq 0 (
  echo FAILED: generate-tasks.js
  pause
  exit /b 1
)

echo [4/4] Run tasks...
node run-tasks.js

echo.
echo XONG - Nhan phim bat ky de dong
pause
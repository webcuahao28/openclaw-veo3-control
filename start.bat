@echo off
title OpenClaw Flow Bot — Khởi động
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo.
echo ╔══════════════════════════════════════════╗
echo ║     ⚡ OpenClaw Flow Bot — Setup          ║
echo ╚══════════════════════════════════════════╝
echo.

:: ── Kiểm tra Node.js ─────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo ❌ Chưa cài Node.js!
  echo    Tải về tại: https://nodejs.org  ^(LTS^)
  echo.
  pause
  start https://nodejs.org
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo ✅ Node.js %NODE_VER% — OK

:: ── Cài dependencies (chỉ lần đầu hoặc khi thiếu) ───────────────────────────
if not exist "node_modules\chrome-remote-interface" (
  echo.
  echo 📦 Đang cài dependencies (lần đầu mất ~30 giây)...
  call npm install --prefer-offline --no-audit --no-fund 2>&1
  if errorlevel 1 (
    echo ❌ npm install thất bại. Kiểm tra kết nối mạng rồi thử lại.
    pause
    exit /b 1
  )
  echo ✅ Dependencies đã cài xong.
)

if not exist "app\node_modules\electron" (
  echo.
  echo 📦 Đang cài Electron cho app (lần đầu mất 1-2 phút)...
  cd app
  call npm install --prefer-offline --no-audit --no-fund 2>&1
  cd ..
  if errorlevel 1 (
    echo ❌ Cài Electron thất bại.
    pause
    exit /b 1
  )
  echo ✅ Electron đã cài xong.
)

:: ── Mở Chrome với remote debugging (nếu chưa chạy) ──────────────────────────
echo.
echo 🌐 Kiểm tra Chrome...
node -e "const http=require('http');const r=http.get('http://127.0.0.1:9222/json/version',()=>{process.exit(0);});r.on('error',()=>process.exit(1));r.setTimeout(1500,()=>{r.destroy();process.exit(1);});" >nul 2>&1
if errorlevel 1 (
  echo    Chrome chưa mở. Đang khởi động Chrome với remote debugging...
  set CHROME_EXE=
  if exist "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"
  if exist "%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"
  if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

  if defined CHROME_EXE (
    start "" "%CHROME_EXE%" --remote-debugging-port=9222 --no-first-run "https://labs.google/fx/vi/tools/flow"
    echo ✅ Chrome đã mở — hãy đăng nhập Google nếu cần, rồi quay lại app.
    timeout /t 3 /nobreak >nul
  ) else (
    echo ⚠️  Không tìm thấy Chrome tự động.
    echo    Hãy mở Chrome thủ công với lệnh:
    echo    chrome.exe --remote-debugging-port=9222
    echo.
    pause
  )
) else (
  echo ✅ Chrome đang chạy với CDP port 9222 — OK
)

:: ── Khởi động Electron app ───────────────────────────────────────────────────
echo.
echo 🚀 Đang khởi động OpenClaw Flow Bot...
echo.
cd app
npx electron . 2>&1
cd ..

echo.
echo App đã đóng.
pause

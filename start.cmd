@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安装 Node.js。
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次启动，正在安装桌面运行时...
  call npm install
  if errorlevel 1 (
    echo 安装失败，请检查网络连接。
    pause
    exit /b 1
  )
)
call npm start
exit /b %errorlevel%

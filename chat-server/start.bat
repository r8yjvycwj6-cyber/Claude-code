@echo off
chcp 65001 >nul
title Chat Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装 Node.js 22 LTS 或更高版本: https://nodejs.org/
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo [错误] Node.js 版本过低，需要 22.13 或更高版本。当前版本:
  node -v
  pause
  exit /b 1
)

if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
  )
)

node --disable-warning=ExperimentalWarning server.js
pause

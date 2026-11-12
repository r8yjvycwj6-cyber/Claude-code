@echo off
rem 把聊天服务器注册为开机自启（Windows 计划任务，以 SYSTEM 身份在后台运行，崩溃自动重启）
rem 需要右键"以管理员身份运行"
chcp 65001 >nul
cd /d "%~dp0.."

net session >nul 2>&1
if errorlevel 1 (
  echo [错误] 请右键本文件，选择"以管理员身份运行"
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装 Node.js 22 LTS 或更高版本
  pause
  exit /b 1
)

if not exist node_modules call npm install --omit=dev --no-audit --no-fund

schtasks /Create /TN "ChatServer" /TR "\"%~dp0run-service.bat\"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 (
  echo [错误] 创建计划任务失败
  pause
  exit /b 1
)
schtasks /Run /TN "ChatServer"
echo.
echo 已安装并启动。日志: %cd%\data\server.log
echo 停止: schtasks /End /TN ChatServer     卸载: scripts\uninstall-service.bat
pause

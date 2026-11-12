@echo off
rem 在 Windows 防火墙中放行聊天服务器端口（默认 8443），IPv4 和 IPv6 同时生效。需要管理员权限。
rem 用法: open-firewall.bat [端口]
chcp 65001 >nul
set PORT=%1
if "%PORT%"=="" set PORT=8443
netsh advfirewall firewall delete rule name="ChatServer TCP %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="ChatServer TCP %PORT%" dir=in action=allow protocol=TCP localport=%PORT% profile=any
if errorlevel 1 (
  echo [错误] 失败，请右键"以管理员身份运行"
) else (
  echo 已放行 TCP 端口 %PORT%（IPv4 + IPv6，所有网络类型）
  echo.
  echo 如果是家庭宽带，还需要在光猫/路由器里放行 IPv6 入站连接，见 README.md "IPv6"一节。
)
pause

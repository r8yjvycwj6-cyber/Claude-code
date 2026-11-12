@echo off
rem 由计划任务在开机时调用（见 install-service.bat）。进程退出后 5 秒自动重启，日志写入 data\server.log
chcp 65001 >nul
cd /d "%~dp0.."
if not exist data mkdir data
:loop
echo [%date% %time%] starting >> data\server.log
node --disable-warning=ExperimentalWarning server.js >> data\server.log 2>&1
echo [%date% %time%] exited with code %errorlevel%, restarting in 5s >> data\server.log
timeout /t 5 /nobreak >nul
goto loop

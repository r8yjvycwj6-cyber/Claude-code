@echo off
rem 停止并删除开机自启任务（需要管理员权限）
chcp 65001 >nul
schtasks /End /TN "ChatServer" >nul 2>&1
schtasks /Delete /TN "ChatServer" /F
rem 结束由该任务启动的 node 进程（只结束运行 server.js 的那个）
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' -and $_.CommandLine -like '*disable-warning*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo 已卸载。
pause

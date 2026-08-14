@echo off
REM ============================================================
REM deploy-windows.bat — 流程图工作台一键启动（Windows）
REM 双击运行，浏览器自动打开生成器页面
REM 用法: deploy-windows.bat [端口，默认 8080]
REM ============================================================
chcp 65001 >nul
set PORT=%1
if "%PORT%"=="" set PORT=8080

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org （选 LTS 版）
  pause
  exit /b 1
)

echo [1/2] 启动流程图工作台（端口 %PORT%）...
start "flowchart-agent" /min cmd /c "node preview-server.mjs %PORT% ."

echo [2/2] 打开浏览器...
timeout /t 2 /nobreak >nul
start http://localhost:%PORT%/generate

echo.
echo ✅ 已启动：http://localhost:%PORT%/generate
echo    （关闭本窗口不会停止服务；停止服务请在任务管理器结束 node.exe）
echo.
echo 提示：内网其他同事访问请用本机 IP，如 http://你的IP:%PORT%/generate
pause

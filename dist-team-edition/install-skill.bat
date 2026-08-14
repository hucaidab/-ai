@echo off
REM ============================================================
REM install-skill.bat — 流程图技能包一键安装（Windows）
REM 双击运行：自动把 flowchart-agent 复制到 WorkBuddy 技能目录
REM ============================================================
chcp 65001 >nul
set SKILL_SRC=%~dp0flowchart-agent
set SKILL_DST=%USERPROFILE%\.workbuddy\skills\flowchart-agent

if not exist "%SKILL_SRC%\SKILL.md" (
  echo [错误] 未找到技能包源目录（install-skill.bat 需与 flowchart-agent 文件夹同级）
  pause
  exit /b 1
)

echo [1/2] 创建技能目录...
if not exist "%USERPROFILE%\.workbuddy\skills" mkdir "%USERPROFILE%\.workbuddy\skills"

echo [2/2] 复制技能包...
xcopy /E /I /Y "%SKILL_SRC%" "%SKILL_DST%" >nul

echo.
echo ✅ 安装完成！技能包已安装到：
echo    %SKILL_DST%
echo.
echo 下一步：
echo  1. 重启 WorkBuddy
echo  2. 对话里直接说：画一个采购审批流程图，采购员发起，采购经理审批
echo  3. 或打开编辑器：双击 scripts\deploy-windows.bat
echo.
pause

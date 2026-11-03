@echo off
chcp 936 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title UEKeyHunter v1.1

rem ================= 找 node =================
rem 1) 本目录 node-path.txt 里写一行完整路径（优先级最高）
rem 2) PATH 里的 node
rem 3) 常见安装位置
rem 4) DSH 自带的运行时
set "NODE="
if exist node-path.txt set /p NODE=<node-path.txt
if defined NODE set "NODE=!NODE:"=!"

if not defined NODE (
  for %%P in (node.exe) do if not defined NODE set "NODE=%%~$PATH:P"
)
if not defined NODE (
  for %%D in ("%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LOCALAPPDATA%\Programs\nodejs\node.exe") do (
    if not defined NODE if exist %%D set "NODE=%%~D"
  )
)
if not defined NODE (
  for /d %%R in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE if exist "%%~R\dependencies\node\bin\node.exe" set "NODE=%%~R\dependencies\node\bin\node.exe"
  )
)

if not defined NODE (
  echo.
  echo [FAIL] 找不到 node.exe
  echo        装个 Node.js 18+，或者在本目录新建 node-path.txt，
  echo        里面写一行 node.exe 的完整路径，再重新运行。
  echo.
  pause
  goto end
)

"%NODE%" -v >nul 2>&1
if errorlevel 1 (
  echo.
  echo [FAIL] node 找到了但跑不起来: !NODE!
  echo        检查这个路径是否有效，或改用 node-path.txt 指定。
  echo.
  pause
  goto end
)

if not exist target.json (
  echo.
  echo 还没有目标配置。
  echo 把游戏根目录拖进来，或者直接粘贴路径，然后回车：
  echo.
  set "GAMEPATH="
  set /p GAMEPATH=路径: 
  if "!GAMEPATH!"=="" goto end
  set "GAMEPATH=!GAMEPATH:"=!"
  "%NODE%" setup.js "!GAMEPATH!"
  echo.
  pause
)

:menu
cls
echo ================================================================
echo    UEKeyHunter v1.1      UE4 / UE5  AES key finder
echo ================================================================
"%NODE%" setup.js --show
echo.
echo    [1] 探测容器      看 pak 头 / utoc 头 / 到底加没加密
echo    [2] 扫主程序      exe 全偏移找 key
echo    [3] 校验一把 key  已经有候选 key 时直接判定真假
echo    [4] 抓内存        转储运行中进程的内存
echo    [5] 扫内存        扫转储目录找 key
echo    [6] 校验器自检    确认工具本身没坏
echo    [7] 更换目标      重新指定游戏目录
echo    [0] 退出
echo.
set "CH="
set /p CH=输入菜单编号 0-7 后回车: 
if "%CH%"=="1" goto p1
if "%CH%"=="2" goto p2
if "%CH%"=="3" goto p3
if "%CH%"=="4" goto p4
if "%CH%"=="5" goto p5
if "%CH%"=="6" goto p6
if "%CH%"=="7" goto p7
if "%CH%"=="0" goto end
goto menu

:p1
echo.
"%NODE%" probe.js
echo.
pause
goto menu

:p2
echo.
set "TFILE="
set /p TFILE=要扫的文件，直接回车用配置里的主程序: 
if not "!TFILE!"=="" set "TFILE=!TFILE:"=!"
if "!TFILE!"=="" (
  "%NODE%" scan-file.js
) else (
  "%NODE%" scan-file.js "!TFILE!"
)
echo.
pause
goto menu

:p3
echo.
set "KEY="
set /p KEY=粘贴 64 位 hex key: 
if "!KEY!"=="" goto menu
"%NODE%" verify-key.js "!KEY!"
echo.
pause
goto menu

:p4
echo.
"%NODE%" -e "process.stdout.write(require('./config').PROCESS||'')" > "%TEMP%\uekh_proc.txt"
set "PROC="
set /p PROC=<"%TEMP%\uekh_proc.txt"
echo 默认进程名: !PROC!
set "PN="
set /p PN=进程名或 pid，直接回车用默认: 
if "!PN!"=="" set "PN=!PROC!"
if "!PN!"=="" (
  echo [warn] 没有默认进程名，也没输入，放弃
  echo.
  pause
  goto menu
)
powershell -NoProfile -ExecutionPolicy Bypass -File dump-mem.ps1 -ProcessName "!PN!"
echo.
pause
goto menu

:p5
echo.
set "DDIR="
set /p DDIR=转储目录，直接回车用默认 mem 目录: 
if not "!DDIR!"=="" set "DDIR=!DDIR:"=!"
if "!DDIR!"=="" (
  "%NODE%" scan-mem.js --fast
) else (
  "%NODE%" scan-mem.js "!DDIR!"
)
echo.
pause
goto menu

:p6
echo.
"%NODE%" _selftest_oracle.js
echo.
pause
goto menu

:p7
echo.
set "GAMEPATH="
set /p GAMEPATH=新的游戏根目录: 
if "!GAMEPATH!"=="" goto menu
set "GAMEPATH=!GAMEPATH:"=!"
"%NODE%" setup.js "!GAMEPATH!"
echo.
pause
goto menu

:end
endlocal

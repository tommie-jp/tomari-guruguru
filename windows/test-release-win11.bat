@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  guruguru-avatar 最新リリースを Windows 11 でテストするランチャー
rem  test-release-win11.ps1 を ExecutionPolicy Bypass で実行する。
rem  使い方: このファイルをダブルクリックするだけ。
rem  引数(例 -KeepRunning)はそのまま PowerShell に渡される。
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-release-win11.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
echo ( 終了コード: %RC%  0=PASS / 1=FAIL )
echo.
pause
endlocal
exit /b %RC%

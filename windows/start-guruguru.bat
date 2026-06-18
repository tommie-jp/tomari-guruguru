@echo off
chcp 65001 >nul
setlocal
rem ============================================================
rem  ぐるぐるアバター: OBS 用ローカルサーバ起動（中継 + 静的配信）
rem  単一 Windows PC 想定。すべて localhost なので TLS / Tailscale 不要。
rem  置き場所: guruguru-avatar\windows\start-guruguru.bat
rem  （一つ上のフォルダ guruguru-avatar\ を作業ディレクトリにする）
rem ============================================================

rem プロジェクト直下（このバッチの一つ上）へ移動
cd /d "%~dp0.."

set "PORT=8787"
set "HOST=127.0.0.1"

rem Node.js が無ければ案内して終了
where node >nul 2>nul
if errorlevel 1 (
  echo [エラー] Node.js が見つかりません。
  echo   PowerShell で次を実行してインストールしてください:
  echo     winget install OpenJS.NodeJS.LTS
  echo   インストール後、ウィンドウを開き直してから再実行してください。
  pause
  exit /b 1
)

rem 配信物（dist-local）が無ければ初回ビルド
if not exist "dist-local\camera.html" (
  echo [準備] dist-local が無いのでビルドします（初回のみ・数十秒）...
  call npm install
  if errorlevel 1 ( echo [エラー] npm install に失敗しました。& pause & exit /b 1 )
  call npm run build:local
  if errorlevel 1 ( echo [エラー] ビルドに失敗しました。& pause & exit /b 1 )
)

echo [起動] サーバを起動します ... http://%HOST%:%PORT%/
rem サーバは別ウィンドウ（最小化）で常駐。停止はそのウィンドウを閉じるか Ctrl+C。
start "guruguru-relay" /min cmd /c node server\relay.mjs --web-root dist-local --port %PORT% --host %HOST%

rem サーバ起動を待ってから送信側ブラウザを既定ブラウザで開く
timeout /t 2 /nobreak >nul
start "" "http://%HOST%:%PORT%/camera.html?tx"

echo.
echo ============================================================
echo  送信側(tx) ブラウザ : http://%HOST%:%PORT%/camera.html?tx
echo    カメラを許可して顔を動かす（設定 UI もここ）
echo.
echo  OBS 受信側(rx) URL  : http://%HOST%:%PORT%/camera.html?rx^&obs=1
echo    OBS の「ブラウザ」ソースに上の rx URL を貼る（背景は透過）
echo ============================================================
echo.
echo このウィンドウは閉じても構いません（サーバは別ウィンドウで動作中）。
pause
endlocal

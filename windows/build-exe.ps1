# ============================================================
#  guruguru-relay.exe を生成する（Node SEA = Single Executable）。
#  ★ Windows 上で実行すること（Windows の node.exe に blob を注入するため）。
#  ★ このスクリプトはプロジェクト一式（package.json / server\ / node_modules）が
#     必要。guruguru-avatar\windows\build-exe.ps1 に置いた状態で実行する。
#     .ps1 だけを Downloads 等にコピーしても動かない（先に git clone / コピーが必要）。
#
#  実行: PowerShell で
#    cd <...>\guruguru-avatar
#    powershell -ExecutionPolicy Bypass -File windows\build-exe.ps1
#
#  出力: dist-exe\guruguru-relay.exe / dist-exe\dist-local\ / dist-exe\start.bat
#        → dist-exe\ を丸ごと配布すれば、配布先に Node 不要で動く。
# ============================================================
$ErrorActionPreference = 'Stop'

# プロジェクト直下（package.json と server\relay.mjs がある場所）を探す。
# 候補: スクリプトの一つ上 → スクリプトのある場所 → 現在地。
function Find-ProjectRoot {
  $candidates = @(
    (Join-Path $PSScriptRoot '..'),
    $PSScriptRoot,
    (Get-Location).Path
  )
  foreach ($c in $candidates) {
    if (-not $c) { continue }
    $p = (Resolve-Path $c -ErrorAction SilentlyContinue)
    if ($p -and
        (Test-Path (Join-Path $p.Path 'package.json')) -and
        (Test-Path (Join-Path $p.Path 'server\relay.mjs'))) {
      return $p.Path
    }
  }
  return $null
}

$root = Find-ProjectRoot
if (-not $root) {
  Write-Host ''
  Write-Host '[エラー] プロジェクトが見つかりません。' -ForegroundColor Red
  Write-Host '  build-exe.ps1 は guruguru-avatar\windows\ に置き、プロジェクト一式'
  Write-Host '  （package.json / server\ / node_modules）がある状態で実行してください。'
  Write-Host '  .ps1 だけを Downloads 等に置いても動きません。先に次のどちらかを:'
  Write-Host '    1) git clone https://github.com/tommie-jp/guruguru-avatar'
  Write-Host '    2) WSL 等からプロジェクトを丸ごとコピー'
  Write-Host '  そのうえで guruguru-avatar 直下で windows\build-exe.ps1 を実行。'
  Write-Host ''
  exit 1
}
Set-Location $root
Write-Host "[info] プロジェクト直下: $root"

# Node 公式ビルドに埋め込まれている SEA 用のヒューズ文字列（固定値）
$fuse = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
$exe  = 'dist-exe\guruguru-relay.exe'

if (-not (Test-Path 'node_modules')) {
  Write-Host '[0/5] 依存をインストール (npm install) ...'
  npm install
}

Write-Host '[1/5] 静的配信物をビルド (dist-local) ...'
npm run build:local

Write-Host '[2/5] サーバを単一CJSにバンドル + SEA blob を生成 ...'
npm run build:sea-blob

Write-Host '[3/5] node.exe を複製して土台にする ...'
$node = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path 'dist-exe' | Out-Null
Copy-Item $node $exe -Force

Write-Host '[4/5] blob を注入 (postject) ...'
# 既存 exe へ NODE_SEA_BLOB リソースを書き込む。Authenticode 署名は外れる
# （SmartScreen が「発行元不明」を出すことがあるが、実行はできる）。
npx --yes postject $exe NODE_SEA_BLOB dist-exe\relay.blob --sentinel-fuse $fuse

Write-Host '[5/5] 配布フォルダを組み立て ...'
if (Test-Path 'dist-exe\dist-local') { Remove-Item -Recurse -Force 'dist-exe\dist-local' }
Copy-Item -Recurse -Force 'dist-local' 'dist-exe\dist-local'

# 配布用 start.bat（exe の隣で実行する想定・全 ASCII で BOM なし）
$startBat = @'
@echo off
cd /d "%~dp0"
start "guruguru-relay" /min guruguru-relay.exe --web-root dist-local --port 8787 --host 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/camera.html?tx"
echo.
echo  tx (send) : http://127.0.0.1:8787/camera.html?tx
echo  rx (OBS)  : http://127.0.0.1:8787/camera.html?rx^&obs=1
echo.
pause
'@
Set-Content -Path 'dist-exe\start.bat' -Value $startBat -Encoding ascii

Write-Host ''
Write-Host '完成: dist-exe\ を丸ごと配布してください。'
Write-Host '  - guruguru-relay.exe / dist-local\ / start.bat'
Write-Host '  - 配布先での起動: start.bat をダブルクリック（Node 不要）'

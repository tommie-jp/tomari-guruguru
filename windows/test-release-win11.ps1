<#
.SYNOPSIS
  guruguru-avatar の最新 Windows リリース(zip)を実機 Windows 11 で End-to-End テストする。

.DESCRIPTION
  実際のユーザー手順をそのまま自動化して検証する:
    1. GitHub の「最新リリース」から *.zip を取得し、ダウンロードフォルダへ保存する
    2. ダウンロードフォルダ内で解凍する
    3. 同梱の start.bat を実行する（guruguru-relay.exe が起動する）
    4. 送信側 ?tx / OBS 受信側 ?rx が curl で 200 OK / HTML として取得できるか検証する
    5. 後片付けで relay を停止する（-KeepRunning を付けると起動したまま残す）

  ダウンロード由来の Mark-of-the-Web は Unblock-File で外し、SmartScreen による
  起動ブロックでテストが止まらないようにする。relay の特定・停止は「待ち受けポートの
  所有 PID」を基準に行い、ユーザーが手動で起動している別の relay は巻き込まない。

.PARAMETER Repo
  対象リポジトリ owner/repo（既定: tommie-jp/guruguru-avatar）。

.PARAMETER Tag
  テストするリリースのタグ（例: win-v1.4.0）。指定すると releases/tags/<Tag> を使う。
  未指定なら releases/latest（最新リリース）。

.PARAMETER TimeoutSec
  サーバ起動を待つ最大秒数（既定: 60）。初回は EXE の検疫スキャンで時間がかかる場合がある。

.PARAMETER KeepRunning
  検証後も relay を停止せず、起動したままにする（手動で画面確認したいとき）。

.PARAMETER SkipDownload
  既にダウンロード済みの zip を使い、ダウンロードを省略する（サイズ一致時のみ）。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\test-release-win11.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\test-release-win11.ps1 -KeepRunning

.NOTES
  - Windows 10/11 標準の curl.exe（C:\Windows\System32\curl.exe）を使用する。
    PowerShell の `curl` エイリアス（Invoke-WebRequest）ではない。
  - start.bat は既定ブラウザで ?tx を開く。本スクリプトはそのタブを閉じない（仕様）。
    後片付けで relay を止めるため、残ったタブは「接続できません」表示になるが、これは
    テスト失敗ではない（合否は curl の結果だけで判定する）。
  - このファイルは UTF-8 (BOM 付き) で保存すること。BOM が無いと Windows PowerShell 5.1 が
    ANSI コードページで解釈し、日本語メッセージが文字化けする。
#>
[CmdletBinding()]
param(
  [string]$Repo = 'tommie-jp/guruguru-avatar',
  [string]$Tag = '',
  [int]$TimeoutSec = 60,
  [switch]$KeepRunning,
  [switch]$SkipDownload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# コンソール出力を UTF-8 に（… → ✅ ❌ や日本語が化けないように）。
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}
# 古い PowerShell でも GitHub への HTTPS が通るように TLS1.2 を明示。
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Info([string]$m) { Write-Host "[INFO]  $m" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "[OK]    $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[WARN]  $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "[FAIL]  $m" -ForegroundColor Red }

# リリース EXE の既定イメージ名（拡張子なし）。解凍前の停止判定に使う。
$RELAY_DEFAULT_NAME = 'guruguru-relay'

# ---- 状態変数（StrictMode 対策で先に初期化）-------------------------------
$proc         = $null
$serverUp     = $false
$allPass      = $false
$results      = @()
$relayPid     = $null
$preRelayPids = @()

# ---- 小物ヘルパ -----------------------------------------------------------
# 指定ポートを Listen している PID（無ければ $null）。Get-NetTCPConnection が無い環境は $null。
function Get-PortOwnerPid([int]$p) {
  try {
    return (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
      Select-Object -First 1 -ExpandProperty OwningProcess)
  } catch { return $null }
}
function Get-PidName([int]$id) {
  try { return (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch { return $null }
}
function Get-RelayPids {
  # 既定名の relay プロセスの PID 一覧（StrictMode 安全に空配列で返す）。
  return @(Get-Process -Name $RELAY_DEFAULT_NAME -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Id)
}

# ---- curl.exe を解決（PowerShell の curl エイリアスを避け、実体を使う）-----
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path -LiteralPath $curl)) {
  $cmd = Get-Command 'curl.exe' -ErrorAction SilentlyContinue
  if ($cmd) { $curl = $cmd.Source }
  else { throw 'curl.exe が見つかりません（Windows 10/11 には標準搭載されています）。' }
}
Info "curl: $curl"

# ---- ダウンロードフォルダを解決 -------------------------------------------
function Get-DownloadsDir {
  # 既知フォルダ(Downloads)の GUID。リダイレクトされていてもレジストリから拾う。
  try {
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
    $name = '{374DE290-123F-4565-9164-39C4925E467B}'
    $val = (Get-ItemProperty -Path $key -Name $name -ErrorAction Stop).$name
    if ($val) { return [Environment]::ExpandEnvironmentVariables([string]$val) }
  } catch {}
  return (Join-Path $env:USERPROFILE 'Downloads')
}
$downloads = Get-DownloadsDir
if (-not (Test-Path -LiteralPath $downloads)) {
  New-Item -ItemType Directory -Path $downloads -Force | Out-Null
}
Info "ダウンロードフォルダ: $downloads"

# ---- 最新リリースの zip を特定（API エラーは分かりやすく案内）-------------
if ($Tag) {
  $apiUrl = "https://api.github.com/repos/$Repo/releases/tags/$Tag"
  Info "指定タグのリリースを問い合わせ: $apiUrl"
} else {
  $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
  Info "最新リリースを問い合わせ: $apiUrl"
}
$headers = @{ 'User-Agent' = 'guruguru-release-test'; 'Accept' = 'application/vnd.github+json' }
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }  # 任意（レート制限緩和）
try {
  $rel = Invoke-RestMethod -Uri $apiUrl -Headers $headers
} catch {
  $sc = $null
  try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
  $remaining = $null
  try { $remaining = $_.Exception.Response.Headers['X-RateLimit-Remaining'] } catch {}
  if ($sc -eq 403 -and "$remaining" -eq '0') {
    Fail 'GitHub API のレート制限に達しました（未認証は 60回/時）。環境変数 GITHUB_TOKEN に PAT を設定して再実行してください。'
  } elseif ($sc) {
    Fail "GitHub API がエラーを返しました (HTTP $sc)。リポジトリ名/公開状態を確認してください。"
  } else {
    Fail 'GitHub に到達できません（ネットワーク/DNS/プロキシ/TLS を確認してください）。'
  }
  throw
}
# これは Windows 実機テストなので、必ず win 版 zip を選ぶ。リリースには
# linux/macOS の zip も含まれ、GitHub はアセットを名前順（linux < macos < win）で
# 返すため、単純な「先頭 .zip」だと linux を掴んで start.bat が無くて失敗する。
$asset = $rel.assets | Where-Object { $_.name -like '*-win-*.zip' } | Select-Object -First 1
if (-not $asset) {
  # 旧命名（プラットフォーム名なし）への後方互換: 他 OS 版を除いた .zip を拾う。
  $asset = $rel.assets |
    Where-Object { $_.name -like '*.zip' -and $_.name -notlike '*linux*' -and $_.name -notlike '*macos*' } |
    Select-Object -First 1
}
if (-not $asset) { throw "リリース $($rel.tag_name) に Windows 版 (.zip) アセットが見つかりません。" }
$sizeMB = [math]::Round($asset.size / 1MB, 1)
Ok "最新版: $($rel.tag_name)  /  asset: $($asset.name)  (${sizeMB} MB)"

$zipPath = Join-Path $downloads $asset.name

# ---- ダウンロード（curl.exe で。リダイレクト追従 + リトライ）---------------
$needDownload = $true
if ($SkipDownload -and (Test-Path -LiteralPath $zipPath)) {
  $have = (Get-Item -LiteralPath $zipPath).Length
  if ($have -eq $asset.size) {
    Info "既存 zip を再利用（-SkipDownload, サイズ一致）: $zipPath"
    $needDownload = $false
  } else {
    Warn "既存 zip のサイズが不一致（$have != $($asset.size)）。破損とみなし再取得します。"
  }
}
if ($needDownload) {
  Info "ダウンロード中… $($asset.browser_download_url)"
  & $curl -L --fail --retry 3 --retry-delay 2 -o $zipPath $asset.browser_download_url
  if ($LASTEXITCODE -ne 0) {
    # 途中失敗で残る部分ファイルを消す（次回の -SkipDownload を汚さないため）。
    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    throw "ダウンロードに失敗しました (curl 終了コード $LASTEXITCODE)。"
  }
}
if (-not (Test-Path -LiteralPath $zipPath)) { throw "zip が見つかりません: $zipPath" }
$zipBytes = (Get-Item -LiteralPath $zipPath).Length
if ($zipBytes -ne $asset.size) { throw "zip サイズ不一致: $zipBytes != $($asset.size)（ダウンロード破損）。" }
Ok "保存: $zipPath ($zipBytes bytes)"
# 解凍物が SmartScreen でブロックされないよう、先に zip の Zone 情報を外す。
Unblock-File -LiteralPath $zipPath -ErrorAction SilentlyContinue

# ---- 解凍先を準備（その中で動く古い relay を先に止めてから消す）-----------
$extractDir = Join-Path $downloads ([IO.Path]::GetFileNameWithoutExtension($asset.name))
$extractPrefix = $extractDir.TrimEnd('\') + '\'

if (Test-Path -LiteralPath $extractDir) {
  # 解凍先フォルダ内の exe を実行中だと削除が exe ロックで失敗する。
  # ただし「この解凍先の中で動いているプロセス」だけを止め、別所の relay は巻き込まない。
  Get-Process -Name $RELAY_DEFAULT_NAME -ErrorAction SilentlyContinue | ForEach-Object {
    $path = $null; try { $path = $_.Path } catch {}
    if ($path -and $path.StartsWith($extractPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      Warn "解凍先で動作中の $($_.ProcessName) (PID $($_.Id)) を停止します。"
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
  Info "既存の解凍先を削除: $extractDir"
  for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $extractDir); $i++) {
    try { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction Stop; break }
    catch { Start-Sleep -Milliseconds 500 }
  }
  if (Test-Path -LiteralPath $extractDir) {
    throw "解凍先を削除できません（実行中の relay がロックしている可能性）: $extractDir"
  }
}

Info "解凍中… → $extractDir"
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
# 解凍後のツリー全体からも Mark-of-the-Web を除去（EXE 起動ブロック防止）。
Get-ChildItem -LiteralPath $extractDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
Ok "解凍完了"

# ---- start.bat / relay exe を探す -----------------------------------------
$startBat = Get-ChildItem -LiteralPath $extractDir -Recurse -Filter 'start.bat' | Select-Object -First 1
if (-not $startBat) { throw "start.bat が解凍物に見つかりません: $extractDir" }
$appDir = $startBat.Directory.FullName
Ok "start.bat: $($startBat.FullName)"

$relayExe = Get-ChildItem -LiteralPath $appDir -Filter '*.exe' | Select-Object -First 1
$relayName = if ($relayExe) { [IO.Path]::GetFileNameWithoutExtension($relayExe.Name) } else { $RELAY_DEFAULT_NAME }
Info "relay 実行ファイル: $relayName"

# ---- start.bat から host / port を読み取る（既定 127.0.0.1:8787）-----------
$batText = Get-Content -Raw -LiteralPath $startBat.FullName
$port = 8787
if ($batText -match '--port[=\s]+(\d+)')      { $port = [int]$Matches[1] }
$bindHost = '127.0.0.1'
if ($batText -match '--host[=\s]+([0-9.]+)')   { $bindHost = $Matches[1] }
# 0.0.0.0 で待ち受けていてもアクセスは loopback で行う。
$curlHost = if ($bindHost -eq '0.0.0.0') { '127.0.0.1' } else { $bindHost }
$base = "http://${curlHost}:$port"
Info "想定エンドポイント:  $base/?tx  /  $base/?rx"

# ---- ポート占有チェック（誤検知 PASS と exe ロックの両方を防ぐ）-----------
$ownerPid = Get-PortOwnerPid $port
if ($ownerPid) {
  $ownerName = Get-PidName $ownerPid
  if ($ownerName -and ($ownerName -ieq $relayName)) {
    Warn "ポート $port を使用中の古い $ownerName (PID $ownerPid) を停止します。"
    Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 700
  } else {
    throw "ポート $port は別プロセス（$ownerName, PID $ownerPid）が使用中です。停止してから再実行してください。"
  }
}

# ---- curl による単一エンドポイント検証 ------------------------------------
function Test-Endpoint([string]$label, [string]$url) {
  $tmp = Join-Path $env:TEMP ('ggtest_' + [Guid]::NewGuid().ToString('N') + '.html')
  $meta = & $curl -s -o $tmp -w '%{http_code}|%{content_type}' --max-time 8 $url
  $parts = "$meta".Split('|')
  $code  = $parts[0]
  $ctype = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  $body  = if (Test-Path -LiteralPath $tmp) { Get-Content -Raw -LiteralPath $tmp -ErrorAction SilentlyContinue } else { '' }
  Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
  $isHtml = ($body -imatch '<html' -or $body -imatch '<!doctype')
  [pscustomobject]@{
    Label       = $label
    Url         = $url
    Code        = $code
    ContentType = $ctype
    Html        = [bool]$isHtml
    Pass        = (($code -eq '200') -and $isHtml)
  }
}

# このスクリプトが起動する前から居る relay PID を記録（後片付けで巻き込まないため）。
$preRelayPids = Get-RelayPids

try {
  # ---- start.bat 実行（別ウィンドウ。relay は /min で常駐、bat は pause で待機）
  Info 'start.bat を実行します…（relay 起動 + 既定ブラウザで ?tx が開きます）'
  $proc = Start-Process -FilePath $startBat.FullName -WorkingDirectory $appDir -PassThru

  # ---- サーバ起動待ち（?rx が 200 を返すまでポーリング）-------------------
  Info "サーバ起動を待機（最大 ${TimeoutSec}s）…"
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $code = & $curl -s -o NUL -w '%{http_code}' --max-time 3 "$base/?rx" 2>$null
    if ("$code" -eq '200') { $serverUp = $true; break }
    Start-Sleep -Milliseconds 700
  }

  if (-not $serverUp) {
    Fail "タイムアウト: $base にサーバが立ち上がりませんでした（${TimeoutSec}s）。"
    Warn 'SmartScreen のブロックや Node/EXE 検疫の可能性があります。relay ウィンドウを確認してください。'
  } else {
    # 200 を返しているのが「今起動した relay」であることをポート所有 PID で確認。
    $relayPid = Get-PortOwnerPid $port
    if ($relayPid) {
      $pn = Get-PidName $relayPid
      Info "relay PID: $relayPid ($pn)"
      if ($pn -and ($pn -ine $relayName)) {
        Warn "ポート $port を握っているのは relay 以外の可能性: $pn"
      }
    }
    Ok 'サーバ応答を確認。エンドポイントを検証します。'
    $results = @(
      (Test-Endpoint 'tx (送信側)'    "$base/?tx"),
      (Test-Endpoint 'rx (OBS 受信側)' "$base/?rx")
    )
  }
}
finally {
  if ($KeepRunning) {
    Warn "-KeepRunning 指定: relay は起動したままにします（停止は relay ウィンドウを閉じてください）。"
  } else {
    Info 'relay を停止します…'
    # ポートから特定した relay を確実に停止。
    if ($relayPid) { Stop-Process -Id $relayPid -Force -ErrorAction SilentlyContinue }
    # 念のため: このスクリプト起動後に新たに現れた relay PID だけを止める（既存は巻き込まない）。
    # 起動が遅れて今ごろ湧くケースも数秒だけ追って取りこぼさない。
    for ($i = 0; $i -lt 6; $i++) {
      $newPids = @(Get-RelayPids | Where-Object { $preRelayPids -notcontains $_ })
      if ($newPids.Count -gt 0) {
        $newPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        if ($serverUp) { break }   # 正常起動時は一掃できたら抜ける
      } elseif ($serverUp) { break }
      Start-Sleep -Milliseconds 500
    }
    # start.bat を実行した cmd ウィンドウ（pause で待機中）も閉じる。
    if ($proc -and -not $proc.HasExited) { Stop-Process -InputObject $proc -Force -ErrorAction SilentlyContinue }
  }
}

# ---- 結果表示 -------------------------------------------------------------
Write-Host ''
Write-Host '==================== 検証結果 ====================' -ForegroundColor White
if ($results.Count -gt 0) {
  $results | Format-Table Label, Code, ContentType, Html, Pass -AutoSize | Out-String | Write-Host
  foreach ($r in $results) {
    if ($r.Pass) { Ok   "$($r.Label): $($r.Url) → HTTP $($r.Code)" }
    else         { Fail "$($r.Label): $($r.Url) → HTTP $($r.Code) (HTML=$($r.Html))" }
  }
  $allPass = (@($results | Where-Object { -not $_.Pass }).Count -eq 0)
} else {
  $allPass = $false
}

Write-Host ''
Info "zip      : $zipPath"
Info "解凍先   : $extractDir"
Info "appDir   : $appDir"
Write-Host ''
if ($allPass) { Ok   '総合判定: PASS ✅  (tx / rx ともに 200 OK / HTML)' ; exit 0 }
else          { Fail '総合判定: FAIL ❌' ; exit 1 }

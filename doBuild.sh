#!/usr/bin/env bash
#
# Windows 版リレイサーバ（中継 + 静的配信の単体 exe）の配布 zip を「ビルドするだけ」の
# スクリプト。GitHub へのアップロードはしない（それは ./doDeploy.sh win）。
#
# 生成物: dist-exe/guruguru-avatar-win-v<version>.zip
#   └─ guruguru-obs-win/  guruguru-relay.exe / dist-local/ / start.bat / README.txt
#
set -euo pipefail

usage() {
  cat <<'USAGE'
doBuild.sh — Windows 版リレイサーバの配布 zip をビルド（アップロードはしない）

使い方:
  ./doBuild.sh             dist-exe/guruguru-avatar-win-v<version>.zip を生成
  ./doBuild.sh -h|--help   このヘルプを表示

生成物:
  dist-exe/guruguru-avatar-win-v<version>.zip
    └─ guruguru-obs-win/   guruguru-relay.exe / dist-local/ / start.bat / README.txt

環境変数:
  WINNODE   blob 注入の土台にする Windows 版 node.exe のパス
            （既定: /mnt/c/Program Files/nodejs/node.exe）

GitHub Release として配置するには:  ./doDeploy.sh win
USAGE
}

case "${1:-}" in
  -h|--help|help) usage; exit 0 ;;
  "") ;;
  *) echo "不明な引数: $1"; echo; usage; exit 2 ;;
esac

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても効くように。
cd "$(dirname "$0")"

WINNODE="${WINNODE:-/mnt/c/Program Files/nodejs/node.exe}"
FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
VERSION="$(node -p "require('./package.json').version")"
ZIP="dist-exe/guruguru-avatar-win-v${VERSION}.zip"

# 前提チェック
command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です"; exit 1; }
command -v zip  >/dev/null 2>&1 || { echo "エラー: zip が必要です（apt install zip）"; exit 1; }
if [ ! -f "$WINNODE" ]; then
  echo "エラー: Windows 版 node.exe が見つかりません: $WINNODE"
  echo "  → WINNODE=/path/to/node.exe ./doBuild.sh で場所を指定してください。"
  exit 1
fi

echo "[1/6] 静的配信物をビルド (dist-local, base '/')..."
npm run build:local

echo "[2/6] サーバを単一CJSにバンドル + SEA blob 生成..."
npm run build:sea-blob

echo "[3/6] node.exe に blob を注入して guruguru-relay.exe を生成..."
cp "$WINNODE" dist-exe/guruguru-relay.exe
chmod u+rw dist-exe/guruguru-relay.exe
npx --yes postject dist-exe/guruguru-relay.exe NODE_SEA_BLOB dist-exe/relay.blob --sentinel-fuse "$FUSE"

echo "[4/6] 検証: exe にアプリコード(blob)が埋め込まれたか..."
# Node 更新などで blob が入らない（＝ただの node.exe）と起動しても何もしないため、
# 自分のコード痕跡を確認して取りこぼしを防ぐ。
if [ "$(grep -a -c 'serving static' dist-exe/guruguru-relay.exe)" -lt 1 ]; then
  echo "エラー: exe にアプリコードが見つかりません（blob 注入に失敗）。中止します。"
  exit 1
fi
echo "  OK（size=$(stat -c%s dist-exe/guruguru-relay.exe) bytes）"

echo "[5/6] 配布物(start.bat / README.txt)を生成..."
# 配布用 start.bat（exe の隣で実行・全 ASCII・CRLF）
cat > dist-exe/start.bat <<'BAT'
@echo off
cd /d "%~dp0"
start "guruguru-relay" /min guruguru-relay.exe --web-root dist-local --port 8787 --host 127.0.0.1
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787/?tx"
echo.
echo  tx (send) : http://127.0.0.1:8787/?tx
echo  rx (OBS)  : http://127.0.0.1:8787/?rx
echo.
pause
BAT
sed -i 's/\r$//; s/$/\r/' dist-exe/start.bat

cat > dist-exe/README.txt <<'TXT'
ぐるぐるアバター — OBS 用ローカルサーバ（Windows・Node 不要）

【使い方】
 1. このフォルダをローカルドライブ（例 C:\guruguru）にコピーする
    ※ zip の中から直接実行せず、必ず「すべて展開」してから
 2. start.bat をダブルクリック
    - 送信側(tx)が既定ブラウザで開きます（カメラを許可）
 3. OBS で「ソース → ブラウザ」を追加し、URL に次を貼る:
       http://localhost:8787/?rx
    背景は透過。tx の画面下に「CEF 接続中（1）」が出れば結線 OK。

【中身】
   guruguru-relay.exe   中継 + 静的配信（Node 同梱・単体で動作）
   dist-local\          配信物（camera.html ほか）
   start.bat            起動用

【注意】
 - 必ずローカルドライブから実行する。
 - 初回に SmartScreen が出たら［詳細情報］→［実行］。
 - ポートを変えるときは start.bat 内の --port を編集（rx/tx の URL も合わせる）。
 - LAN の別 PC からも繋ぐなら start.bat の --host を 0.0.0.0 に（要ファイアウォール許可）。
TXT
sed -i 's/\r$//; s/$/\r/' dist-exe/README.txt

echo "[6/6] 配布フォルダを組み立てて zip 化 ($ZIP)..."
# 同一 FS 内はハードリンクで実体コピーを避ける（exe 90MB+ / dist-local 57MB）。
rm -rf guruguru-obs-win "$ZIP"
mkdir guruguru-obs-win
cp -l dist-exe/guruguru-relay.exe guruguru-obs-win/ 2>/dev/null || cp dist-exe/guruguru-relay.exe guruguru-obs-win/
cp -rl dist-local guruguru-obs-win/dist-local 2>/dev/null || cp -r dist-local guruguru-obs-win/dist-local
cp dist-exe/start.bat dist-exe/README.txt guruguru-obs-win/
zip -r -q "$ZIP" guruguru-obs-win
rm -rf guruguru-obs-win

echo "✓ ビルド完了: $ZIP（$(stat -c%s "$ZIP") bytes）"

#!/usr/bin/env bash
#
# リレイサーバ（中継 + 静的配信の単体実行ファイル）の配布 zip を「ビルドするだけ」の
# スクリプト。GitHub へのアップロードはしない（それは ./doDeploy.sh win）。
#
# ランタイムは Bun。`bun build --compile` で 3 ターゲットを「この 1 台から」クロス
# コンパイルする（旧 Node SEA と違い Windows 上で作る必要はない）。
#   - bun-windows-x64  → dist-exe/guruguru-relay.exe
#   - bun-linux-x64    → dist-exe/guruguru-relay-linux-x64
#   - bun-darwin-arm64 → dist-exe/guruguru-relay-macos-arm64
#
# 生成物（各プラットフォームの配布 zip）:
#   dist-exe/guruguru-avatar-win-v<version>.zip   guruguru-obs-win/   (exe + dist-local + start.bat + README.txt)
#   dist-exe/guruguru-avatar-linux-v<version>.zip guruguru-obs-linux/ (bin + dist-local + start.sh  + README.txt)
#   dist-exe/guruguru-avatar-macos-v<version>.zip guruguru-obs-macos/ (bin + dist-local + start.command + README.txt)
#
set -euo pipefail

usage() {
  cat <<'USAGE'
doBuild.sh — リレイサーバの配布 zip をビルド（アップロードはしない）

使い方:
  ./doBuild.sh             win/linux/macOS の配布 zip を dist-exe/ に生成
  ./doBuild.sh -h|--help   このヘルプを表示

生成物:
  dist-exe/guruguru-avatar-win-v<version>.zip    (guruguru-relay.exe)
  dist-exe/guruguru-avatar-linux-v<version>.zip  (guruguru-relay-linux-x64)
  dist-exe/guruguru-avatar-macos-v<version>.zip  (guruguru-relay-macos-arm64)

環境変数:
  BUN   使用する bun のパス（既定: PATH の bun → なければ ~/.bun/bin/bun）

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

# ── bun を解決（PATH → ~/.bun/bin → エラー） ──────────────────────────────
BUN="${BUN:-}"
if [ -z "$BUN" ]; then
  if command -v bun >/dev/null 2>&1; then BUN="bun"
  elif [ -x "$HOME/.bun/bin/bun" ]; then BUN="$HOME/.bun/bin/bun"
  fi
fi
if [ -z "$BUN" ] || ! "$BUN" --version >/dev/null 2>&1; then
  echo "エラー: bun が見つかりません。"
  echo "  → curl -fsSL https://bun.sh/install | bash でインストールし、"
  echo "    BUN=/path/to/bun ./doBuild.sh で指定するか PATH を通してください。"
  exit 1
fi

# 前提チェック
command -v node >/dev/null 2>&1 || { echo "エラー: node が必要です（dist-local のビルドに使用）"; exit 1; }
command -v zip  >/dev/null 2>&1 || { echo "エラー: zip が必要です（apt install zip）"; exit 1; }

VERSION="$(node -p "require('./package.json').version")"
echo "[info] bun=$("$BUN" --version)  version=$VERSION"

WIN_BIN="dist-exe/guruguru-relay.exe"
LINUX_BIN="dist-exe/guruguru-relay-linux-x64"
MACOS_BIN="dist-exe/guruguru-relay-macos-arm64"

echo "[1/5] 静的配信物をビルド (dist-local, base '/')..."
npm run build:local

echo "[2/5] リレイサーバを 3 ターゲットへクロスコンパイル..."
mkdir -p dist-exe
"$BUN" build --compile --minify --target=bun-windows-x64 server/relay.mjs --outfile "$WIN_BIN"
"$BUN" build --compile --minify --target=bun-linux-x64    server/relay.mjs --outfile "$LINUX_BIN"
"$BUN" build --compile --minify --target=bun-darwin-arm64 server/relay.mjs --outfile "$MACOS_BIN"
chmod +x "$LINUX_BIN" "$MACOS_BIN"

echo "[3/5] 検証: バイナリのサイズと linux 版の実起動..."
for b in "$WIN_BIN" "$LINUX_BIN" "$MACOS_BIN"; do
  sz=$(stat -c%s "$b")
  # Bun ランタイム同梱で数十 MB になる。極端に小さい＝ビルド失敗とみなす。
  [ "$sz" -gt 20000000 ] || { echo "エラー: $b が小さすぎます（size=$sz）。ビルド失敗。"; exit 1; }
  echo "  OK $b (size=$sz)"
done
# linux 版はこの場で実起動して 200 を確認（win/mac は実機が無いのでサイズ検証のみ）。
SMOKE_ROOT="$(mktemp -d)"; printf 'smoke-ok' > "$SMOKE_ROOT/index.html"
SMOKE_PORT=18790
"./$LINUX_BIN" --web-root "$SMOKE_ROOT" --port "$SMOKE_PORT" --host 127.0.0.1 >/dev/null 2>&1 &
SMOKE_PID=$!
sleep 1.2
smoke_code=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" 2>/dev/null || echo "000")
kill "$SMOKE_PID" 2>/dev/null || true
rm -rf "$SMOKE_ROOT"
[ "$smoke_code" = "200" ] || { echo "エラー: linux バイナリのスモークテスト失敗（HTTP $smoke_code）。"; exit 1; }
echo "  OK linux 版スモークテスト (HTTP $smoke_code)"

echo "[4/5] 配布物 (start スクリプト / README.txt) を生成..."

# Windows 用 start.bat（exe の隣で実行・全 ASCII・CRLF）
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

# Linux 用 start.sh
cat > dist-exe/start.sh <<'SH'
#!/usr/bin/env bash
cd "$(dirname "$0")"
chmod +x ./guruguru-relay-linux-x64 2>/dev/null || true
./guruguru-relay-linux-x64 --web-root dist-local --port 8787 --host 127.0.0.1 &
SRV=$!
sleep 2
( xdg-open "http://127.0.0.1:8787/?tx" >/dev/null 2>&1 & ) || true
echo "tx (send) : http://127.0.0.1:8787/?tx"
echo "rx (OBS)  : http://127.0.0.1:8787/?rx"
echo "停止するには Ctrl+C"
wait "$SRV"
SH
chmod +x dist-exe/start.sh

# macOS 用 start.command（Finder のダブルクリックで実行できる）
cat > dist-exe/start.command <<'CMD'
#!/usr/bin/env bash
cd "$(dirname "$0")"
chmod +x ./guruguru-relay-macos-arm64 2>/dev/null || true
./guruguru-relay-macos-arm64 --web-root dist-local --port 8787 --host 127.0.0.1 &
SRV=$!
sleep 2
( open "http://127.0.0.1:8787/?tx" >/dev/null 2>&1 & ) || true
echo "tx (send) : http://127.0.0.1:8787/?tx"
echo "rx (OBS)  : http://127.0.0.1:8787/?rx"
echo "停止するには Ctrl+C"
wait "$SRV"
CMD
chmod +x dist-exe/start.command

cat > dist-exe/README.txt <<'TXT'
ぐるぐるアバター — OBS 用ローカルサーバ（Node も Bun も不要・ランタイム同梱）

【使い方（Windows）】
 1. このフォルダをローカルドライブ（例 C:\guruguru）にコピーする
    ※ zip の中から直接実行せず、必ず「すべて展開」してから
 2. start.bat をダブルクリック
    - 送信側(tx)が既定ブラウザで開きます（カメラを許可）
 3. OBS で「ソース → ブラウザ」を追加し、URL に次を貼る:
       http://localhost:8787/?rx
    背景は透過。tx の画面下に「CEF 接続中（1）」が出れば結線 OK。

【使い方（Linux / macOS）】
 - Linux : 端末で ./start.sh （または実行権を付けてダブルクリック）
 - macOS : start.command をダブルクリック（初回は「制御 + 開く」で許可）

【中身】
   guruguru-relay(.exe / -linux-x64 / -macos-arm64)  中継 + 静的配信（ランタイム同梱・単体動作）
   dist-local/          配信物（camera.html ほか）
   start.bat / start.sh / start.command   起動用

【注意】
 - 必ずローカルドライブから実行する。
 - Windows 初回に SmartScreen が出たら［詳細情報］→［実行］。
 - macOS 初回は Gatekeeper が出たら右クリック→「開く」で許可。
 - ポートを変えるときは start スクリプト内の --port を編集（rx/tx の URL も合わせる）。
 - LAN の別 PC からも繋ぐなら --host を 0.0.0.0 に（要ファイアウォール許可）。
TXT
sed -i 's/\r$//; s/$/\r/' dist-exe/README.txt

echo "[5/5] 配布フォルダを組み立てて zip 化..."
# $1=フォルダ名 $2=同梱バイナリ $3=起動スクリプト $4=出力zip
package() {
  local dir="$1" bin="$2" launcher="$3" zip="$4"
  rm -rf "$dir" "$zip"
  mkdir "$dir"
  # 同一 FS 内はハードリンクで実体コピーを避ける（バイナリ 60-100MB / dist-local 大）。
  cp -l "$bin" "$dir/" 2>/dev/null || cp "$bin" "$dir/"
  cp -rl dist-local "$dir/dist-local" 2>/dev/null || cp -r dist-local "$dir/dist-local"
  cp "$launcher" "$dir/"
  cp dist-exe/README.txt "$dir/"
  zip -r -q "$zip" "$dir"
  rm -rf "$dir"
  echo "  ✓ $zip ($(stat -c%s "$zip") bytes)"
}

package guruguru-obs-win   "$WIN_BIN"   dist-exe/start.bat     "dist-exe/guruguru-avatar-win-v${VERSION}.zip"
package guruguru-obs-linux "$LINUX_BIN" dist-exe/start.sh      "dist-exe/guruguru-avatar-linux-v${VERSION}.zip"
package guruguru-obs-macos "$MACOS_BIN" dist-exe/start.command "dist-exe/guruguru-avatar-macos-v${VERSION}.zip"

echo "✓ ビルド完了（win / linux / macos の 3 zip を dist-exe/ に出力）"

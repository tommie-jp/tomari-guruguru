#!/usr/bin/env bash
# doServer.sh — WS 中継サーバ（server/relay.mjs, 既定 :8787）を起動。
#               ポートが残プロセスで埋まっていたら先に解放する。
#
# 中継サーバは tx(?tx, カメラ＋推論) が送る状態フレーム/config を rx(?rx, OBS の CEF) へ
# 素通しするだけ（docs-camera/08-WS中継の接続手順.md）。dev サーバ(5173) とは別プロセスなので
# 別ターミナルで ./doStartDev.sh と並べて起動する（モードは両者で揃える）。
#
# 接続モード（既定: localhost）:
#   localhost (A): 平文 ws・loopback(127.0.0.1)。同一PC・PC1台2タブの動作確認用（TLS 不要）。
#   tailscale (B): tailscale 証明書で WSS にし 0.0.0.0 へバインド（iPhone/OBS など別端末用。HTTPS
#      ページから ws:// は mixed-content で不可なので wss が要る）。FQDN は固定値を埋め込まず
#      tailscale から動的取得し、証明書 <FQDN>.crt / <FQDN>.key を使う（無ければ発行）。doStartDev.sh と共有。
#
# 使い方:
#   ./doServer.sh             # 既定=localhost（モードA / ws://127.0.0.1:8787）
#   ./doServer.sh -t          # tailscale で WSS + 0.0.0.0（モードB）。--tailscale / --tls / TLS=1 でも可
#   ./doServer.sh -l          # localhost を明示（モードA）。--localhost / --no-tls / NO_TLS=1 でも可
#   PORT=9000 ./doServer.sh   # 別ポート（rx 側には &relay=ws(s)://<host>:9000 を付ける）
#   HOST=0.0.0.0 ./doServer.sh    # バインド先を明示（既定: B=0.0.0.0 / A=127.0.0.1）
#   WEB_ROOT=dist-local ./doServer.sh  # 同ポートで静的配信も相乗り（Windows 単一PC・npm start 相当）
#   DRY_RUN=1 ./doServer.sh   # ポートを空けるだけで起動しない
#   RELAY_CERT=… RELAY_KEY=… ./doServer.sh  # 証明書を明示指定（自動で B）
#   ./doServer.sh -h
set -euo pipefail

print_help() {
  cat <<'HELP'
doServer.sh — WS 中継サーバ（server/relay.mjs, 既定 :8787）を起動。
              ポートが残プロセスで埋まっていたら先に解放する。

接続モード（既定: localhost）:
  localhost (A): 平文 ws・loopback(127.0.0.1)。同一PC・PC1台2タブ用（TLS 不要）。
  tailscale (B): tailscale 証明書で WSS + 0.0.0.0（iPhone/OBS など別端末用）。

使い方:
  ./doServer.sh             既定=localhost（ws://127.0.0.1:8787）
  ./doServer.sh -t          tailscale で WSS + 0.0.0.0。--tailscale / --tls / TLS=1 でも可
  ./doServer.sh -l          localhost を明示。--localhost / --no-tls / NO_TLS=1 でも可
  PORT=9000 ./doServer.sh   別ポート（rx 側には &relay=ws(s)://<host>:9000 を付ける）
  HOST=0.0.0.0 ./doServer.sh    バインド先を明示（既定: B=0.0.0.0 / A=127.0.0.1）
  WEB_ROOT=dist-local ./doServer.sh  同ポートで静的配信も相乗り（Windows 単一PC・npm start 相当）
  DRY_RUN=1 ./doServer.sh   ポートを空けるだけで起動しない
  RELAY_CERT=… RELAY_KEY=… ./doServer.sh  証明書を明示指定（自動で B）

中継サーバは tx(?tx) の状態フレーム/config を rx(?rx, OBS の CEF) へ素通しするだけ。
dev サーバ(5173) とは別プロセスなので、別ターミナルで ./doStartDev.sh と並べて起動する（モードを揃える）。

モードB: tailscale から FQDN を動的取得し RELAY_CERT=<FQDN>.crt RELAY_KEY=<FQDN>.key を
渡して WSS 配信する。証明書が無ければ `tailscale cert <FQDN>` で発行を試みる。tailscale が
無い／取得失敗時は平文 ws(モードA) にフォールバックする。
HELP
}

# A/B モードのフラグ（既定 A）。優先順位は後段で: 明示A > 明示cert > 明示B > 既定A。
MODE_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) print_help; exit 0 ;;
    -l|-a|--no-tls|--http|--localhost|--local) MODE_FLAG="A"; shift ;;
    -t|-b|--tls|--https|--tailscale|--ts)      MODE_FLAG="B"; shift ;;
    *) echo "不明な引数: $1（-h で使い方）" >&2; exit 2 ;;
  esac
done

# スクリプトの場所＝プロジェクト直下。どこから呼んでも正しい場所で npm を実行する。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-${RELAY_PORT:-8787}}"   # 中継ポート（relay.mjs の既定と一致）

# 実効モード解決（既定 A）: 明示A(-a/NO_TLS) > 明示cert(RELAY_*) > 明示B(-b/TLS) > 既定A。
EXPLICIT_CERT=""
if [[ "$MODE_FLAG" == "A" || "${NO_TLS:-}" == "1" ]]; then
  MODE="A"
elif [[ -n "${RELAY_CERT:-}" && -n "${RELAY_KEY:-}" ]]; then
  MODE="B"; EXPLICIT_CERT="1"
elif [[ "$MODE_FLAG" == "B" || "${TLS:-}" == "1" ]]; then
  MODE="B"
else
  MODE="A"
fi

# そのポートで LISTEN しているか。
port_in_use() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE ":$1\$"
}

# ポートを使っている PID 一覧（改行区切り）。lsof → fuser → ss の順に試す。
pids_on_port() {
  local port="$1" pids=""
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -z "$pids" ]] && pids="$(fuser "$port"/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
  [[ -z "$pids" ]] && pids="$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  echo "$pids"
}

# ポートを解放する（使用プロセスを TERM→KILL）。
free_port() {
  local port="$1" pids
  pids="$(pids_on_port "$port")"
  if [[ -z "$pids" ]]; then
    echo "port $port は空いています"
    return 0
  fi
  echo "port $port を使用中: $(echo "$pids" | tr '\n' ' ')→ 終了します"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  for _ in 1 2 3; do
    sleep 1
    if ! port_in_use "$port"; then
      echo "解放しました"
      return 0
    fi
  done
  echo "応答しないため強制終了 (kill -9)"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
  sleep 1
  if port_in_use "$port"; then
    echo "警告: port $port をまだ解放できません（手動で fuser -k $port/tcp を試す）" >&2
  fi
}

# ── Tailscale TLS（iPhone など別端末から wss で繋ぐ手順B 用）─────────────────────
# FQDN は固定値を埋め込まず tailscale から毎回取得する（別マシン・別 tailnet でも動く）。

# Self の FQDN を tailscale から取得（末尾ドット除去）。取れなければ空文字を返す。
# JSON は node で厳密にパースする（このプロジェクトは node 前提なので追加依存なし）。
resolve_tailscale_fqdn() {
  command -v tailscale >/dev/null 2>&1 || return 0
  command -v node >/dev/null 2>&1 || return 0
  tailscale status --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s)?.Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))}catch{}})'
}

# 解決済み $MODE に従って TLS を設定する。WSS(モードB) にできたら 0、平文 ws(モードA) なら 1。
FQDN=""
setup_tls() {
  if [[ "$MODE" != "B" ]]; then
    # モードA: 平文 ws。残っている TLS 環境変数があっても relay に拾わせない。
    unset RELAY_CERT RELAY_KEY 2>/dev/null || true
    echo "モードA: 平文 ws で起動（localhost 専用）。別端末から繋ぐなら -t / --tailscale でモードB"
    return 1
  fi
  FQDN="$(resolve_tailscale_fqdn)"
  if [[ -n "$EXPLICIT_CERT" ]]; then
    echo "TLS: 明示指定の証明書を使用 (${RELAY_CERT})"
    return 0
  fi
  local cert key
  if [[ -z "$FQDN" ]]; then
    echo "警告: モードB ですが tailscale FQDN を取得できません → 平文 ws(モードA) で起動します" >&2
    echo "      （tailscale を起動して再実行。localhost だけなら -l／既定のままで可）" >&2
    return 1
  fi
  cert="${FQDN}.crt"; key="${FQDN}.key"
  if [[ ! -f "$cert" || ! -f "$key" ]]; then
    echo "TLS: 証明書が無いため発行します → tailscale cert ${FQDN}"
    if ! tailscale cert "$FQDN" >/dev/null 2>&1; then
      echo "警告: tailscale cert に失敗 → 平文 ws で起動します。" >&2
      echo "      operator 未設定なら: sudo tailscale cert ${FQDN} && sudo chown \"\$USER\" ${FQDN}.crt ${FQDN}.key" >&2
      echo "      （管理コンソールで DNS の HTTPS Certificates が ON である必要あり）" >&2
      return 1
    fi
  fi
  export RELAY_CERT="$cert" RELAY_KEY="$key"
  echo "TLS: WSS 有効（cert: ${cert} / key: ${key}）"
  return 0
}

cd "$SCRIPT_DIR"
free_port "$PORT"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "(DRY_RUN) ポートのみ解放しました。中継サーバは起動しません。"
  exit 0
fi

# WSS の準備（tailscale 証明書を RELAY_CERT/KEY に設定）。失敗時は平文 ws で続行。
if setup_tls; then SCHEME="wss"; else SCHEME="ws"; fi

# バインド先: 明示(HOST/RELAY_HOST) > TLS時 0.0.0.0（別端末から繋ぐ）> 平文時 127.0.0.1（loopback）。
if [[ -n "${RELAY_HOST:-}" ]]; then
  BIND="$RELAY_HOST"
elif [[ -n "${HOST:-}" ]]; then
  BIND="$HOST"
elif [[ "$SCHEME" == "wss" ]]; then
  BIND="0.0.0.0"
else
  BIND="127.0.0.1"
fi

export RELAY_HOST="$BIND" RELAY_PORT="$PORT"
[[ -n "${WEB_ROOT:-}" ]] && export RELAY_WEB_ROOT="$WEB_ROOT"

# 接続用 URL の案内（FQDN が取れていれば実名で、無ければ localhost で）。
HOSTNAME_FOR_URL="${FQDN:-localhost}"
echo "中継サーバを起動します: ${SCHEME}://${BIND}:${PORT}  (tx=producer, rx=consumer / Ctrl+C で停止)"
echo "  tx: $( [[ "$SCHEME" == "wss" ]] && echo https || echo http )://${HOSTNAME_FOR_URL}:5173/index.html?tx"
echo "  rx: $( [[ "$SCHEME" == "wss" ]] && echo https || echo http )://${HOSTNAME_FOR_URL}:5173/index.html?rx"
[[ "$PORT" != "8787" ]] && echo "  （既定 8787 以外なので rx 側に &relay=${SCHEME}://${HOSTNAME_FOR_URL}:${PORT} を付ける）"

exec npm run relay

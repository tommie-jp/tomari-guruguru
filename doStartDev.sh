#!/usr/bin/env bash
# doStartDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。
#
# vite は strictPort なので 5173 が空いていないと「Port 5173 is already in use」で失敗する。
# 以前の `npm run dev` が残っているとこれが起きるため、起動前に 5173 のリスナーを終了する。
# 終了は TERM（穏当）→ 効かなければ KILL(-9)。検出は lsof → fuser → ss の順に試す。
#
# WS 中継について:
#   dev は vite が WS 中継を同居させる（vite-plugin-relay.mjs / 専用パス /__relay。HMR と衝突しない）。
#   tx/rx も `npm run dev` だけで動くので、通常は別途 doServer.sh / npm run relay を立てる必要は無い。
#   中継 URL の既定はページと同一オリジン（同じ host:port）＋ /__relay。別マシン/別ポート中継を
#   使うときだけ doServer.sh を併用し、rx 側で ?relay=ws(s)://<host>:<port> を明示する。
#   dev 同居中継は既定 loopback 限定。LAN へ公開するときは RELAY_EXPOSE=1（無認証 WS なので私設網のみ）。
#
# 接続モード（既定: localhost）:
#   localhost (A): http で localhost 専用。同一PCでの開発・PC1台2タブの動作確認用（TLS 不要）。
#   tailscale (B): tailscale 証明書で HTTPS 配信。iPhone/OBS など別端末からカメラ tx を開くとき
#      （Safari は secure context でないと getUserMedia が動かない）。FQDN は固定値を埋め込まず
#      tailscale から動的取得し、証明書 <FQDN>.crt / <FQDN>.key を使う（無ければ発行を試みる）。
#
# 使い方:
#   ./doStartDev.sh            # 既定=localhost（http://localhost:5173）
#   ./doStartDev.sh -t         # tailscale で HTTPS（モードB）。--tailscale / --tls / TLS=1 でも可
#   ./doStartDev.sh -l         # localhost を明示（モードA）。--localhost / --no-tls / NO_TLS=1 でも可
#   PORT=5180 ./doStartDev.sh  # 別ポートを空ける（vite.fork.js のポートを変えた時など）
#   DRY_RUN=1 ./doStartDev.sh  # ポートを空けるだけで dev は起動しない
#   VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  # 証明書を明示指定（自動で B）
#   ./doStartDev.sh -h
set -euo pipefail

print_help() {
  cat <<'HELP'
doStartDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。

接続モード（既定: localhost）:
  localhost (A): http で localhost 専用（TLS 不要・同一PC開発用）。http://localhost:5173。
  tailscale (B): tailscale 証明書で HTTPS 配信（iPhone/OBS など別端末用）。

使い方:
  ./doStartDev.sh            既定=localhost（http://localhost:5173）
  ./doStartDev.sh -t         tailscale で HTTPS。--tailscale / --tls / TLS=1 でも可
  ./doStartDev.sh -l         localhost を明示。--localhost / --no-tls / NO_TLS=1 でも可
  PORT=5180 ./doStartDev.sh  別ポートを空ける（vite.fork.js のポートを変えた時など）
  DRY_RUN=1 ./doStartDev.sh  ポートを空けるだけで dev は起動しない
  VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  証明書を明示指定（自動で B）

vite は strictPort なので 5173 が空いていないと起動に失敗する。以前の npm run dev が
残っていると詰まるため、起動前に 5173 のリスナーを終了してから dev を立ち上げる。
終了は TERM（穏当）→ 効かなければ KILL(-9)。

WS 中継: dev は vite が WS 中継を同居（vite-plugin-relay.mjs / 専用パス /__relay）。tx/rx も
npm run dev だけで動くので doServer.sh は不要。別マシン/別ポート中継のときだけ doServer.sh を併用し、
rx 側で ?relay=ws(s)://<host>:<port> を明示する。dev 同居中継は既定 loopback 限定で、LAN 公開は
RELAY_EXPOSE=1（無認証 WS なので私設網のみ）。

モードB: tailscale から FQDN を動的取得し VITE_TLS_CERT=<FQDN>.crt VITE_TLS_KEY=<FQDN>.key を
渡して HTTPS 配信する。証明書が無ければ `tailscale cert <FQDN>` で発行を試みる。tailscale が
無い／取得失敗時は警告のうえ http(モードA) にフォールバックする。
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
PORT="${PORT:-5173}"   # vite dev ポート（vite.fork.js の strictPort と一致）

# 実効モード解決（既定 A）: 明示A(-a/NO_TLS) > 明示cert(VITE_TLS_*) > 明示B(-b/TLS) > 既定A。
EXPLICIT_CERT=""
if [[ "$MODE_FLAG" == "A" || "${NO_TLS:-}" == "1" ]]; then
  MODE="A"
elif [[ -n "${VITE_TLS_CERT:-}" && -n "${VITE_TLS_KEY:-}" ]]; then
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

# ── Tailscale TLS（iPhone など別端末からカメラ tx を HTTPS で開くため）───────────
# FQDN は固定値を埋め込まず tailscale から毎回取得する（別マシン・別 tailnet でも動く）。

# Self の FQDN を tailscale から取得（末尾ドット除去）。取れなければ空文字を返す。
# JSON は node で厳密にパースする（このプロジェクトは node 前提なので追加依存なし）。
resolve_tailscale_fqdn() {
  command -v tailscale >/dev/null 2>&1 || return 0
  command -v node >/dev/null 2>&1 || return 0
  tailscale status --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=JSON.parse(s)?.Self?.DNSName||"";process.stdout.write(n.replace(/\.$/,""))}catch{}})'
}

# 解決済み $MODE に従って TLS を設定する。HTTPS(モードB) にできたら 0、http(モードA) なら 1。
setup_tls() {
  if [[ "$MODE" != "B" ]]; then
    # モードA: 明示的に http。残っている TLS 環境変数があっても vite に拾わせない。
    unset VITE_TLS_CERT VITE_TLS_KEY 2>/dev/null || true
    echo "モードA: http で起動（localhost 専用）。別端末から繋ぐなら -t / --tailscale でモードB"
    return 1
  fi
  if [[ -n "$EXPLICIT_CERT" ]]; then
    echo "TLS: 明示指定の証明書を使用 (${VITE_TLS_CERT})"
    return 0
  fi
  local fqdn cert key
  fqdn="$(resolve_tailscale_fqdn)"
  if [[ -z "$fqdn" ]]; then
    echo "警告: モードB ですが tailscale FQDN を取得できません → http(モードA) で起動します" >&2
    echo "      （tailscale を起動して再実行。localhost だけなら -l／既定のままで可）" >&2
    return 1
  fi
  cert="${fqdn}.crt"; key="${fqdn}.key"
  if [[ ! -f "$cert" || ! -f "$key" ]]; then
    echo "TLS: 証明書が無いため発行します → tailscale cert ${fqdn}"
    if ! tailscale cert "$fqdn" >/dev/null 2>&1; then
      echo "警告: tailscale cert に失敗 → http で起動します。" >&2
      echo "      operator 未設定なら: sudo tailscale cert ${fqdn} && sudo chown \"\$USER\" ${fqdn}.crt ${fqdn}.key" >&2
      echo "      （管理コンソールで DNS の HTTPS Certificates が ON である必要あり）" >&2
      return 1
    fi
  fi
  export VITE_TLS_CERT="$cert" VITE_TLS_KEY="$key"
  echo "TLS: HTTPS 有効（cert: ${cert} / key: ${key}）"
  echo "  iPhone(tx): https://${fqdn}:${PORT}/index.html?tx"
  echo "  OBS(rx)   : https://${fqdn}:${PORT}/index.html?rx"
  return 0
}

cd "$SCRIPT_DIR"
free_port "$PORT"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "(DRY_RUN) ポートのみ解放しました。dev は起動しません。"
  exit 0
fi

# モードB なら HTTPS 配信を準備（失敗時は http へフォールバック）。モードA はそのまま http。
if setup_tls; then
  # モードB（tailscale HTTPS）は iPhone/OBS など別端末から開く前提。別端末は Tailscale 経由＝
  # 非 loopback で来るため、同居中継(/__relay)を既定の loopback 限定のままにすると WS が拒否される。
  # -t を選んだ＝別端末配信の明示なので、中継を tailnet へ公開する（RELAY_EXPOSE=1）。
  # 無認証 WS なので tailscale など ACL で閉じた私設網でのみ使うこと（threat model 同上）。
  export RELAY_EXPOSE=1
  echo "RELAY: 中継(/__relay)を tailnet へ公開 (RELAY_EXPOSE=1)。無認証 WS につき私設網のみで使用。"
  echo "npm run dev を起動します (モードB / port $PORT / Ctrl+C で停止)..."
else
  # モードA（localhost）は同居中継も既定どおり loopback 限定（安全側）。
  echo "npm run dev を起動します (モードA / http://localhost:$PORT / Ctrl+C で停止)..."
fi
exec npm run dev

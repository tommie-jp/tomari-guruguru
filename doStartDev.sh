#!/usr/bin/env bash
# doRunDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。
#
# vite は strictPort なので 5173 が空いていないと「Port 5173 is already in use」で失敗する。
# 以前の `npm run dev` が残っているとこれが起きるため、起動前に 5173 のリスナーを終了する。
# 終了は TERM（穏当）→ 効かなければ KILL(-9)。検出は lsof → fuser → ss の順に試す。
#
# tailscale があれば自動で HTTPS 配信する（iPhone など別端末からカメラ tx を開くため。
# Safari は secure context でないと getUserMedia が動かない）。FQDN は固定値を埋め込まず
# tailscale から動的取得し、証明書 <FQDN>.crt / <FQDN>.key を使う（無ければ発行を試みる）。
#
# 使い方:
#   ./doStartDev.sh            # ポート解放 →(tailscale があれば)HTTPS → npm run dev
#   NO_TLS=1 ./doStartDev.sh   # TLS を使わず http で起動（localhost 専用・手順A）
#   PORT=5180 ./doStartDev.sh  # 別ポートを空ける（vite.fork.js のポートを変えた時など）
#   DRY_RUN=1 ./doStartDev.sh  # ポートを空けるだけで dev は起動しない
#   VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  # 証明書を明示指定（最優先）
#   ./doStartDev.sh -h
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'HELP'
doRunDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。

使い方:
  ./doStartDev.sh            5173 を空けてから（tailscale があれば HTTPS で）npm run dev
  NO_TLS=1 ./doStartDev.sh   TLS を使わず http で起動（localhost 専用・手順A）
  PORT=5180 ./doStartDev.sh  別ポートを空ける（vite.fork.js のポートを変えた時など）
  DRY_RUN=1 ./doStartDev.sh  ポートを空けるだけで dev は起動しない
  VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  証明書を明示指定（最優先）

vite は strictPort なので 5173 が空いていないと起動に失敗する。以前の npm run dev が
残っていると詰まるため、起動前に 5173 のリスナーを終了してから dev を立ち上げる。
終了は TERM（穏当）→ 効かなければ KILL(-9)。

TLS: tailscale から FQDN を動的取得し VITE_TLS_CERT=<FQDN>.crt VITE_TLS_KEY=<FQDN>.key を
渡して HTTPS 配信する。証明書が無ければ `tailscale cert <FQDN>` で発行を試みる。tailscale が
無い／取得失敗時は警告のうえ http で起動する。
HELP
  exit 0
fi

# スクリプトの場所＝プロジェクト直下。どこから呼んでも正しい場所で npm を実行する。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5173}"   # vite dev ポート（vite.fork.js の strictPort と一致）

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

# VITE_TLS_CERT/KEY を解決して export する。HTTPS にできたら 0、http のままなら 1 を返す。
# 優先順位: 明示指定(VITE_TLS_CERT/KEY) > NO_TLS=1(http) > tailscale 自動。
setup_tls() {
  if [[ -n "${VITE_TLS_CERT:-}" && -n "${VITE_TLS_KEY:-}" ]]; then
    echo "TLS: 明示指定を使用 (${VITE_TLS_CERT})"
    return 0
  fi
  if [[ "${NO_TLS:-}" == "1" ]]; then
    echo "TLS: NO_TLS=1 → http で起動（localhost 専用・手順A）"
    return 1
  fi
  local fqdn cert key
  fqdn="$(resolve_tailscale_fqdn)"
  if [[ -z "$fqdn" ]]; then
    echo "警告: tailscale FQDN を取得できません → http で起動します" >&2
    echo "      （iPhone から繋ぐ場合は tailscale を起動して再実行。localhost だけなら無視可）" >&2
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

# HTTPS 配信の準備（tailscale 証明書を VITE_TLS_CERT/KEY に設定）。失敗時は http で続行。
setup_tls || true

echo "npm run dev を起動します (port $PORT / Ctrl+C で停止)..."
exec npm run dev

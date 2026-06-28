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
# 接続モード（既定: both）:
#   both (既定): localhost(http) と tailscale(https) を「1回の起動」で同時提供。
#      vite は http のまま（WSL では 0.0.0.0＝Windows Chrome から localhost で届く）、TLS
#      リバースプロキシ(server/dev-tls-proxy.mjs)を tailscale IP の別ポート(既定 5174=5173+1)に
#      立てて vite へ素通しする。PC=http://localhost:5173、iPhone/OBS=https://<FQDN>:5174。
#      （vite が 0.0.0.0:5173 を掴む＝tailscale IP:5173 も占有するため proxy は別ポートにする）。
#      中継は proxy が loopback から繋ぐので RELAY_EXPOSE 不要＝直接HTTPS(-t)より安全。
#      tailscale/FQDN/証明書が使えない時は localhost 専用 http に自動フォールバックする。
#   localhost (A): http で localhost 専用（TLS 不要）。both を使わず localhost だけにしたいとき。
#   tailscale (B): vite 自身が tailscale 証明書で直接 HTTPS 配信（旧来モード。中継は tailnet 公開）。
#      both と違い localhost(http) は使えない。互換のため残す。
#      FQDN/IP は固定値を埋め込まず tailscale から動的取得し、証明書 <FQDN>.crt / <FQDN>.key を使う。
#
# 使い方:
#   ./doStartDev.sh            # 既定=both（localhost http と tailscale https を同時）
#   ./doStartDev.sh -l         # localhost 専用 http（モードA）。--localhost / --no-tls / NO_TLS=1 でも可
#   ./doStartDev.sh -t         # vite 直接 HTTPS（モードB・旧来）。--tailscale / --tls / TLS=1 でも可
#   ./doStartDev.sh --both     # both を明示（-2 / --dual でも可。無指定と同じ）
#   PORT=5180 ./doStartDev.sh  # 別ポートを空ける（vite.fork.js のポートを変えた時など）
#   DRY_RUN=1 ./doStartDev.sh  # ポートを空けるだけで dev は起動しない
#   VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  # 証明書を明示指定（自動で B・旧来直接HTTPS）
#   ./doStartDev.sh -h
set -euo pipefail

print_help() {
  cat <<'HELP'
doStartDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。

接続モード（既定: both）:
  both (既定): localhost(http) と tailscale(https) を1回の起動で同時提供。vite は http のまま
    （WSL では 0.0.0.0＝Windows Chrome から localhost で届く）、TLS リバースプロキシ
    (server/dev-tls-proxy.mjs)を tailscale IP の別ポート(既定 5174)に立てて vite へ素通し。
    PC=http://localhost:5173 / iPhone・OBS=https://<FQDN>:5174。中継は loopback のまま
    （proxy が loopback から接続）＝ RELAY_EXPOSE 不要。tailscale 不可なら localhost のみに自動降格。
  localhost (A): http で localhost 専用（TLS 不要・同一PC開発用）。http://localhost:5173。
  tailscale (B): vite 自身が tailscale 証明書で直接 HTTPS 配信（旧来モード。localhost は使えない）。

使い方:
  ./doStartDev.sh            既定=both（localhost http と tailscale https を同時）
  ./doStartDev.sh -l         localhost 専用 http。--localhost / --no-tls / NO_TLS=1 でも可
  ./doStartDev.sh -t         vite 直接 HTTPS（旧来）。--tailscale / --tls / TLS=1 でも可
  ./doStartDev.sh --both     both を明示（-2 / --dual でも可）
  PORT=5180 ./doStartDev.sh  別ポートを空ける（vite.fork.js のポートを変えた時など）
  DRY_RUN=1 ./doStartDev.sh  ポートを空けるだけで dev は起動しない
  VITE_TLS_CERT=… VITE_TLS_KEY=… ./doStartDev.sh  証明書を明示指定（自動で B・旧来直接HTTPS）

vite は strictPort なので 5173 が空いていないと起動に失敗する。以前の npm run dev が
残っていると詰まるため、起動前に 5173 のリスナーを終了してから dev を立ち上げる。
終了は TERM（穏当）→ 効かなければ KILL(-9)。

WS 中継: dev は vite が WS 中継を同居（vite-plugin-relay.mjs / 専用パス /__relay）。tx/rx も
npm run dev だけで動くので doServer.sh は不要。both では proxy が loopback から中継に繋ぐので
RELAY_EXPOSE 不要。別マシン/別ポート中継のときだけ doServer.sh を併用し、rx 側で
?relay=ws(s)://<host>:<port> を明示する。

both: tailscale から FQDN と self IP を動的取得し、証明書 <FQDN>.crt/.key で TLS プロキシを
tailscale IP:5173 に立てる（vite は http のまま 127.0.0.1:5173）。証明書が無ければ
`tailscale cert <FQDN>` で発行を試みる。tailscale/FQDN/IP/証明書のどれかが欠けると
localhost 専用 http にフォールバックする。
モードB(旧来): VITE_TLS_CERT=<FQDN>.crt VITE_TLS_KEY=<FQDN>.key を vite に渡して直接 HTTPS 配信する。
HELP
}

# モードフラグ（既定 BOTH）。優先順位は後段で: 明示A > 明示cert > 明示B > 既定BOTH。
MODE_FLAG=""
# モード指定の衝突（-l と -t と --both の併用）は受け付けない。
set_mode() {
  if [[ -n "$MODE_FLAG" && "$MODE_FLAG" != "$1" ]]; then
    echo "モード指定が衝突しています（-l / -t / --both は同時指定不可）" >&2; exit 2
  fi
  MODE_FLAG="$1"
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) print_help; exit 0 ;;
    -l|-a|--no-tls|--http|--localhost|--local) set_mode "A"; shift ;;
    -t|-b|--tls|--https|--tailscale|--ts)      set_mode "B"; shift ;;
    -2|--both|--dual)                          set_mode "BOTH"; shift ;;
    *) echo "不明な引数: $1（-h で使い方）" >&2; exit 2 ;;
  esac
done

# スクリプトの場所＝プロジェクト直下。どこから呼んでも正しい場所で npm を実行する。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5173}"   # vite dev ポート（vite.fork.js の strictPort と一致）

# 実効モード解決（既定 BOTH）: 明示A(-l/NO_TLS) > 明示cert(VITE_TLS_*=旧来直接HTTPS) >
# 明示B(-t/TLS) > 既定BOTH（--both 明示も無指定もここ）。
EXPLICIT_CERT=""
if [[ "$MODE_FLAG" == "A" || "${NO_TLS:-}" == "1" ]]; then
  MODE="A"
elif [[ -n "${VITE_TLS_CERT:-}" && -n "${VITE_TLS_KEY:-}" ]]; then
  MODE="B"; EXPLICIT_CERT="1"
elif [[ "$MODE_FLAG" == "B" || "${TLS:-}" == "1" ]]; then
  MODE="B"
else
  MODE="BOTH"
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

# Self の tailscale IPv4(100.x) を取得。取れなければ空文字。空チェック・表示用。
# 固定値を埋め込まないのは FQDN と同じ理由（別マシン・別 tailnet・IP 再割当に追従）。
resolve_tailscale_ip() {
  command -v tailscale >/dev/null 2>&1 || return 0
  command -v node >/dev/null 2>&1 || return 0
  tailscale status --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const ips=JSON.parse(s)?.Self?.TailscaleIPs||[];const v4=ips.find(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x))||"";process.stdout.write(v4)}catch{}})'
}

# Self の tailscale IP を全部（v4,v6）カンマ区切りで取得。proxy の BIND_IPS に渡す。
# iPhone が v6 を選ぶことがあるので両方に bind する（v4 を先頭にする）。
resolve_tailscale_ips() {
  command -v tailscale >/dev/null 2>&1 || return 0
  command -v node >/dev/null 2>&1 || return 0
  tailscale status --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const ips=JSON.parse(s)?.Self?.TailscaleIPs||[];const v4=ips.filter(x=>/^\d+\.\d+\.\d+\.\d+$/.test(x));const v6=ips.filter(x=>x.includes(":"));process.stdout.write([...v4,...v6].join(","))}catch{}})'
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

# ── both（既定）: FQDN/IP/証明書を解決して TLS プロキシ用にグローバルへ。成功 0 / 失敗 1。──
# 失敗時は呼び出し側が localhost 専用 http にフォールバックする（PC 開発は必ず生かす）。
PROXY_CERT=""; PROXY_KEY=""; PROXY_FQDN=""; PROXY_IP=""; PROXY_IPS=""
setup_both() {
  local fqdn ip ips cert key
  fqdn="$(resolve_tailscale_fqdn)"
  ip="$(resolve_tailscale_ip)"
  ips="$(resolve_tailscale_ips)"
  if [[ -z "$fqdn" || -z "$ip" ]]; then
    echo "警告: tailscale の FQDN/IP を取得できません → localhost 専用 http で起動します" >&2
    echo "      （tailscale を起動して再実行。localhost だけで良いなら -l）" >&2
    return 1
  fi
  cert="${fqdn}.crt"; key="${fqdn}.key"
  if [[ ! -f "$cert" || ! -f "$key" ]]; then
    echo "TLS: 証明書が無いため発行します → tailscale cert ${fqdn}"
    if ! tailscale cert "$fqdn" >/dev/null 2>&1; then
      echo "警告: tailscale cert に失敗 → localhost 専用 http で起動します。" >&2
      echo "      operator 未設定なら: sudo tailscale cert ${fqdn} && sudo chown \"\$USER\" ${fqdn}.crt ${fqdn}.key" >&2
      return 1
    fi
  fi
  # プロキシ(node)が鍵を読めること（root 所有だと EACCES）。読めないなら降格。
  if [[ ! -r "$cert" || ! -r "$key" ]]; then
    echo "警告: 証明書を読めません（権限）→ localhost 専用 http で起動します。" >&2
    echo "      sudo chown \"\$USER\" ${cert} ${key}" >&2
    return 1
  fi
  PROXY_CERT="$cert"; PROXY_KEY="$key"; PROXY_FQDN="$fqdn"; PROXY_IP="$ip"
  PROXY_IPS="${ips:-$ip}"   # v4,v6（取れなければ v4 のみ）
  return 0
}

# PID とその子孫を再帰的に落とす。`npm run dev` は npm→sh -c→vite の3段ツリーで、
# npm を kill しても孫の vite が孤児として port を掴み続けるため、葉から畳む。
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

# both のプロセス（vite と TLS プロキシ）を畳む。EXIT/INT/TERM の trap から呼ぶ。
# EXIT トラップは launch_both が return した後に走るため、PID はグローバルにしておく。
VITE_PID=""; PROXY_PID=""
both_cleanup() {
  [[ -n "$PROXY_PID" ]] && kill_tree "$PROXY_PID"
  [[ -n "$VITE_PID" ]] && kill_tree "$VITE_PID"
  return 0
}

# モードA: localhost 専用 http。
launch_localhost() {
  unset VITE_TLS_CERT VITE_TLS_KEY 2>/dev/null || true
  echo "モードA: http で起動（localhost 専用）。http://localhost:${PORT}/"
  exec npm run dev
}

# モードB(旧来): vite 自身が tailscale 証明書で直接 HTTPS。中継は tailnet 公開。
launch_tailscale_direct() {
  if setup_tls; then
    export RELAY_EXPOSE=1
    echo "RELAY: 中継(/__relay)を tailnet へ公開 (RELAY_EXPOSE=1)。無認証 WS につき私設網のみで使用。"
    echo "npm run dev を起動します (モードB:直接HTTPS / port $PORT / Ctrl+C で停止)..."
  else
    echo "npm run dev を起動します (モードA / http://localhost:$PORT / Ctrl+C で停止)..."
  fi
  exec npm run dev
}

# モードBOTH(既定): vite=http（WSL なら 0.0.0.0。Windows Chrome が localhost で届く）＋
# TLS プロキシ=https(tailscale IP の別ポート) を同時起動。
# ★ 同一ポートに両方は置けない: WSL では vite が 0.0.0.0:PORT を掴む＝tailscale IP:PORT も占有
#   するため、proxy は別ポート(PROXY_PORT=PORT+1)に立てて vite へ素通しする。
#   PC=http://localhost:PORT / iPhone・OBS=https://<FQDN>:PROXY_PORT。
launch_both() {
  if ! setup_both; then
    echo "モードBOTH: tailscale を使えないため localhost 専用 http で起動します。"
    echo "  http://localhost:${PORT}/   （別端末から繋ぐには tailscale を起動して再実行、または -t）"
    unset VITE_TLS_CERT VITE_TLS_KEY 2>/dev/null || true
    exec npm run dev
  fi

  local PROXY_PORT="${PROXY_PORT:-$((PORT + 1))}"
  free_port "$PROXY_PORT"   # 残プロキシがいれば先に解放（vite の PORT は上位で解放済み）

  # vite は http のまま（host は既定＝WSL なら 0.0.0.0 を維持）。https 化はしない。
  unset VITE_TLS_CERT VITE_TLS_KEY 2>/dev/null || true  # vite は https にしない（proxy が TLS 終端）
  unset RELAY_EXPOSE 2>/dev/null || true                # 中継は loopback 限定（proxy が loopback から接続）
  export VITE_ALLOWED_HOST="$PROXY_FQDN"                 # http の vite が proxy 経由の FQDN(Host) を通すように
  export VITE_TX_PUBLIC_ORIGIN="https://${PROXY_FQDN}:${PROXY_PORT}"  # PC の QR が iPhone 到達 URL を指すように

  echo "モードBOTH: localhost(http) と tailscale(https) を同時起動します。"
  echo "  PC(localhost): http://localhost:${PORT}/"
  echo "  iPhone(tx)   : https://${PROXY_FQDN}:${PROXY_PORT}/index.html?tx"
  echo "  OBS(rx)      : https://${PROXY_FQDN}:${PROXY_PORT}/index.html?rx"
  echo "  TLS proxy    : https://${PROXY_IP}:${PROXY_PORT} → http://127.0.0.1:${PORT}（中継は loopback のまま）"

  npm run dev & VITE_PID=$!
  # 終了時に vite と proxy の両方を畳む（孤児リスナー防止）。Ctrl+C は前景プロセス群全体に
  # SIGINT が届くので vite/proxy にも直接届くが、SIGTERM 等のために trap でも確実に落とす。
  trap both_cleanup INT TERM EXIT

  # vite が PORT で listen するまで待つ（早すぎる proxy 接続の ECONNREFUSED を避ける）。
  # 0.0.0.0 で待ち受けても 127.0.0.1 への接続は届くので、アドレスは問わず PORT を見る。
  echo "vite の起動を待っています..."
  local ready=""
  for _ in $(seq 1 50); do
    if ss -ltn 2>/dev/null | grep -qE ":${PORT}\b"; then ready=1; break; fi
    kill -0 "$VITE_PID" 2>/dev/null || break   # vite が死んだら諦める
    sleep 0.3
  done
  if [[ -z "$ready" ]]; then
    echo "警告: vite が起動しませんでした → TLS プロキシは起動しません（localhost のみ）。" >&2
    wait "$VITE_PID" || true
    return
  fi

  CERT="$PROXY_CERT" KEY="$PROXY_KEY" BIND_IPS="$PROXY_IPS" LISTEN_PORT="$PROXY_PORT" TARGET_PORT="$PORT" \
    node server/dev-tls-proxy.mjs & PROXY_PID=$!

  # vite を主プロセスとして待つ。proxy が落ちても localhost 開発は継続（proxy の失敗ログは端末に出る）。
  # vite 終了 or Ctrl+C で trap(both_cleanup) が両方を畳む。
  wait "$VITE_PID" || true
}

cd "$SCRIPT_DIR"
free_port "$PORT"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "(DRY_RUN) ポートのみ解放しました。dev は起動しません。"
  exit 0
fi

# 解決済みモードに応じて起動。BOTH は vite+proxy の2プロセス、A/B は exec で単一プロセス。
case "$MODE" in
  A)    launch_localhost ;;
  B)    launch_tailscale_direct ;;
  BOTH) launch_both ;;
  *)    launch_both ;;
esac

#!/usr/bin/env bash
# doRunDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。
#
# vite は strictPort なので 5173 が空いていないと「Port 5173 is already in use」で失敗する。
# 以前の `npm run dev` が残っているとこれが起きるため、起動前に 5173 のリスナーを終了する。
# 終了は TERM（穏当）→ 効かなければ KILL(-9)。検出は lsof → fuser → ss の順に試す。
#
# 使い方:
#   ./doRunDev.sh            # 5173 を空けてから npm run dev
#   PORT=5180 ./doRunDev.sh  # 別ポートを空ける（vite.fork.js のポートを変えた時など）
#   DRY_RUN=1 ./doRunDev.sh  # ポートを空けるだけで dev は起動しない
#   ./doRunDev.sh -h
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'HELP'
doRunDev.sh — vite dev(5173) を起動。ポートが残プロセスで埋まっていたら先に解放する。

使い方:
  ./doRunDev.sh            5173 を空けてから npm run dev
  PORT=5180 ./doRunDev.sh  別ポートを空ける（vite.fork.js のポートを変えた時など）
  DRY_RUN=1 ./doRunDev.sh  ポートを空けるだけで dev は起動しない

vite は strictPort なので 5173 が空いていないと起動に失敗する。以前の npm run dev が
残っていると詰まるため、起動前に 5173 のリスナーを終了してから dev を立ち上げる。
終了は TERM（穏当）→ 効かなければ KILL(-9)。
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

cd "$SCRIPT_DIR"
free_port "$PORT"

if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo "(DRY_RUN) ポートのみ解放しました。dev は起動しません。"
  exit 0
fi

echo "npm run dev を起動します (port $PORT / Ctrl+C で停止)..."
exec npm run dev

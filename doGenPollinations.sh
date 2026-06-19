#!/usr/bin/env bash
# doGenPollinations.sh — TODO②: 無料 Pollinations で実生成→背景除去→slice を通す。
#
# やること:
#   1) Pollinations(キー不要・無料)でキャラを生成し、背景を除去して
#      5×5×6状態(A〜F)の透過シートを組む (tools/gen_pollinations_sheets.py)
#   2) slice_character_sheets.py でスライス (出力は一時ディレクトリ)
#   3) 25コマ×6=150枚が非空で出たか検証し PASS/FAIL を表示
#
# 目的: 「無料 API で実生成 → 背景除去 → slice」の配管を実画像で通せることの実証。
#       本物の public/slices2 は触らない。出力は既定で残す(生成画像を目視するため)。
#
# 使い方:
#   ./doGenPollinations.sh ["プロンプト"] [--per-state] [--rembg] [--clean]
#     プロンプト   キャラ説明(既定: "chibi anime avatar character")
#     --per-state  A〜F を別シードで個別生成(既定: 1体を使い回す＝API呼出1回)
#     --rembg      背景除去に rembg を使う(要 pip install rembg onnxruntime)
#     --clean      検証後に出力を削除(既定: 残す)
#     -h|--help    このヘルプ
#
# 依存: python3 + Pillow + numpy + scipy + requests、ffmpeg/ffprobe(slice)。
# 注意: 生成画質は無料 Pollinations 相当。25方向の作り分けは未対応(同一キャラを敷き詰め)。
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
}

PROMPT=""
PER_STATE=""
BG=""
CLEAN=0
for a in "$@"; do
  case "$a" in
    -h | --help)
      usage
      exit 0
      ;;
    --per-state) PER_STATE="--per-state" ;;
    --rembg) BG="--bg-method rembg" ;;
    --clean) CLEAN=1 ;;
    --*)
      echo "error: 不明なオプション: $a" >&2
      exit 2
      ;;
    *) PROMPT="$a" ;;
  esac
done
[[ -n "$PROMPT" ]] || PROMPT="chibi anime avatar character"

WORK="$(mktemp -d)"
cleanup() { [[ "$CLEAN" -eq 1 ]] && rm -rf "$WORK"; return 0; }
trap cleanup EXIT

echo "[1/3] Pollinations 生成 + 背景除去 + シート組み立て..."
# shellcheck disable=SC2086 # 空のときは引数を消したいので意図的に非クォート
python3 tools/gen_pollinations_sheets.py --out "$WORK/src" --prompt "$PROMPT" $PER_STATE $BG

echo "[2/3] slice_character_sheets.py でスライス(出力は一時ディレクトリ)..."
python3 tools/slice_character_sheets.py \
  --source "$WORK/src" \
  --sheets-out "$WORK/sheets" \
  --uploads-out "$WORK/uploads" \
  --slices-out "$WORK/slices" \
  --format webp >"$WORK/slice.log" 2>&1 || {
  echo "  slice 実行に失敗。ログ末尾:"
  tail -20 "$WORK/slice.log"
  echo "FAIL: slice ツールがエラー終了。出力を残しました: $WORK"
  trap - EXIT
  exit 1
}

echo "[3/3] 検証..."
EXPECTED=150
count="$(find "$WORK/slices" -name '*.webp' -size +0c | wc -l | tr -d ' ')"
echo "  非空フレーム: ${count} / ${EXPECTED}"

if [[ "$count" -eq "$EXPECTED" ]]; then
  echo "PASS: 無料パス疎通OK (Pollinations→背景除去→slice→${EXPECTED}枚)"
  echo "  生成シート: $WORK/src"
  echo "  スライス  : $WORK/slices"
  if [[ "$CLEAN" -eq 1 ]]; then echo "  (--clean: 出力は削除しました)"; fi
  exit 0
else
  echo "FAIL: フレーム数が不足 (${count}/${EXPECTED})。出力を残しました: $WORK"
  trap - EXIT
  exit 1
fi

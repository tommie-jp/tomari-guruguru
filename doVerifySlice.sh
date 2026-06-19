#!/usr/bin/env bash
# doVerifySlice.sh — 生成AIを使わず0円で slice_character_sheets.py の配管を検証する。
#
# やること:
#   1) 透過5×5ダミーシート(A〜F)を生成 (tools/make_dummy_sheets.py)
#   2) slice_character_sheets.py でスライス
#      ※ 出力はすべて一時ディレクトリ。本物の public/slices2 は一切触らない。
#   3) 25コマ×6状態=150枚が「非空で」「全セル揃って」出力されたか検証し PASS/FAIL を表示。
#
# 目的: 生成AIが成功したと仮定して、その後の「PNG → slice → r{行}c{列}.webp」の
#       配管(plumbing)が正しく動くかを、API キーも課金もなしで先に確定させる。
#
# 使い方:
#   ./doVerifySlice.sh           検証して一時ファイルは削除
#   ./doVerifySlice.sh --keep    出力を残して目視確認する(パスを表示)
#   ./doVerifySlice.sh -h|--help このヘルプ
#
# 依存: python3 + Pillow、ffmpeg/ffprobe(slice ツールが使用)。
set -euo pipefail

# スクリプトの場所(=リポジトリ)へ移動。どこから呼んでも public/ を正しく解決する。
cd "$(dirname "$0")"

usage() {
  cat <<'USAGE'
doVerifySlice.sh — 0円で slice_character_sheets.py の配管を検証する

使い方:
  ./doVerifySlice.sh           検証して一時ファイルは削除
  ./doVerifySlice.sh --keep    出力を残して目視確認(パス表示)
  ./doVerifySlice.sh -h|--help このヘルプ

透過5×5ダミー(A〜F)を作って slice にかけ、150枚(25×6)が
非空かつ全セル揃って出るかを確認する。本物の public/slices2 は触らない。
USAGE
}

KEEP=0
case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  --keep) KEEP=1 ;;
  "") ;;
  *)
    echo "error: 不明な引数: $1" >&2
    usage >&2
    exit 2
    ;;
esac

WORK="$(mktemp -d)"
cleanup() { [[ "$KEEP" -eq 1 ]] || rm -rf "$WORK"; }
trap cleanup EXIT

echo "[1/3] 透過ダミーシート(A〜F)を生成..."
python3 tools/make_dummy_sheets.py --out "$WORK/src" --cell 900

echo "[2/3] slice_character_sheets.py でスライス(出力は一時ディレクトリ)..."
python3 tools/slice_character_sheets.py \
  --source "$WORK/src" \
  --sheets-out "$WORK/sheets" \
  --uploads-out "$WORK/uploads" \
  --slices-out "$WORK/slices" \
  --format webp >"$WORK/slice.log" 2>&1 || {
  echo "  slice 実行に失敗。ログ:"
  cat "$WORK/slice.log"
  echo "FAIL: slice ツールがエラー終了。出力を残しました: $WORK"
  trap - EXIT
  exit 1
}

echo "[3/3] 検証..."
EXPECTED=150
count="$(find "$WORK/slices" -name '*.webp' -size +0c | wc -l | tr -d ' ')"
echo "  非空フレーム: ${count} / ${EXPECTED}"

missing=0
for s in A B C D E F; do
  for r in 0 1 2 3 4; do
    for c in 0 1 2 3 4; do
      f="$WORK/slices/$s/r${r}c${c}.webp"
      if [[ ! -s "$f" ]]; then
        echo "  MISSING: $s/r${r}c${c}.webp"
        missing=$((missing + 1))
      fi
    done
  done
done

if [[ "$count" -eq "$EXPECTED" && "$missing" -eq 0 ]]; then
  echo "PASS: 配管OK (${EXPECTED}/${EXPECTED} フレーム生成・全セル揃い)"
  if [[ "$KEEP" -eq 1 ]]; then
    echo "出力を残しました(--keep): $WORK/slices"
  fi
  exit 0
else
  echo "FAIL: 欠損あり (missing=${missing}, count=${count})"
  echo "調査用に出力を残しました: $WORK"
  trap - EXIT
  exit 1
fi

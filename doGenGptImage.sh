#!/usr/bin/env bash
# doGenGptImage.sh — gpt-image でキャラ参照画像から A〜F(5×5)シートを生成する。
#
# docs/01_画像生成用プロンプト.txt の手動 ChatGPT ワークフローを自動化:
#   キャラ参照画像 ＋ 5×5角度テンプレ ＋ ■最初の指示 → base A を生成し、
#   A から表情差分 B/C/D/E/F を連鎖編集で作る → A〜F.png → (任意で)slice 検証。
#
# 使い方:
#   ./doGenGptImage.sh <キャラ参照画像 or dir> [out-id] [--mini] [--dry-run] [--slice] [--opaque]
#     キャラ参照   作りたいキャラの画像(単体PNG) または複数PNGの入ったフォルダ
#     out-id       出力サブフォルダ名(省略=入力ファイル/フォルダ名)
#     --mini       gpt-image-1-mini で生成(ドラフト/安価)。既定は gpt-image-1.5
#     --dry-run    API を呼ばずダミーで配管検証(キー不要・0円)
#     --slice      生成後に slice_character_sheets.py で 150枚に切って検証
#     --opaque     背景を透過にせずグレーで出す(既定: transparent)
#     -h|--help    このヘルプ
#
# 要件(--dry-run 以外): 環境変数 OPENAI_API_KEY ＋ org verification 済み ＋ pip install openai。
# 注意: 5×5一発生成は崩れやすいので base は n=3 で候補生成→良いものが #0 でなければ
#       tools/gen_gptimage_sheets.py を --pick で再採用する。アップスケールは別途。
set -euo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; }

CHAR=""
OUT_ID=""
MINI=""
DRY=""
DOSLICE=0
BG=""
for a in "$@"; do
  case "$a" in
    -h | --help) usage; exit 0 ;;
    --mini) MINI="--mini" ;;
    --dry-run) DRY="--dry-run" ;;
    --slice) DOSLICE=1 ;;
    --opaque) BG="--background opaque" ;;
    --*) echo "error: 不明なオプション: $a" >&2; exit 2 ;;
    *)
      if [[ -z "$CHAR" ]]; then CHAR="$a"
      elif [[ -z "$OUT_ID" ]]; then OUT_ID="$a"
      else echo "error: 余分な引数: $a" >&2; exit 2; fi
      ;;
  esac
done

if [[ -z "$CHAR" ]]; then
  echo "usage: ./doGenGptImage.sh <キャラ参照画像 or dir> [out-id] [--mini] [--dry-run] [--slice] [--opaque]" >&2
  exit 2
fi
if [[ ! -e "$CHAR" ]]; then
  echo "error: 入力が見つかりません: $CHAR" >&2
  exit 1
fi
[[ -n "$OUT_ID" ]] || OUT_ID="$(basename "${CHAR%.*}")"

WORK="$(mktemp -d)"
OUT="$WORK/$OUT_ID"

echo "[1/2] gpt-image で A〜F シート生成 (model=$([[ -n "$MINI" ]] && echo mini || echo 1.5), dry_run=$([[ -n "$DRY" ]] && echo yes || echo no))..."
# shellcheck disable=SC2086 # 空フラグは消したいので意図的に非クォート
python3 tools/gen_gptimage_sheets.py --character "$CHAR" --out "$OUT" $MINI $DRY $BG

if [[ -n "$DRY" || "$DOSLICE" -eq 1 ]]; then
  echo "[2/2] slice_character_sheets.py で 150枚に切って検証..."
  python3 tools/slice_character_sheets.py \
    --source "$OUT" --sheets-out "$WORK/sheets" \
    --uploads-out "$WORK/uploads" --slices-out "$WORK/slices" --format webp \
    >"$WORK/slice.log" 2>&1 || { echo "slice 失敗:"; tail -20 "$WORK/slice.log"; echo "出力: $WORK"; exit 1; }
  count="$(find "$WORK/slices" -name '*.webp' -size +0c | wc -l | tr -d ' ')"
  echo "  非空フレーム: ${count} / 150"
  if [[ "$count" -eq 150 ]]; then
    echo "PASS: 配管OK (生成→slice→150枚)"
  else
    echo "FAIL: フレーム不足 (${count}/150)"; echo "出力: $WORK"; exit 1
  fi
fi

echo "生成シート: $OUT"
echo "  (A〜F.png ＋ 各候補 {state}_cand*.png)"
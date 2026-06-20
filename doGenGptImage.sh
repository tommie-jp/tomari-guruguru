#!/usr/bin/env bash
# doGenGptImage.sh — gpt-image でキャラ参照画像から A〜F(5×5)シートを生成する。
#
# docs/01_画像生成用プロンプト.txt の手動 ChatGPT ワークフローを自動化:
#   キャラ参照画像 ＋ 5×5角度テンプレ ＋ ■最初の指示 → base A を生成し、
#   A から表情差分 B/C/D/E/F を連鎖編集で作る → A〜F.png(グレー背景)。
#   既定は透過処理なし＝生成シートをそのまま出力し、透過/スライスは後処理で行う。
#
# 使い方:
#   ./doGenGptImage.sh <キャラ参照画像 or dir> [out-id] [--mini] [--dry-run] [--slice] [--transparent]
#     キャラ参照   作りたいキャラの画像(単体PNG) または複数PNGの入ったフォルダ
#     out-id       出力サブフォルダ名(省略=入力ファイル/フォルダ名)
#     --mini       gpt-image-1-mini で生成(ドラフト/安価)。既定は gpt-image-2(Web Images2.0相当)
#     --dry-run    API を呼ばずダミーで配管検証(キー不要・0円)
#     --slice      生成後に背景キー抜き→slice で150枚に切って検証(透過化を伴う)
#     --transparent  gpt-image-1.5 で透過PNGを直接出力(既定は gpt-image-2 のグレー出力)
#     -h|--help    このヘルプ
#
# 既定の流れ: gpt-image-2 でグレー背景の A〜F を生成 → 後処理(例 ./doAvatarConvert.sh)で
#   背景キー抜き＋正規化。要件(--dry-run 以外): OPENAI_API_KEY ＋ org verification ＋ pip install openai。
# 注意: 5×5一発の整列はモデル依存。gpt-image-2 は一発が最良。1.5 は崩れ得るので base は n=3 で
#   候補生成→#0 が悪ければ gen_gptimage_sheets.py を --pick で再採用。アップスケールは別途。
set -euo pipefail
cd "$(dirname "$0")"

usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; }

CHAR=""
OUT_ID=""
MINI=""
MODELOPT=""        # --transparent 時に gpt-image-1.5 + 透過へ切替
TRANSPARENT=""
DRY=""
DOSLICE=0
for a in "$@"; do
  case "$a" in
    -h | --help) usage; exit 0 ;;
    --mini) MINI="--mini" ;;
    --image2) : ;;  # 既定なので no-op(明示指定を許容)
    --transparent) TRANSPARENT=1; MODELOPT="--model gpt-image-1.5 --background transparent" ;;
    --dry-run) DRY="--dry-run" ;;
    --slice) DOSLICE=1 ;;
    --*) echo "error: 不明なオプション: $a" >&2; exit 2 ;;
    *)
      if [[ -z "$CHAR" ]]; then CHAR="$a"
      elif [[ -z "$OUT_ID" ]]; then OUT_ID="$a"
      else echo "error: 余分な引数: $a" >&2; exit 2; fi
      ;;
  esac
done

if [[ -z "$CHAR" ]]; then
  echo "usage: ./doGenGptImage.sh <キャラ参照画像 or dir> [out-id] [--mini] [--dry-run] [--slice] [--transparent]" >&2
  exit 2
fi
if [[ ! -e "$CHAR" ]]; then
  echo "error: 入力が見つかりません: $CHAR" >&2
  exit 1
fi
[[ -n "$OUT_ID" ]] || OUT_ID="$(basename "${CHAR%.*}")"

# --slice はグレー出力だと切れない(slice は透過前提)。透過モデルでなければ自動キー抜きを足す。
AUTOKEY=""
if [[ "$DOSLICE" -eq 1 && -z "$TRANSPARENT" ]]; then AUTOKEY="--auto-key"; fi

WORK="$(mktemp -d)"
OUT="$WORK/$OUT_ID"

MODEL_LABEL="image2(gpt-image-2)"
[[ -n "$MINI" ]] && MODEL_LABEL="mini"
[[ -n "$TRANSPARENT" ]] && MODEL_LABEL="1.5(透過)"
echo "[1/2] gpt-image で A〜F シート生成 (model=$MODEL_LABEL, dry_run=$([[ -n "$DRY" ]] && echo yes || echo no))..."
# shellcheck disable=SC2086 # 空フラグは消したいので意図的に非クォート
python3 tools/gen_gptimage_sheets.py --character "$CHAR" --out "$OUT" $MINI $MODELOPT $DRY $AUTOKEY

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
if [[ -z "$DRY" && "$DOSLICE" -eq 0 && -z "$TRANSPARENT" ]]; then
  echo "後処理(透過＋正規化)の例:"
  echo "  ./doAvatarConvert.sh \"$OUT\" \"$OUT_ID\"   # グレー背景キー抜き→ public/slices2-sheets/$OUT_ID"
fi
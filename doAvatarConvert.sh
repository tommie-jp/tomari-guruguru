#!/usr/bin/env bash
# doAvatarConvert.sh — グレー背景の生5×5シート（A〜F.png）を、camera2 が読む
# 透過済み・正規化済みスプライトシート public/slices2-sheets/<id>/{A..F}.webp へ変換する。
#
# やること:
#   1) フラットなグレー背景を「外周に連結したグレーだけ」キー抜き（キャラ内部のグレーは保つ）
#   2) エッジを ~1.5px フェザーしてグレーのハロを除去
#   3) 5×5 の各図柄を検出し、均一セルの中央へ再配置して正規化
#      （生シートの格子ピッチは 1/5 等分と一致しないため、単純等分だと図柄が隣セルへ
#        はみ出して「上を向くと別の顔の下部が写る」等のブリードが起きる。これを解消する）
#   4) webp 保存（既定 q92）
#
# 使い方（詳細は ./doAvatarConvert.sh -h）:
#   ./doAvatarConvert.sh <source-dir> <avatar-id> [grid] [quality] [bg] [fill]
#
# 例:
#   ./doAvatarConvert.sh assets/02-kesyou_jirai_make 02-kesyou_jirai_make
#   ./doAvatarConvert.sh assets/03-foo 03-foo 1500 90 "143,143,143" 0.95
#
# 引数:
#   source-dir : A.png〜F.png（または A_*.png 等）が入った生シートのフォルダ
#   avatar-id  : 出力先 public/slices2-sheets/<id>/ のID（character-config の avatars[].id と一致させる）
#   grid       : 出力1辺px＝解像度（5の倍数。1セル=grid/5。省略=元寸を5で割り切れる値へ floor）
#   quality    : webp 品質 1〜100（既定 92）
#   bg         : 背景色 "R,G,B"（省略=四隅から自動推定）
#   fill       : 顔の大きさ＝図柄高さのセル比 0〜1（既定 0.82）。grid と独立に顔サイズを決める
#
# 変換後に character-config.js の AVATAR_DEFS へ id を1行足すと、camera2 のセレクタに出る。
set -euo pipefail

show_help() {
  cat <<'HELP'
doAvatarConvert.sh — グレー背景の生5×5シート(A〜F.png)を、camera2 が読む
透過済み・正規化済みスプライトシート public/slices2-sheets/<id>/{A..F}.webp へ変換する。

usage:
  ./doAvatarConvert.sh <source-dir> <avatar-id> [grid] [quality] [bg] [fill]

位置引数です。後ろの引数だけ指定したいときは前の引数も渡す(auto / 92 を明示)。

必須:
  source-dir  A.png〜F.png(または A_*.png 等)が入った生シートのフォルダ
  avatar-id   出力先 public/slices2-sheets/<id>/ のID
              (character-config.js の avatars[].id と一致させる)

任意:
  grid     出力シートの1辺px。1セル = grid / 5。省略=auto。
            - auto : 元シート幅を5で割り切れる値へ floor(例 1254→1250, セル250px)
            - 必ず5の倍数に。割り切れないとセル境界がズレ WARN が出る
            - 大きいほど高精細・大ファイル。ただし元素材が低解像度なら
              拡大してもボケるだけで精細さは増えない
            - 例 : 1250 / 1500(セル300) / 2000(セル400)。2048は5で割れず不可

  quality  webp 品質 1〜100。省略=92。高いほど高画質・大ファイル(method=6 固定)。
            - 92      : 平面イラストでは視覚的にほぼ無劣化(既定)
            - 95〜100 : より高画質   /   80前後 : 軽量化
            - 注意    : 0 はロスレスにならない(最低画質の lossy)

  bg       キー抜きするフラット背景色 "R,G,B"。省略=auto。
            - auto    : 四隅24x24の中央値を背景とみなす(通常これでOK)
            - 外周に連結した近似色(最大ch差<35)だけ透過。キャラ内部の同色は残す
            - 手動    : 四隅に背景以外がある/自動が外れる時。例 "147,146,146"
            - 前提    : 背景は均一フラット(グラデ・影付きは綺麗に抜けない)

  fill     顔の大きさ＝図柄の高さがセルに占める割合(0〜1)。省略=0.82。
            - これが「画面上の顔サイズ」を決めるノブ。grid(解像度)とは独立。
            - 大きいほど顔が枠いっぱいに(例 0.95=ほぼ枠いっぱい / 0.7=小さめ余白多め)
            - grid を上げても顔は大きくならない(grid は解像度のみ)。顔を大きくしたい
              ときは fill を上げる(またはアプリ内のズーム/charSize)
            - 高さ基準で全セル一定にスケールするので向き違いでも頭サイズが揃う

処理:
  1) 背景キー抜き(外周連結グレーのみ)  2) エッジ~1.5pxフェザー
  3) 各図柄を検出して均一セル中央へ正規化(等分スライスのセルブリードを解消)
  4) webp 保存
  変換後 character-config.js の AVATAR_DEFS に id を1行足すとセレクタに出る。

examples:
  ./doAvatarConvert.sh assets/02-kesyou_jirai_make 02-kesyou_jirai_make
  ./doAvatarConvert.sh assets/03-foo 03-foo 1500 96
  ./doAvatarConvert.sh assets/03-foo 03-foo auto 92 "147,146,146"
  ./doAvatarConvert.sh assets/03-foo 03-foo auto 92 auto 0.95   # 顔を大きめに
HELP
}

# -h / --help は詳細ヘルプを表示して正常終了。
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  show_help
  exit 0
fi

if [[ $# -lt 2 ]]; then
  echo "usage: ./doAvatarConvert.sh <source-dir> <avatar-id> [grid] [quality] [bg] [fill]" >&2
  echo "       詳細は ./doAvatarConvert.sh -h" >&2
  exit 2
fi

# スクリプトの場所を基準にする（どこから呼んでも public/ を正しく解決する）。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SRC_DIR="$1"
AVATAR_ID="$2"
GRID="${3:-auto}"
QUALITY="${4:-92}"
BG="${5:-auto}"
FILL="${6:-0.82}"
OUT_DIR="${SCRIPT_DIR}/public/slices2-sheets/${AVATAR_ID}"

if [[ ! -d "$SRC_DIR" ]]; then
  echo "error: source dir not found: $SRC_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

SRC_DIR="$SRC_DIR" OUT_DIR="$OUT_DIR" GRID="$GRID" QUALITY="$QUALITY" BG="$BG" FILL="$FILL" \
python3 - <<'PY'
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from pathlib import Path

SRC = Path(os.environ['SRC_DIR'])
OUT = Path(os.environ['OUT_DIR'])
GRID_ARG = os.environ['GRID']
QUALITY = int(os.environ['QUALITY'])
BG_ARG = os.environ['BG']
FILL = float(os.environ['FILL'])
STATES = ['A', 'B', 'C', 'D', 'E', 'F']

def find_sheet(state):
    # スライスツールと同じ規約: <S>_*.png を優先、無ければ <S>*.png。
    for pat in (f'{state}_*.png', f'{state}*.png'):
        m = sorted(SRC.glob(pat))
        if m:
            return m[0]
    raise FileNotFoundError(f'{state} sheet PNG not found in {SRC}')

def detect_bg(arr):
    # 四隅 24x24 の中央値を背景色とみなす。
    k = 24
    corners = np.concatenate([
        arr[:k, :k].reshape(-1, 3), arr[:k, -k:].reshape(-1, 3),
        arr[-k:, :k].reshape(-1, 3), arr[-k:, -k:].reshape(-1, 3),
    ])
    return np.median(corners, axis=0)

def keyed(path, bg):
    """グレー背景を外周連結だけキー抜き＋~1.5px フェザー。RGBA(H,W,4) と前景bool を返す。"""
    arr = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    diff = np.abs(arr - bg).max(axis=2)
    cand = diff < 35                                   # 背景候補（中間グレー）
    lab, _ = ndimage.label(cand)
    border = set(np.unique(np.concatenate(
        [lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    border.discard(0)
    bgmask = np.isin(lab, list(border))                # 外周連結のグレー＝真の背景
    fg = ~bgmask
    dist = ndimage.distance_transform_edt(fg)          # エッジ ~1.5px フェザー
    alpha = (np.clip(dist / 1.5, 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    return rgba, fg

def split_lines(proj, length):
    """前景プロジェクションから5バンドを検出し、谷の中点で6本の分割線を返す。

    5バンド検出できない場合は等分にフォールバック（第2要素 False）。
    """
    thr = proj.max() * 0.06
    on = proj > thr
    bands = []
    s = None
    for i, v in enumerate(on):
        if v and s is None:
            s = i
        elif (not v) and s is not None:
            bands.append((s, i - 1))
            s = None
    if s is not None:
        bands.append((s, len(on) - 1))
    if len(bands) != 5:
        return [round(k * length / 5) for k in range(6)], False
    lines = [0]
    for k in range(4):
        lines.append((bands[k][1] + bands[k + 1][0]) // 2)
    lines.append(length)
    return lines, True

def pack(rgba, fg, cell, fill):
    """5×5の各図柄を検出し、セル比 fill に正規化して均一セル中央へ再配置する。

    各図柄を「高さ = cell*fill」へスケールしてから中央配置する。これにより
    (1) 位置ズレ＝セルブリードを解消し、(2) grid を変えても顔がセルに占める割合は
    一定（= 画面上の顔サイズは fill だけで決まり、grid は解像度のみを決める）。
    高さ基準でスケールするので向き違い（正面/横顔）でも頭の大きさが揃う。
    横がセルを超える場合だけ横で律速する。
    """
    h, w = fg.shape
    rlines, rok = split_lines(fg.sum(axis=1), h)
    clines, cok = split_lines(fg.sum(axis=0), w)
    target_h = cell * fill          # 図柄の目標高さ（顔サイズの基準）
    max_w = cell * 0.98             # 横はセルを超えない範囲に収める
    out = np.zeros((cell * 5, cell * 5, 4), dtype=np.uint8)
    for r in range(5):
        for c in range(5):
            y0, y1 = rlines[r], rlines[r + 1]
            x0, x1 = clines[c], clines[c + 1]
            sub = fg[y0:y1, x0:x1]
            ys, xs = np.where(sub)
            if len(ys) == 0:
                continue
            fig = rgba[y0 + ys.min():y0 + ys.max() + 1,
                       x0 + xs.min():x0 + xs.max() + 1]
            fh, fw = fig.shape[:2]
            sc = min(target_h / fh, max_w / fw)
            nh, nw = max(1, round(fh * sc)), max(1, round(fw * sc))
            fig = np.asarray(Image.fromarray(fig, 'RGBA').resize((nw, nh), Image.LANCZOS))
            oy = (cell - nh) // 2
            ox = (cell - nw) // 2
            out[r * cell + oy:r * cell + oy + nh,
                c * cell + ox:c * cell + ox + nw] = fig
    return Image.fromarray(out, 'RGBA'), (rok and cok)

# 設定は 1枚目（A）基準で決める。
first = find_sheet('A')
w0 = Image.open(first).size[0]
if BG_ARG == 'auto':
    bg = detect_bg(np.asarray(Image.open(first).convert('RGB')).astype(np.int16))
else:
    bg = np.array([int(x) for x in BG_ARG.split(',')], dtype=np.int16)
grid = (w0 // 5) * 5 if GRID_ARG == 'auto' else int(GRID_ARG)
if grid % 5:
    print(f'  WARN: grid {grid} is not a multiple of 5')
cell = grid // 5

print(f'avatar: {OUT.name}  bg: {tuple(int(v) for v in bg)}  grid: {grid}x{grid} (cell {cell})  fill: {FILL}  q{QUALITY}')
total = 0
for s in STATES:
    rgba, fg = keyed(find_sheet(s), bg)
    img, ok = pack(rgba, fg, cell, FILL)
    dst = OUT / f'{s}.webp'
    img.save(dst, 'WEBP', quality=QUALITY, method=6)
    sz = dst.stat().st_size
    total += sz
    grid_note = 'ok' if ok else 'FALLBACK-uniform(要確認)'
    print(f'  {dst.as_posix()}  5x5={grid_note}  {sz/1024:.0f} KiB')
print(f'total {total/1024/1024:.2f} MiB ({len(STATES)} sheets)')
PY

echo "done. next: add '${AVATAR_ID}' to AVATAR_DEFS in src/character-config.js to show it in the camera2 selector."

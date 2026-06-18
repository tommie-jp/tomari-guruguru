#!/usr/bin/env python3
"""既存の正規化済みスライス webp（<slices>/<状態>/r{行}c{列}.webp）を、
状態ごとに 5x5 の1枚スプライトシートへ詰め直すツール。

camera2.html（PixiJS スプライト描画版・複数アバター対応）が参照する
public/slices2-sheets/<アバターID>/<状態>.webp を生成する。スライスはスライスツール
（tools/slice_character_sheets.py）の時点で既にセル単位で正規化済み
（中心X・足元Y を 1200x1200 キャンバスへアンカリング済み）なので、ここでは
検出や再アンカリングをせず、等サイズセルをそのまま格子状に並べるだけでよい。

使い方:
    python tools/pack_sheet.py                       # 既定アバター(01-tomari)を 768px/q92 で
    python tools/pack_sheet.py --avatar 02-foo \\
        --slices 新キャラ資料/02-foo/slices            # 新アバター（生スライスは git 非追跡でよい）
    python tools/pack_sheet.py --cell-out 1200       # 元解像度のまま（高品質・重い）
    python tools/pack_sheet.py --quality 0           # lossless（さらに重い）

出力先は <out>/<avatar>/<状態>.webp（既定 public/slices2-sheets/01-tomari/*.webp）。
character-config.js の avatars[].id とディレクトリ名を一致させること。

既定が 768px/q92 なのは、アバター表示が最大でも 1200px・通常はもっと小さく、
6枚合計 ~5.6MB（個別150枚 ~6.8MB より軽い）に収まり、平面イラストでは
q92 lossy が視覚的に lossless と区別できないため。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

# 目開け×口[とじ/中間/開け]=A/B/C, 目閉じ×口[とじ/中間/開け]=D/E/F
STATES = ["A", "B", "C", "D", "E", "F"]
ROWS = 5
COLS = 5


def load_cells(state_dir: Path) -> tuple[list[list[Image.Image]], int, int]:
    """state_dir 配下の r{row}c{col}.webp を 5x5 で読み込む。

    全セルが同寸であることを検証し、(cells, cell_w, cell_h) を返す。
    """
    cells: list[list[Image.Image]] = []
    cell_w = cell_h = None
    for r in range(ROWS):
        row_imgs: list[Image.Image] = []
        for c in range(COLS):
            path = state_dir / f"r{r}c{c}.webp"
            if not path.exists():
                raise FileNotFoundError(f"missing slice: {path}")
            img = Image.open(path).convert("RGBA")
            if cell_w is None:
                cell_w, cell_h = img.size
            elif img.size != (cell_w, cell_h):
                raise ValueError(
                    f"cell size mismatch at {path}: {img.size} != {(cell_w, cell_h)}"
                )
            row_imgs.append(img)
        cells.append(row_imgs)
    return cells, cell_w, cell_h


def pack_state(
    slices_dir: Path,
    out_dir: Path,
    state: str,
    cell_out: int,
    quality: int,
) -> Path:
    cells, cell_w, cell_h = load_cells(slices_dir / state)

    # 出力セルサイズ（0 なら元のまま）。正方セル前提でアスペクトは保つ。
    out_w = cell_out if cell_out > 0 else cell_w
    out_h = cell_out if cell_out > 0 else cell_h

    sheet = Image.new("RGBA", (out_w * COLS, out_h * ROWS), (0, 0, 0, 0))
    for r in range(ROWS):
        for c in range(COLS):
            cell = cells[r][c]
            if (out_w, out_h) != (cell_w, cell_h):
                cell = cell.resize((out_w, out_h), Image.LANCZOS)
            sheet.paste(cell, (c * out_w, r * out_h))

    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{state}.webp"
    if quality > 0:
        sheet.save(out_path, "WEBP", quality=quality, method=6)
    else:
        sheet.save(out_path, "WEBP", lossless=True, method=6)
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--avatar",
        default="01-tomari",
        help="アバターID（出力サブフォルダ名 = character-config の avatars[].id）。既定 01-tomari。",
    )
    parser.add_argument("--slices", default="public/slices2", type=Path)
    parser.add_argument(
        "--out",
        default="public/slices2-sheets",
        type=Path,
        help="シート出力のベース。実体は <out>/<avatar>/<状態>.webp。",
    )
    parser.add_argument(
        "--cell-out",
        default=768,
        type=int,
        help="出力1セルの px（0=元サイズ維持）。既定 768。",
    )
    parser.add_argument(
        "--quality",
        default=92,
        type=int,
        help="webp 品質（0=lossless）。1〜100 で lossy。既定 92。",
    )
    args = parser.parse_args()

    # 出力はアバターごとのサブフォルダへ（public/slices2-sheets/<avatar>/<状態>.webp）。
    out_dir = args.out / args.avatar

    total = 0
    print(f"avatar: {args.avatar}  slices: {args.slices.as_posix()}")
    for state in STATES:
        out_path = pack_state(args.slices, out_dir, state, args.cell_out, args.quality)
        size = out_path.stat().st_size
        total += size
        with Image.open(out_path) as im:
            dims = im.size
        print(f"  {out_path.as_posix()} {dims[0]}x{dims[1]} {size / 1024:.0f} KiB")
    print(f"total {total / 1024 / 1024:.2f} MiB ({len(STATES)} sheets)")


if __name__ == "__main__":
    main()

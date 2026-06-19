#!/usr/bin/env python3
"""透過5×5ダミーシート(A〜F)を生成する — slice_character_sheets.py の配管検証用。

生成AIを使わず0円で、後半パイプライン
(PNG → slice_character_sheets.py → 25コマ×6) の動作を確認するためのダミー素材。

各セルに「分離した不透明ブロブ(楕円＋ラベル)」を1つ描く。背景は完全透過(alpha=0)。
既定の component-mode(連結成分→セル割り当て)が正しく25コマを切り出せる前提:
  - 背景が透過(alpha=0)で、各セルに1つの連結した不透明領域があること
  - 隣のセルのブロブと連結しないよう余白(margin)で分離すること
を満たすように描く。塗りは彩度のある色にして gray-residue 除去に巻き込まれないようにする。
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

STATES = ["A", "B", "C", "D", "E", "F"]

# 状態ごとの塗り色(彩度を持たせる＝低彩度グレー残渣の除去に巻き込まれない)。
STATE_COLORS = {
    "A": (220, 80, 80),
    "B": (220, 150, 60),
    "C": (200, 200, 60),
    "D": (80, 180, 100),
    "E": (70, 150, 220),
    "F": (160, 90, 200),
}


def load_font(size: int) -> ImageFont.ImageFont:
    for name in ("DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    # スケーラブルな既定フォント(Pillow 10+)。サイズ指定で読めなければ最小フォント。
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def draw_centered_text(
    draw: ImageDraw.ImageDraw, cx: int, cy: int, text: str, font: ImageFont.ImageFont
) -> None:
    # anchor 非対応フォントでも中央に置けるよう bbox から手動で中央寄せする。
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    tw, th = right - left, bottom - top
    draw.text((cx - tw / 2 - left, cy - th / 2 - top), text, fill=(20, 20, 20, 255), font=font)


def make_sheet(state: str, cell: int, margin: int) -> Image.Image:
    side = cell * 5
    img = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    color = STATE_COLORS.get(state, (150, 150, 150)) + (255,)
    font = load_font(max(12, cell // 9))
    radius = cell // 2 - margin
    for row in range(5):
        for col in range(5):
            cx = col * cell + cell // 2
            cy = row * cell + cell // 2
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color)
            draw_centered_text(draw, cx, cy, f"{state} r{row}c{col}", font)
    return img


def main() -> None:
    parser = argparse.ArgumentParser(description="透過5×5ダミーシート(A〜F)を生成する")
    parser.add_argument("--out", default=Path("/tmp/dummy_sheets"), type=Path)
    parser.add_argument(
        "--cell", default=900, type=int, help="1セルの1辺px(slice の --cell と合わせる)"
    )
    parser.add_argument(
        "--margin",
        default=120,
        type=int,
        help="セル内の余白px(隣のブロブと連結させないための分離幅)",
    )
    args = parser.parse_args()

    if args.margin * 2 >= args.cell:
        parser.error(f"margin({args.margin}) が大きすぎます。cell({args.cell}) の半分未満にしてください")

    args.out.mkdir(parents=True, exist_ok=True)
    for state in STATES:
        img = make_sheet(state, args.cell, args.margin)
        dst = args.out / f"{state}_dummy.png"
        img.save(dst)
        print(f"  {dst}  {img.size[0]}x{img.size[1]}")
    print(f"done: {len(STATES)} sheets -> {args.out}")


if __name__ == "__main__":
    main()

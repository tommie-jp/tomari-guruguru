#!/usr/bin/env python3
"""フラットなグレー背景のPNGを透過処理する(外周に連結した背景だけキー抜き)。

head-grid テンプレートのような「均一グレー背景＋前景」の画像から、外周に連結した
背景グレーだけを透過させる。頭部の内部にある同系グレー(陰影)は前景として保持する。
doAvatarConvert.sh の keyed() と同方式:
  1) 背景色との色差が threshold 未満の画素を「背景候補」とする
  2) そのうち画像の外周に連結したものだけを真の背景として透過(内部の陰影は残す)
  3) エッジを feather px フェザーしてグレーのハロを抑える
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def detect_bg(arr: np.ndarray, k: int = 24) -> np.ndarray:
    # 四隅 k×k の中央値を背景色とみなす。
    corners = np.concatenate(
        [
            arr[:k, :k].reshape(-1, 3),
            arr[:k, -k:].reshape(-1, 3),
            arr[-k:, :k].reshape(-1, 3),
            arr[-k:, -k:].reshape(-1, 3),
        ]
    )
    return np.median(corners, axis=0)


def alpha_from_bg(
    arr: np.ndarray, bg: np.ndarray, threshold: int, feather: float
) -> np.ndarray:
    """外周に連結した背景だけを透過させたアルファ(uint8 H×W)を返す。

    arr: RGB配列(H,W,3)。bg: 背景色(3,)。背景色との色差が threshold 未満の画素を
    背景候補とし、そのうち画像の外周に連結したものだけを背景(alpha=0)にする。
    内部にある同系色(服・陰影など)は前景として保持する。エッジは feather px フェザー。
    """
    arr = arr.astype(np.int16)
    diff = np.abs(arr - bg).max(axis=2)
    cand = diff < threshold  # 背景候補(背景色に近い画素)
    lab, _ = ndimage.label(cand)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    border.discard(0)
    bgmask = np.isin(lab, list(border))  # 外周連結のみ＝真の背景
    fg = ~bgmask
    dist = ndimage.distance_transform_edt(fg)
    return (np.clip(dist / max(feather, 1e-6), 0, 1) * 255).astype(np.uint8)


def key_background(
    path: Path, bg: np.ndarray | None, threshold: int, feather: float
) -> tuple[Image.Image, np.ndarray]:
    arr = np.asarray(Image.open(path).convert("RGB"))
    if bg is None:
        bg = detect_bg(arr.astype(np.int16))
    alpha = alpha_from_bg(arr, bg, threshold, feather)
    rgba = np.dstack([arr.astype(np.uint8), alpha])
    return Image.fromarray(rgba, "RGBA"), alpha


def main() -> None:
    parser = argparse.ArgumentParser(
        description="フラットグレー背景PNGを透過処理(外周連結背景のみキー抜き)"
    )
    parser.add_argument("inputs", nargs="+", type=Path, help="入力PNG(複数可)")
    parser.add_argument(
        "--out-dir", type=Path, default=None, help="出力先(省略=入力と同じ場所に上書き)"
    )
    parser.add_argument(
        "--suffix", default="", help="出力ファイル名に付ける接尾辞(例: -alpha)。省略=同名"
    )
    parser.add_argument(
        "--bg", default="auto", help='背景色 "R,G,B" または auto(四隅から推定)'
    )
    parser.add_argument(
        "--threshold", type=int, default=35, help="背景とみなす色差の上限(既定35)"
    )
    parser.add_argument(
        "--feather", type=float, default=1.5, help="エッジのフェザー幅px(既定1.5)"
    )
    args = parser.parse_args()

    bg = (
        None
        if args.bg == "auto"
        else np.array([int(x) for x in args.bg.split(",")], dtype=np.int16)
    )

    for src in args.inputs:
        img, alpha = key_background(src, bg, args.threshold, args.feather)
        out_dir = args.out_dir or src.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f"{src.stem}{args.suffix}{src.suffix}"
        img.save(dst)
        transparent = (alpha == 0).mean() * 100
        opaque = (alpha == 255).mean() * 100
        print(f"  {src.name} -> {dst}  透過 {transparent:.1f}% / 不透明 {opaque:.1f}%")


if __name__ == "__main__":
    main()

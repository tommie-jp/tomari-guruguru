#!/usr/bin/env python3
"""Pollinations(キー不要・無料)でキャラを生成し、背景除去して5×5シート(A〜F)を組む。

TODO② の実装: 無料 API で実生成 → 背景除去 → (slice の入力となる)シート組み立て。
slice は 25セル×6状態(A〜F)が埋まっている必要があるため、生成した1体のキャラを
各セルに敷き詰めて 4500×4500(=cell*5) の透過シートを A〜F 分つくる。
※ 25方向の「作り分け」は per-cell 生成への拡張ポイント。本スクリプトの目的は
  「無料 API の疎通＋背景除去＋slice 配管」を実画像で通すこと。

背景除去:
  - color (既定): 生成プロンプトで単色背景を指定し、外周連結の同色をキー抜き。
                  依存ゼロ(rembg 不要)。AI背景は完全フラットでないので簡易だが、
                  外周連結方式なので服など内部の同系色は保持される。
  - rembg        : rembg があればセグメンテーションで高品質に除去。
"""
from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path
from urllib.parse import quote

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from key_template_bg import alpha_from_bg, detect_bg  # noqa: E402 (パス調整後に import)

STATES = ["A", "B", "C", "D", "E", "F"]
# 表情状態のヒント(--per-state 時のみプロンプトに足す)。AIは厳密でないが種にする。
STATE_HINT = {
    "A": "eyes open, mouth closed",
    "B": "eyes open, mouth slightly open",
    "C": "eyes open, mouth open",
    "D": "eyes closed, mouth closed",
    "E": "eyes closed, mouth slightly open",
    "F": "eyes closed, mouth open",
}
POLLINATIONS = "https://image.pollinations.ai/prompt/"
# 単色背景＋中央＋全身。color キーが効きやすいように単色背景・影なしを指定する。
CHROMA_HINT = "solid flat chroma key green background, centered, full body, no shadow"


def fetch_pollinations(
    prompt: str, seed: int, model: str, size: int, timeout: int, retries: int
) -> Image.Image:
    url = POLLINATIONS + quote(prompt)
    params = {
        "model": model,
        "width": size,
        "height": size,
        "seed": seed,
        "nologo": "true",
        "private": "true",
    }
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            img = Image.open(io.BytesIO(resp.content))
            img.load()
            return img.convert("RGB")
        except Exception as exc:  # noqa: BLE001 - ネットワーク系を広く拾いリトライ
            last = exc
            print(f"  retry {attempt}/{retries}: {exc}", file=sys.stderr)
            time.sleep(3)
    raise RuntimeError(f"Pollinations 取得失敗: {last}")


def remove_bg(
    img_rgb: Image.Image, method: str, threshold: int, feather: float
) -> Image.Image:
    if method == "rembg":
        try:
            from rembg import remove
        except ImportError as exc:
            raise SystemExit(
                "rembg が無い。`pip install rembg onnxruntime` を入れるか --bg-method color"
            ) from exc
        return remove(img_rgb.convert("RGBA"))
    # color: 外周連結の単色背景をキー抜き(背景色は四隅から自動推定)
    arr = np.asarray(img_rgb)
    bg = detect_bg(arr.astype(np.int16))
    alpha = alpha_from_bg(arr, bg, threshold, feather)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def crop_to_alpha(img_rgba: Image.Image) -> Image.Image:
    bbox = img_rgba.getbbox()  # alpha>0 の最小矩形
    return img_rgba.crop(bbox) if bbox else img_rgba


def tile_into_sheet(char_rgba: Image.Image, cell: int, margin: int) -> Image.Image:
    """透過キャラを 5×5 の各セル中央に敷き詰めた cell*5 角の透過シートを返す。

    各タイルは (cell-2*margin) に収まるよう縮小し、隣と連結しないよう余白を空ける。
    これで slice の component-mode が25セルを分離検出できる。
    """
    char = crop_to_alpha(char_rgba)
    inner = cell - 2 * margin
    scale = min(inner / char.width, inner / char.height)
    nw, nh = max(1, round(char.width * scale)), max(1, round(char.height * scale))
    tile = char.resize((nw, nh), Image.LANCZOS)
    side = cell * 5
    sheet = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    for row in range(5):
        for col in range(5):
            cx = col * cell + cell // 2
            cy = row * cell + cell // 2
            sheet.alpha_composite(tile, (cx - nw // 2, cy - nh // 2))
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Pollinationsでキャラ生成→背景除去→5×5シート(A〜F)を組む"
    )
    parser.add_argument("--out", type=Path, default=Path("/tmp/poll_sheets"))
    parser.add_argument("--prompt", default="chibi anime avatar character")
    parser.add_argument("--model", default="flux")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--gen-size", type=int, default=768, help="Pollinations の生成解像度")
    parser.add_argument("--cell", type=int, default=900, help="slice の --cell と合わせる")
    parser.add_argument("--margin", type=int, default=90, help="セル内余白px(タイル分離)")
    parser.add_argument("--bg-method", choices=["color", "rembg"], default="color")
    parser.add_argument("--threshold", type=int, default=60, help="color キーの色差しきい値")
    parser.add_argument("--feather", type=float, default=1.5)
    parser.add_argument(
        "--per-state",
        action="store_true",
        help="A〜F を別シードで個別生成(既定: 1体を全状態で使い回す＝API呼出1回)",
    )
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    def make_char(state: str, seed: int) -> Image.Image:
        hint = STATE_HINT[state] if args.per_state else "front view"
        prompt = f"{args.prompt}, {hint}, {CHROMA_HINT}"
        print(f"[{state}] 生成 seed={seed} model={args.model} ...")
        rgb = fetch_pollinations(
            prompt, seed, args.model, args.gen_size, args.timeout, args.retries
        )
        rgba = remove_bg(rgb, args.bg_method, args.threshold, args.feather)
        alpha = np.asarray(rgba)[:, :, 3]
        print(
            f"     背景除去({args.bg_method}): "
            f"透過{(alpha == 0).mean() * 100:.1f}% 不透明{(alpha == 255).mean() * 100:.1f}%"
        )
        return rgba

    base: Image.Image | None = None
    for i, state in enumerate(STATES):
        if args.per_state:
            char = make_char(state, args.seed + i)
        else:
            if base is None:
                base = make_char(state, args.seed)
            char = base
        sheet = tile_into_sheet(char, args.cell, args.margin)
        dst = args.out / f"{state}_pollinations.png"
        sheet.save(dst)
        print(f"     -> {dst} {sheet.size[0]}x{sheet.size[1]}")

    print(f"done: {len(STATES)} sheets -> {args.out}")


if __name__ == "__main__":
    main()

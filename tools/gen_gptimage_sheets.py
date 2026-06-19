#!/usr/bin/env python3
"""gpt-image(1.5 / mini)でキャラ参照画像から5×5×6状態(A〜F)シートを生成する。

docs/01_画像生成用プロンプト.txt の手動ワークフローを OpenAI images.edit で自動化する。
  base A(目開け・口とじ) を「キャラ参照画像 ＋ 5×5角度テンプレ ＋ ■最初の指示」で生成し、
  A から表情差分を連鎖編集でつくる(累積ドリフトを抑える浅い枝):
    A --目を閉じる--> D
    A --口を中間---> B      A --口を開ける--> C
    D --口を中間---> E      D --口を開ける--> F

要件:
  - 環境変数 OPENAI_API_KEY(ハードコード禁止) ＋ org verification 済みアカウント。
  - openai パッケージ(`pip install openai`)。※ --dry-run は不要。
プロンプトは docs/01_画像生成用プロンプト.txt から固定で読む(■最初の指示＋差分指示)。

--dry-run: API を一切呼ばず、各状態のダミーシートを使って
  「プロンプト抽出 → 連鎖 → 保存 → (slice)」の配管を0円で検証する。
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import re
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_dummy_sheets import make_sheet  # noqa: E402 (パス調整後に import)

DEFAULT_PROMPT_FILE = Path("docs/01_画像生成用プロンプト.txt")
DEFAULT_TEMPLATE = Path("docs/01_画像生成用テンプレ.png")

# 連鎖の組み立て: (state, parent, diff_key)。parent=None は base(■最初の指示)。
CHAIN = [
    ("A", None, None),
    ("D", "A", "close_eyes"),
    ("B", "A", "mouth_mid"),
    ("C", "A", "mouth_open"),
    ("E", "D", "mouth_mid"),
    ("F", "D", "mouth_open"),
]
# 差分の補強(部分適用・ドリフト対策)。固定の差分指示に付け足す。
DIFF_REINFORCE = (
    "全てのポジション(25マス全て)に適用してください。"
    "顔の角度・髪型・髪飾り・服装・配色・絵柄・線画・配置・顔のサイズは変更しないでください。"
)
# プロンプトファイルから抽出できなかった場合のフォールバック(ファイル内の文言準拠)。
FALLBACK_DIFF = {
    "close_eyes": "この画像の全てのポジションの目を閉じている目にして欲しい。目以外は変更しないで",
    "mouth_open": "この画像の全てのポジションの開けている口を「あ」の口で開けている口にして欲しい。口以外は変更しないで",
    "mouth_mid": "この画像の全てのポジションの開けている口小さく開けている口にして欲しい。口以外は変更しないで",
}


def extract_base_prompt(text: str) -> str:
    m = re.search(r"■最初の指示\s*-+\s*(.*?)\s*-+\s*■2回目", text, re.S)
    if not m:
        raise SystemExit("プロンプトファイルから「■最初の指示」を抽出できませんでした")
    return m.group(1).strip()


def extract_diffs(text: str) -> dict[str, str]:
    diffs = dict(FALLBACK_DIFF)
    for line in (ln.strip() for ln in text.splitlines()):
        if not line.startswith("この画像の"):
            continue
        if "目を閉じ" in line:
            diffs["close_eyes"] = line
        elif "「あ」" in line:
            diffs["mouth_open"] = line
        elif "小さく開けて" in line:
            diffs["mouth_mid"] = line
    return diffs


def collect_character_images(path: Path) -> list[Path]:
    if path.is_dir():
        imgs = sorted(path.glob("*.png"))
    else:
        imgs = [path]
    # Windows 副産物(:Zone.Identifier)・空ファイルを除外。
    return [p for p in imgs if p.is_file() and p.stat().st_size > 0 and "Zone.Identifier" not in p.name]


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def gptimage_edit(
    client,
    model: str,
    image_paths: list[Path],
    prompt: str,
    size: str,
    n: int,
    quality: str | None,
    background: str | None,
    input_fidelity: str | None,
    retries: int = 4,
) -> list[bytes]:
    """images.edit を複数参照画像で呼び、b64 をバイト列のリストで返す。"""
    last: Exception | None = None
    for attempt in range(1, retries + 1):
        files = [open(p, "rb") for p in image_paths]  # noqa: SIM115 - finally で閉じる
        try:
            kwargs: dict = {
                "model": model,
                "image": files if len(files) > 1 else files[0],
                "prompt": prompt,
                "size": size,
                "n": n,
            }
            if quality:
                kwargs["quality"] = quality
            if background:
                kwargs["background"] = background
            if input_fidelity:
                kwargs["input_fidelity"] = input_fidelity
            resp = client.images.edit(**kwargs)
            return [base64.b64decode(d.b64_json) for d in resp.data]
        except Exception as exc:  # noqa: BLE001 - 429/5xx を指数バックオフで再試行
            last = exc
            wait = 2 ** attempt
            print(f"  retry {attempt}/{retries} ({exc}); {wait}s 待機", file=sys.stderr)
            time.sleep(wait)
        finally:
            for f in files:
                f.close()
    raise RuntimeError(f"images.edit 失敗: {last}")


def dryrun_generate(state: str, n: int, cell: int, margin: int) -> list[bytes]:
    """API を呼ばず、状態ラベル付きのダミー5×5シートを n 枚ぶん返す(配管検証用)。"""
    data = png_bytes(make_sheet(state, cell, margin))
    return [data] * n


def main() -> None:
    parser = argparse.ArgumentParser(
        description="gpt-imageでキャラ参照→A〜F(5×5)シートを生成"
    )
    parser.add_argument("--character", required=True, type=Path, help="キャラ参照画像 or そのフォルダ")
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--prompt-file", type=Path, default=DEFAULT_PROMPT_FILE)
    parser.add_argument("--out", type=Path, default=Path("/tmp/gptimage_sheets"))
    parser.add_argument("--model", default="gpt-image-1.5")
    parser.add_argument("--mini", action="store_true", help="model を gpt-image-1-mini にする(ドラフト/安価)")
    parser.add_argument("--n", type=int, default=3, help="base A の候補数(良いものを選ぶ)")
    parser.add_argument("--diff-n", type=int, default=2, help="差分各段の候補数")
    parser.add_argument("--pick", type=int, default=0, help="採用する候補index(既定0)")
    parser.add_argument("--size", default="1024x1024")
    parser.add_argument("--quality", default="high", choices=["low", "medium", "high"])
    parser.add_argument("--background", default="transparent", choices=["transparent", "opaque"])
    parser.add_argument("--input-fidelity", default="high", choices=["high", "low", "none"])
    parser.add_argument("--cell", type=int, default=900, help="dry-run ダミーの1セルpx")
    parser.add_argument("--margin", type=int, default=120)
    parser.add_argument("--dry-run", action="store_true", help="APIを呼ばず配管だけ検証")
    args = parser.parse_args()

    model = "gpt-image-1-mini" if args.mini else args.model
    input_fidelity = None if args.input_fidelity == "none" else args.input_fidelity

    text = args.prompt_file.read_text(encoding="utf-8")
    base_prompt = extract_base_prompt(text)
    diffs = extract_diffs(text)

    char_imgs = collect_character_images(args.character)
    if not char_imgs:
        raise SystemExit(f"キャラ参照画像が見つかりません: {args.character}")
    if not args.dry_run and not args.template.is_file():
        raise SystemExit(f"テンプレ画像が見つかりません: {args.template}")

    args.out.mkdir(parents=True, exist_ok=True)

    client = None
    if not args.dry_run:
        if not os.environ.get("OPENAI_API_KEY"):
            raise SystemExit("OPENAI_API_KEY が未設定です。環境変数に設定してください(ハードコード禁止)")
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise SystemExit("openai が無い。`pip install openai` を実行してください") from exc
        client = OpenAI()

    print(f"model={model}  dry_run={args.dry_run}  character={[p.name for p in char_imgs]}")
    print(f"base prompt: {len(base_prompt)}字 / 差分: {list(diffs)}")

    sheets: dict[str, Path] = {}
    for state, parent, diff_key in CHAIN:
        if parent is None:
            prompt = (
                base_prompt
                + "\n\n（最後の画像＝5×5顔角度テンプレート、それ以外＝キャラクター参照画像です）"
            )
            inputs = char_imgs + [args.template]
            n = args.n
        else:
            prompt = diffs[diff_key] + "\n" + DIFF_REINFORCE
            inputs = [sheets[parent]]
            n = args.diff_n

        print(f"[{state}] parent={parent} diff={diff_key} inputs={[p.name for p in inputs]} n={n}")
        if args.dry_run:
            datas = dryrun_generate(state, n, args.cell, args.margin)
        else:
            datas = gptimage_edit(
                client, model, inputs, prompt, args.size, n,
                args.quality, args.background, input_fidelity,
            )

        for i, data in enumerate(datas):
            (args.out / f"{state}_cand{i}.png").write_bytes(data)
        pick = min(args.pick, len(datas) - 1)
        dst = args.out / f"{state}.png"
        dst.write_bytes(datas[pick])
        sheets[state] = dst
        print(f"     -> {dst}  (候補{len(datas)}枚, 採用#{pick})")

    print(f"done: A〜F -> {args.out}")


if __name__ == "__main__":
    main()

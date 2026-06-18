#!/usr/bin/env bash
#
# バージョンを上げる（package.json / package-lock.json を更新）。
#
#   ./doVersionUp.sh            patch を +1（既定。vX.Y.Z の Z を +1）
#   ./doVersionUp.sh patch      同上
#   ./doVersionUp.sh minor      Y を +1（Z は 0 に戻る）
#   ./doVersionUp.sh major      X を +1（Y / Z は 0 に戻る）
#   ./doVersionUp.sh 2.0.0      バージョンを明示指定
#   ./doVersionUp.sh -h|--help  このヘルプを表示
#
# 中身は `npm version --no-git-tag-version`。package.json と package-lock.json の
# 両方を正しく更新し、git のコミット/タグは作らない（作業ツリーが汚れていても動く）。
# 反映後のリリース手順（コミット → タグ → デプロイ）は docs-camera/07-バージョン管理.md
# と ./doDeploy.sh を参照。
#
set -euo pipefail

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても npm/git が効くように。
cd "$(dirname "$0")"

# ── ヘルプ ───────────────────────────────────────────────────────────────
usage() {
  cat <<USAGE
doVersionUp.sh — バージョンを上げる（package.json / package-lock.json）

使い方:
  ./doVersionUp.sh [patch]    vX.Y.Z の Z を +1（既定・引数なしと同じ）
  ./doVersionUp.sh minor      Y を +1（Z=0）
  ./doVersionUp.sh major      X を +1（Y=0, Z=0）
  ./doVersionUp.sh X.Y.Z      バージョンを明示指定（例 2.0.0）
  ./doVersionUp.sh -h|--help  このヘルプを表示

備考:
  - git のコミット/タグは作らない（npm version --no-git-tag-version）。
  - 反映後の手順は docs-camera/07-バージョン管理.md（コミット → タグ → ./doDeploy.sh）。
USAGE
}

# ── 引数チェック（既定は patch） ─────────────────────────────────────────
arg="${1:-patch}"
case "$arg" in
  -h|--help|help)            usage; exit 0 ;;
  patch|minor|major)         ;;                 # semver の増分キーワード
  [0-9]*.[0-9]*.[0-9]*)      ;;                 # 明示バージョン（X.Y.Z）。最終検証は npm に任せる
  *) echo "不明な引数: $arg"; echo; usage; exit 2 ;;
esac

# ── バージョン更新 ───────────────────────────────────────────────────────
command -v npm >/dev/null 2>&1 || { echo "エラー: npm が必要です"; exit 1; }

old="$(node -p "require('./package.json').version")"

# npm version は package.json と package-lock.json の両方を更新する。
# --no-git-tag-version で commit/tag を作らない（汚れたツリーでも失敗しない）。
npm version "$arg" --no-git-tag-version >/dev/null

new="$(node -p "require('./package.json').version")"

echo "✓ バージョン更新: v$old → v$new"
echo "  更新ファイル: package.json / package-lock.json"
echo
echo "  次の手順（任意・docs-camera/07-バージョン管理.md）:"
echo "    git commit -am \"chore: バージョンを $new に\" && git tag \"v$new\""
echo "    git push origin main --follow-tags && ./doDeploy.sh"

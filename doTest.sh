#!/usr/bin/env bash
#
# テストを実行する（Vitest）。
#
#   ./doTest.sh              全テストを1回実行（CI 向け・vitest run）
#   ./doTest.sh watch        変更を監視して自動再実行（開発中・vitest）
#   ./doTest.sh <pattern>    ファイル名に <pattern> を含むテストだけ実行（例: ./doTest.sh obs）
#   ./doTest.sh -h|--help    このヘルプを表示
#
# テストフレームワークは Vitest（package.json の devDependencies / "test" スクリプト）。
# 追加インストールは不要。まずは「全部実行」「監視」「絞り込み」の3つだけ。
# カバレッジ・CI 連携・E2E は段階的に足す（README / docs 参照）。
#
set -euo pipefail

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても効くように。
cd "$(dirname "$0")"

# ── ヘルプ ───────────────────────────────────────────────────────────────
usage() {
  cat <<USAGE
doTest.sh — テストを実行する（Vitest）

使い方:
  ./doTest.sh              全テストを1回実行（vitest run）
  ./doTest.sh watch        変更監視で自動再実行（vitest）
  ./doTest.sh <pattern>    ファイル名フィルタで一部だけ（例: ./doTest.sh obs）
  ./doTest.sh -h|--help    このヘルプを表示

備考:
  - フレームワークは Vitest（npm test と同じ実体）。追加インストール不要。
USAGE
}

# ── 前提チェック ─────────────────────────────────────────────────────────
command -v npx >/dev/null 2>&1 || { echo "エラー: npx（Node.js）が必要です"; exit 1; }

# ── ディスパッチ（既定は全実行） ─────────────────────────────────────────
case "${1:-run}" in
  -h|--help|help) usage ;;
  run)            npx vitest run ;;        # 全テストを1回
  watch)          npx vitest ;;            # 変更監視
  *)              npx vitest run "$1" ;;   # ファイル名フィルタ
esac

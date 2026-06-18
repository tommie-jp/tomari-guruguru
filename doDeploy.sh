#!/usr/bin/env bash
#
# デプロイ/リリースのエントリポイント。
#
#   ./doDeploy.sh [all]     Pages デプロイ → Windows zip リリースの両方（既定）
#   ./doDeploy.sh pages     GitHub Pages へデプロイのみ
#   ./doDeploy.sh win       Windows 版リレイサーバを GitHub Release として配置のみ
#                           （guruguru-relay.exe + dist-local + start.bat を zip 化して upload）
#
# 注意: gh は --repo 無指定だと upstream(rotejin) を見て 403 になるので必ず --repo を付ける。
#
set -euo pipefail

REPO="tommie-jp/guruguru-avatar"
BRANCH="main"
WORKFLOW="pages.yml"
SITE_URL="https://tommie-jp.github.io/guruguru-avatar/"

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても git コマンドが効くように。
cd "$(dirname "$0")"

# ── ヘルプ ───────────────────────────────────────────────────────────────
usage() {
  cat <<USAGE
doDeploy.sh — デプロイ/リリースのエントリポイント

使い方:
  ./doDeploy.sh [all]      Pages デプロイ → Windows zip リリースの両方（既定・引数なしと同じ）
  ./doDeploy.sh pages      GitHub Pages へデプロイのみ
  ./doDeploy.sh win        Windows 版リレイサーバを GitHub Release として配置のみ
  ./doDeploy.sh -h|--help  このヘルプを表示

サブコマンド:
  all     pages → win を続けて実行（既定）。途中で失敗したら止まる（set -e）。
  pages   origin/$BRANCH を対象に $WORKFLOW を workflow_dispatch で起動し、
          完了まで監視して $SITE_URL の反映を確認する。
  win     ./doBuild.sh で配布 zip（guruguru-relay.exe + dist-local + start.bat）を
          作り、tag 'win-v<version>' の GitHub Release として upload する
          （既存リリースならアセットを --clobber で上書き）。

環境変数:
  win のビルド設定（WINNODE = 土台にする Windows 版 node.exe）は ./doBuild.sh を参照。

関連:
  ./doBuild.sh             zip をビルドするだけ（アップロードしない）
  対象リポジトリ           $REPO
USAGE
}

# ── 共通: gh の前提チェック ──────────────────────────────────────────────
require_gh() {
  command -v gh >/dev/null 2>&1 || { echo "エラー: gh CLI が必要です"; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "エラー: gh にログインしてください（gh auth login）"; exit 1; }
}

# ── pages: GitHub Pages へデプロイ（従来の doDeploy.sh の中身） ───────────
deploy_pages() {
  require_gh

  # ブランチ確認（対象は origin/$BRANCH）
  cur=$(git rev-parse --abbrev-ref HEAD)
  if [ "$cur" != "$BRANCH" ]; then
    echo "警告: 現在のブランチは '$cur'。デプロイ対象は origin/$BRANCH です。"
  fi

  # 未 push の確認（ローカルの未 push コミットは CI に反映されない）
  git fetch origin "$BRANCH" --quiet || true
  local_sha=$(git rev-parse "$BRANCH" 2>/dev/null || echo "")
  remote_sha=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo "")
  if [ -n "$local_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
    echo "エラー: ローカル $BRANCH と origin/$BRANCH が一致しません。"
    echo "  local : $local_sha"
    echo "  origin: $remote_sha"
    echo "  → 先に 'git push origin $BRANCH' してください（未 push のコミットはデプロイされません）。"
    exit 1
  fi

  # 起動前の最新 run id を控える（新しく起動した run を特定するため）
  before=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 1 \
    --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")

  echo "デプロイを起動: $REPO ($WORKFLOW @ $BRANCH)"
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$BRANCH"

  # 新しい run が登録されるまで待ってから監視する（最大 ~60 秒）
  echo "run の起動を待っています..."
  rid=""
  for _ in $(seq 1 30); do
    rid=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 1 \
      --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")
    if [ -n "$rid" ] && [ "$rid" != "$before" ]; then break; fi
    sleep 2
    rid=""
  done
  if [ -z "$rid" ]; then
    echo "エラー: 新しい run を特定できませんでした。Actions を確認してください。"
    echo "  gh run list --repo $REPO --workflow=$WORKFLOW"
    exit 1
  fi

  echo "run $rid を監視します..."
  gh run watch "$rid" --repo "$REPO" --exit-status

  # 反映確認（CDN 反映に数秒かかることがあるので非致命的）
  echo "反映を確認中..."
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "${SITE_URL}camera.html" 2>/dev/null || echo "000")
  echo "camera.html: HTTP $code"

  echo "✓ デプロイ完了: $SITE_URL"
}

# ── win: Windows 版リレイサーバを GitHub Release として配置 ───────────────
# ビルドは ./doBuild.sh に委譲（zip 生成は一箇所に集約）。ここではその zip を
# tag 'win-v<version>' の Release として upload するだけ。
release_windows() {
  require_gh

  local VERSION TAG ZIP notes
  VERSION="$(node -p "require('./package.json').version")"
  TAG="win-v${VERSION}"
  ZIP="dist-exe/guruguru-avatar-win-v${VERSION}.zip"

  echo "== ビルド (./doBuild.sh) =="
  ./doBuild.sh
  [ -f "$ZIP" ] || { echo "エラー: zip が見つかりません: $ZIP"; exit 1; }

  echo "== GitHub Release にアップロード (tag=$TAG) =="
  notes="$(cat <<NOTES
単一 Windows PC で OBS 用の tx/rx を動かすための、中継 + 静的配信の単体実行ファイルです（Node 不要）。

使い方:
1. zip をローカルドライブに展開（例 C:\\guruguru）。zip 内から直接実行しない。
2. start.bat をダブルクリック → 送信側(tx)が既定ブラウザで開く。
3. OBS の「ブラウザ」ソースに http://localhost:8787/?rx 。

詳細は docs-camera/09-Windowsで動かす.md / 10-単体EXEにする.md を参照。
NOTES
)"
  if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    echo "  既存 Release にアセットを上書きアップロード..."
    gh release upload "$TAG" "$ZIP" --repo "$REPO" --clobber
  else
    echo "  新規 Release を作成..."
    gh release create "$TAG" "$ZIP" --repo "$REPO" --target "$BRANCH" \
      --title "Windows リレイサーバ v${VERSION}" --notes "$notes"
  fi
  echo "✓ Release: https://github.com/$REPO/releases/tag/$TAG"
}

# ── ディスパッチ ─────────────────────────────────────────────────────────
case "${1:-all}" in
  -h|--help|help)          usage ;;
  pages)                   deploy_pages ;;
  win|windows|release-win) release_windows ;;
  all)                     deploy_pages; release_windows ;;
  *) echo "不明な引数: $1"; echo; usage; exit 2 ;;
esac

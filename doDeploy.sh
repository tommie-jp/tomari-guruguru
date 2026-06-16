#!/usr/bin/env bash
#
# GitHub Pages へデプロイする。
#
# このフォークは push では自動デプロイされないため、workflow_dispatch を手動起動し、
# 完了まで待ってから本番の反映を確認する。
# 注意: gh は --repo 無指定だと upstream(rotejin) を見て 403 になるので必ず --repo を付ける。
#
# 使い方:  ./doDeploy.sh
#
set -euo pipefail

REPO="tommie-jp/tomari-guruguru"
BRANCH="main"
WORKFLOW="pages.yml"
SITE_URL="https://tommie-jp.github.io/tomari-guruguru/"

# スクリプトの場所（＝リポジトリ）へ移動。どこから実行しても git コマンドが効くように。
cd "$(dirname "$0")"

# 1. 前提チェック
command -v gh >/dev/null 2>&1 || { echo "エラー: gh CLI が必要です"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "エラー: gh にログインしてください（gh auth login）"; exit 1; }

# 2. ブランチ確認（対象は origin/$BRANCH）
cur=$(git rev-parse --abbrev-ref HEAD)
if [ "$cur" != "$BRANCH" ]; then
  echo "警告: 現在のブランチは '$cur'。デプロイ対象は origin/$BRANCH です。"
fi

# 3. 未 push の確認（ローカルの未 push コミットは CI に反映されない）
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

# 4. 起動前の最新 run id を控える（新しく起動した run を特定するため）
before=$(gh run list --repo "$REPO" --workflow="$WORKFLOW" --limit 1 \
  --json databaseId -q '.[0].databaseId' 2>/dev/null || echo "")

echo "デプロイを起動: $REPO ($WORKFLOW @ $BRANCH)"
gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$BRANCH"

# 5. 新しい run が登録されるまで待ってから監視する（最大 ~60 秒）
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

# 6. 反映確認（CDN 反映に数秒かかることがあるので非致命的）
echo "反映を確認中..."
code=$(curl -fsS -o /dev/null -w '%{http_code}' "${SITE_URL}camera.html" 2>/dev/null || echo "000")
echo "camera.html: HTTP $code"

echo "✓ デプロイ完了: $SITE_URL"

#!/usr/bin/env bash
set -euo pipefail

REMOTE="${VIBEMETER_DEPLOY_REMOTE:-siney}"
REMOTE_DIR="${VIBEMETER_DEPLOY_DIR:-/home/nginx-deploy/vibemeter.siney.top-static}"
SITE_URL="${VIBEMETER_SITE_URL:-https://vibemeter.siney.top}"

copy_file() {
  local src="$1"
  local dest="$2"
  if [[ -e "$src" ]]; then
    scp "$src" "$REMOTE:$REMOTE_DIR/$dest"
  fi
}

copy_dir() {
  local src="$1"
  local dest="$2"
  if [[ -d "$src" ]]; then
    ssh "$REMOTE" "rm -rf '$REMOTE_DIR/$dest' && mkdir -p '$REMOTE_DIR/$dest'"
    scp -r "$src"/. "$REMOTE:$REMOTE_DIR/$dest/"
  fi
}

echo "[1/3] Sync static marketing site"
ssh "$REMOTE" "mkdir -p '$REMOTE_DIR'"
copy_file "deploy/vibemeter-site/index.html" "index.html"
copy_file "deploy/vibemeter-site/install.sh" "install.sh"
copy_file "deploy/vibemeter-site/og.png" "og.png"
copy_file "deploy/vibemeter-site/robots.txt" "robots.txt"
copy_file "deploy/vibemeter-site/sitemap.xml" "sitemap.xml"
copy_file "deploy/vibemeter-site/float-expanded.png" "float-expanded.png"
copy_file "deploy/vibemeter-site/float-collapsed.png" "float-collapsed.png"
copy_file "deploy/vibemeter-site/float-ball.png" "float-ball.png"
copy_file "deploy/vibemeter-site/admin-server.mjs" "admin-server.mjs"
copy_dir "deploy/vibemeter-site/claude-code-quota" "claude-code-quota"
copy_dir "deploy/vibemeter-site/codex-rate-limit" "codex-rate-limit"
copy_dir "deploy/vibemeter-site/ai-coding-usage-tracker" "ai-coding-usage-tracker"
copy_dir "deploy/vibemeter-site/pricing" "pricing"

echo "[2/3] Reload nginx and admin"
ssh "$REMOTE" "set -e; nginx -t; systemctl reload nginx; systemctl restart vibemeter-site-admin 2>/dev/null || true"

echo "[3/3] Verify"
curl -fsSI "$SITE_URL/" >/dev/null
curl -fsSI "$SITE_URL/claude-code-quota/" >/dev/null
curl -fsSI "$SITE_URL/codex-rate-limit/" >/dev/null
curl -fsSI "$SITE_URL/ai-coding-usage-tracker/" >/dev/null
curl -fsSI "$SITE_URL/pricing/" >/dev/null
curl -fsSI "$SITE_URL/float-expanded.png" >/dev/null
curl -fsSI "$SITE_URL/float-collapsed.png" >/dev/null
echo "Marketing site deployed: $SITE_URL"

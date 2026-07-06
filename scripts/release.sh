#!/usr/bin/env bash
# Release Vibemeter end-to-end: pack → scp to siney → verify → git tag/push →
# refresh local LaunchAgent. Run AFTER bumping package.json + committing.
#
# Usage:
#   npm version patch --no-git-tag-version
#   git add package.json package-lock.json [other-files]
#   git commit -m "..."
#   bash scripts/release.sh        # or: npm run release
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
REMOTE="${VIBEMETER_DEPLOY_REMOTE:-siney}"
REMOTE_DIR="${VIBEMETER_DEPLOY_DIR:-/home/nginx-deploy/vibemeter.siney.top-static}"
SITE_URL="${VIBEMETER_SITE_URL:-https://vibemeter.siney.top}"

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

step "Release plan: $TAG → $SITE_URL/vibemeter.tgz"

if ! git diff --quiet HEAD -- package.json package-lock.json; then
  git status --short -- package.json package-lock.json
  fail "package.json / package-lock.json not committed — commit your version bump first."
fi
# Warn (but don't block) on other pending changes — the release only cares
# that the version bump is committed.
if ! git diff --quiet HEAD; then
  printf '\033[1;33m  ! Other uncommitted changes (not blocking, but excluded from this release):\033[0m\n'
  git status --short | grep -v '\.tgz$' | head -10
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  fail "Tag $TAG already exists locally — bump version first."
fi
if git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "refs/tags/$TAG\$"; then
  fail "Tag $TAG already exists on remote — bump version first."
fi

step "Validate"
npm run typecheck
npm run lint
node --test tests/*.test.ts
npm run build

# 官网 JSON-LD 的 softwareVersion 必须跟着版本走（npm version 钩子会自动同步；
# 手动改过 package.json 版本时这里兜底拦截）。
STALE_SITE_VERSIONS="$(grep -rho '"softwareVersion": "[^"]*"' deploy/vibemeter-site --include='*.html' | grep -v "\"$VERSION\"" || true)"
if [[ -n "$STALE_SITE_VERSIONS" ]]; then
  echo "$STALE_SITE_VERSIONS"
  fail "Marketing site softwareVersion != $VERSION — run: node scripts/sync-site-version.mjs && commit"
fi

step "Pack"
rm -f hirra-vibemeter-*.tgz vibemeter*.tgz
npm pack
PACKED="hirra-vibemeter-$VERSION.tgz"
[[ -f "$PACKED" ]] || fail "Expected $PACKED after npm pack"
cp "$PACKED" vibemeter.tgz
cp "$PACKED" "vibemeter-$VERSION.tgz"

EXPECTED_SIZE="$(wc -c < vibemeter.tgz | tr -d ' ')"
echo "  $PACKED + vibemeter.tgz + vibemeter-$VERSION.tgz (${EXPECTED_SIZE} bytes each)"

step "Upload to $REMOTE:$REMOTE_DIR"
scp vibemeter.tgz "vibemeter-$VERSION.tgz" deploy/vibemeter-site/install.sh "$REMOTE:$REMOTE_DIR/"

step "Verify reachability"
for url in "$SITE_URL/vibemeter.tgz" "$SITE_URL/vibemeter-$VERSION.tgz"; do
  got="$(curl --noproxy '*' -sI "$url" | awk 'tolower($1)=="content-length:"{gsub(/\r/,"",$2); print $2}')"
  [[ "$got" == "$EXPECTED_SIZE" ]] || fail "$url content-length $got != $EXPECTED_SIZE"
  echo "  ✓ $url ($got bytes)"
done

step "Sync marketing site"
bash scripts/deploy-marketing.sh

step "Tag + push"
git tag -a "$TAG" -m "$TAG"
git push origin HEAD "$TAG"

step "Refresh local install"
tmp="$(mktemp -t vibemeter-XXXXXX).tgz"
curl --noproxy '*' -fsSL "$SITE_URL/vibemeter.tgz" -o "$tmp"
npm install -g "$tmp" --loglevel=warn
rm -f "$tmp"
INSTALLED="$(node -p "require('$HOME/.npm-global/lib/node_modules/@hirra/vibemeter/package.json').version" 2>/dev/null || echo "?")"
[[ "$INSTALLED" == "$VERSION" ]] || fail "Global install reports $INSTALLED, expected $VERSION"
echo "  ✓ global @hirra/vibemeter@$INSTALLED"

if [[ "$(uname -s)" == "Darwin" && -f "$HOME/Library/LaunchAgents/com.hirra.vibemeter.plist" ]]; then
  launchctl unload "$HOME/Library/LaunchAgents/com.hirra.vibemeter.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/com.hirra.vibemeter.plist"
  for i in {1..15}; do
    code="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9527 || echo 000)"
    [[ "$code" == "200" ]] && break
    sleep 1
  done
  echo "  daemon: HTTP $code"
fi

printf '\n\033[1;32m✓ Released %s. Live at %s/vibemeter.tgz\033[0m\n' "$TAG" "$SITE_URL"

#!/usr/bin/env bash
# Vibemeter installer — foreground, with visible progress.
# Distributed via vibemeter.siney.top (not the npm registry).
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "Vibemeter needs Node.js 20+ (so npm is available)." >&2
  echo "Install from: https://nodejs.org/" >&2
  exit 1
fi

# Version pinning: set VIBEMETER_VERSION=0.2.10 to install a specific release.
if [ -n "${VIBEMETER_VERSION:-}" ]; then
  VIBEMETER_TARBALL_URL="https://vibemeter.siney.top/vibemeter-${VIBEMETER_VERSION#v}.tgz"
else
  VIBEMETER_TARBALL_URL="https://vibemeter.siney.top/vibemeter.tgz"
fi

data_dir="${VIBEMETER_DATA_DIR:-$HOME/.vibemeter}"
mkdir -p "$data_dir"
tarball="$(mktemp -t vibemeter-XXXXXX).tgz"

cleanup() { rm -f "$tarball"; }
trap cleanup EXIT

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

step "Downloading Vibemeter"
echo "  $VIBEMETER_TARBALL_URL"
# --progress-bar prints a single growing bar instead of a spammy table.
# --retry 3 because vibemeter.siney.top can be flaky behind certain proxies.
if ! curl -fL --progress-bar --retry 3 --connect-timeout 20 "$VIBEMETER_TARBALL_URL" -o "$tarball"; then
  echo
  echo "✗ Download failed. Common causes:" >&2
  echo "  • Corporate proxy blocking vibemeter.siney.top — try a personal network." >&2
  echo "  • DNS not resolving — try: curl -v https://vibemeter.siney.top/" >&2
  echo "  • Slow link — re-run, the script resumes from a fresh attempt." >&2
  exit 1
fi
size=$(wc -c < "$tarball" | tr -d ' ')
echo "  Downloaded ${size} bytes."

step "Installing @hirra/vibemeter globally"
# --loglevel=notice shows package add/remove lines, --no-fund hides funding spam.
npm install -g "$tarball" --loglevel=notice --no-fund

vibemeter_bin="$(command -v vibemeter || true)"
if [ -z "$vibemeter_bin" ]; then
  prefix="$(npm prefix -g)"
  vibemeter_bin="$prefix/bin/vibemeter"
fi
if [ ! -x "$vibemeter_bin" ]; then
  echo "✗ vibemeter command not found after install (expected at $vibemeter_bin)." >&2
  echo "  npm prefix -g returns: $(npm prefix -g)" >&2
  echo "  Make sure that directory's bin is on PATH." >&2
  exit 1
fi

step "Registering Vibemeter as a background service"
"$vibemeter_bin" install

step "Waiting for dashboard at http://localhost:9527"
ready=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -fsS http://localhost:9527 >/dev/null 2>&1; then
    ready=1
    break
  fi
  printf '.'
  sleep 1
done
echo

if [ "$ready" != "1" ]; then
  echo "✗ Dashboard didn't come up within 30s." >&2
  echo "  Check: $vibemeter_bin status" >&2
  echo "  Logs:  $data_dir/vibemeter.log" >&2
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  # Refresh the .app bundles BEFORE (re)launching the float widget so the user
  # always lands on the just-installed binary. The CLI now stages + rename-swaps
  # internally, so this works even if an older widget is currently running.
  step "Registering Vibemeter in /Applications"
  if "$vibemeter_bin" install-app >/dev/null 2>&1; then
    echo "  ✓ /Applications/Vibemeter.app linked."
  else
    echo "  · Skipped (an existing /Applications/Vibemeter.app blocks the symlink)."
    echo "    Run \`vibemeter install-app --name \"Vibemeter Float.app\"\` to install under a different name."
  fi

  # Replace any running widget so the user sees the new build immediately —
  # otherwise the old process keeps the previous binary mapped in memory.
  float_binary="$HOME/.vibemeter/Vibemeter.app/Contents/MacOS/Vibemeter"
  if pgrep -f "$float_binary" >/dev/null 2>&1; then
    step "Restarting floating widget"
    pkill -f "$float_binary" >/dev/null 2>&1 || true
    # Give launchd / NSRunningApplication a beat to release the bundle id
    # before we relaunch — otherwise `open -b` may focus the dying process.
    sleep 1
  else
    step "Opening floating widget"
  fi
  # WKWebView caches /float's HTML+JS to ~/Library/Caches/<bundle> on disk.
  # Server-side no-store headers aren't enough — after an upgrade the relaunched
  # window still serves the previous bundle from cache, so users see the old
  # build until they nuke it manually. Wipe just the HTTP cache (leave
  # HTTPStorages/* alone so localStorage / cookies survive) so the next launch
  # refetches from the just-restarted Next.js server.
  rm -rf "$HOME/Library/Caches/com.hirra.vibemeter" >/dev/null 2>&1 || true
  "$vibemeter_bin" float || true
fi

echo
echo "✓ Vibemeter is ready."
echo "  Dashboard:  http://localhost:9527"
echo "  Settings:   http://localhost:9527/settings"
echo "  Pricing:    http://localhost:9527/pricing"

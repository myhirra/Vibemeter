#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first: https://nodejs.org/" >&2
  exit 1
fi

# Vibemeter is distributed via GitHub tags, not npm registry.
# Override with VIBEMETER_VERSION=v0.2.2 to pin; default = latest tag.
resolve_vibemeter_ref() {
  if [ -n "${VIBEMETER_VERSION:-}" ]; then
    printf '%s' "$VIBEMETER_VERSION"
    return
  fi
  tag=$(curl -fsS https://api.github.com/repos/myhirra/Vibemeter/tags 2>/dev/null \
    | grep -m1 '"name"' | cut -d'"' -f4 || true)
  printf '%s' "${tag:-main}"
}
VIBEMETER_REF="$(resolve_vibemeter_ref)"
VIBEMETER_SOURCE="github:myhirra/Vibemeter#${VIBEMETER_REF}"

if [ "$(uname -s)" = "Darwin" ]; then
  data_dir="${VIBEMETER_DATA_DIR:-$HOME/.vibemeter}"
  log="$data_dir/install.log"
  bg="$data_dir/install-vibemeter-bg.sh"
  mkdir -p "$data_dir"

  cat > "$bg" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
data_dir="${VIBEMETER_DATA_DIR:-$HOME/.vibemeter}"
log="$data_dir/install.log"
lock="$data_dir/install.lock"
mkdir -p "$data_dir"

{
  echo
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Vibemeter background install started"
  if ! mkdir "$lock" 2>/dev/null; then
    echo "Another Vibemeter install is already running."
    exit 0
  fi
  trap 'rmdir "$lock" 2>/dev/null || true' EXIT

  echo "Installing @hirra/vibemeter from ${VIBEMETER_SOURCE}..."
  npm install -g "${VIBEMETER_SOURCE}" --loglevel=notice

  vibemeter_bin="$(command -v vibemeter || true)"
  if [ -z "$vibemeter_bin" ]; then
    prefix="$(npm prefix -g)"
    vibemeter_bin="$prefix/bin/vibemeter"
  fi

  echo "Starting Vibemeter background service..."
  "$vibemeter_bin" install

  echo "Waiting for dashboard at http://localhost:9527 ..."
  ready=0
  for i in {1..120}; do
    if curl -fsS http://localhost:9527 >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" = "1" ]; then
    echo "Opening floating widget..."
    "$vibemeter_bin" float || true
    echo "Vibemeter is ready: http://localhost:9527"
  else
    echo "Vibemeter is still starting. Open http://localhost:9527 in a moment."
    echo "Check logs with: vibemeter status"
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Vibemeter background install finished"
} >> "$log" 2>&1
EOF

  chmod +x "$bg"
  export VIBEMETER_SOURCE
  nohup "$bg" >/dev/null 2>&1 &

  echo "Installing Vibemeter in the background..."
  echo "Log: $log"
  echo "Watch progress with:"
  echo "  tail -f \"$log\""
  echo
  echo "When it finishes, Vibemeter will open automatically."
  echo "Dashboard: http://localhost:9527"
  exit 0
fi

echo "Installing Vibemeter from ${VIBEMETER_SOURCE}..."
npm install -g "${VIBEMETER_SOURCE}"

echo "Starting Vibemeter background service..."
vibemeter install

echo "Waiting for Vibemeter to be ready at http://localhost:9527 ..."
ready=0
for i in {1..120}; do
  if curl -fsS http://localhost:9527 >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$(uname -s)" = "Darwin" ]; then
  echo "Opening floating widget..."
  vibemeter float || true
fi

echo
if [ "$ready" = "1" ]; then
  echo "Vibemeter is ready: http://localhost:9527"
else
  echo "Vibemeter is still starting. Open http://localhost:9527 in a moment."
  echo "Check logs with: vibemeter status"
fi

#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first: https://nodejs.org/" >&2
  exit 1
fi

echo "Installing Vibemeter..."
npm install -g @hirra/vibemeter --registry=https://registry.npmjs.org/

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

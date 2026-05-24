import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export function GET() {
  const script = `#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install Node.js 20+ first: https://nodejs.org/" >&2
  exit 1
fi

echo "Installing Vibemeter..."
npm install -g @hirra/vibemeter --registry=https://registry.npmjs.org/

echo "Starting Vibemeter background service..."
vibemeter install

if [ "$(uname -s)" = "Darwin" ]; then
  echo "Opening floating widget..."
  vibemeter float || true
fi

echo
echo "Vibemeter is ready: http://localhost:9527"
`;

  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/x-shellscript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8'),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native modules out of the bundle — they're resolved from node_modules at runtime,
  // which lets npm install the correct binary on the user's platform.
  serverExternalPackages: ['better-sqlite3'],
  // Dev-only: allow 127.0.0.1 to fetch /_next dev resources. Without this,
  // opening the dashboard via 127.0.0.1 (instead of localhost) blocks the
  // client bundle as cross-origin — click handlers never attach and the
  // controls look broken.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  env: {
    NEXT_PUBLIC_VIBEMETER_VERSION: pkg.version,
  },
};

export default nextConfig;

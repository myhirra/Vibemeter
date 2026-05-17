/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native modules out of the bundle — they're resolved from node_modules at runtime,
  // which lets npm install the correct binary on the user's platform.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;

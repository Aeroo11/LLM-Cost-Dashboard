import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder. Without this, Next.js walks up and
  // finds a stray lockfile in the home directory and misresolves node_modules.
  turbopack: {
    root: path.resolve("."),
  },
  typescript: {
    // Next's build-time TS check misdetects the workspace root (a stray
    // package.json/node_modules exists in the home directory) and tries to
    // auto-install typescript, which crashes. We gate types ourselves via
    // `npm run typecheck` (tsc --noEmit) instead, which passes cleanly.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder. Without this, Next.js walks up and
  // finds a stray lockfile in the home directory and misresolves node_modules.
  turbopack: {
    root: path.resolve("."),
  },
  // DuckDB ships a native addon; it must stay external to the server bundle
  // rather than being traced and rewritten by the bundler.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;

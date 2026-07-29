import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder. Without this, Next.js walks up and
  // finds a stray lockfile in the home directory and misresolves node_modules.
  turbopack: {
    root: path.resolve("."),
  },
  // Same reason, for the tracer: without it Next walks up to the stray lockfile
  // and the relative globs in outputFileTracingIncludes resolve against the
  // wrong directory. Pinning both keeps local builds honest about what Vercel
  // will produce.
  outputFileTracingRoot: path.resolve("."),
  // DuckDB ships a native addon; it must stay external to the server bundle
  // rather than being traced and rewritten by the bundler.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],

  /**
   * Force the DuckDB platform package into the serverless bundle.
   *
   * The package ships two files that matter: `duckdb.node`, the N-API addon,
   * and the DuckDB engine itself as a ~35 MB shared library (`libduckdb.so` on
   * Linux, `duckdb.dll` on Windows). The addon is reached through a static
   * `require()`, so file tracing finds it. The shared library is not — it is
   * resolved by the *OS dynamic loader* at load time, which no static analysis
   * can see.
   *
   * The result deployed cleanly and then failed on every request with
   * "libduckdb.so: cannot open shared object file", because the bundle held the
   * 1 MB addon and not the 35 MB library it links against. Listing the package
   * here is the only way to tell the tracer about a dependency that never
   * appears in the module graph.
   *
   * The glob covers whichever platform package the install resolved, so the
   * same config works on a Linux builder and a Windows dev machine.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@duckdb/node-bindings-*/**"],
  },
};

export default nextConfig;

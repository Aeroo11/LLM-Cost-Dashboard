import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // The DB layer imports `server-only` so a stray client import fails the
      // Next build. Outside the React Server Component graph that module throws
      // on sight, so tests stub it out — the guard is a build-time concern.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // The DuckDB reconciliation suite backfills real data; give it room.
    testTimeout: 60_000,
  },
});

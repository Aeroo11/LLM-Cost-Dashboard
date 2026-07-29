/**
 * Stub for the `server-only` package under Vitest.
 *
 * The real module throws unconditionally when imported outside a React Server
 * Component graph — that is exactly its job, and it is what stops server code
 * (like the DuckDB layer) from being pulled into a client bundle. Tests import
 * that same server code directly in Node, so the guard has to be neutralised
 * here. Aliased in `vitest.config.ts`.
 */
export {};

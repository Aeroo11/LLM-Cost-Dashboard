import { describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";
import { DDL, VIEWS } from "./schema";

/**
 * Regression tests for the store's concurrency model.
 *
 * The first version of the client shared one DuckDB connection across every
 * request. A single request worked; two overlapping ones deadlocked the server,
 * because a connection executes one statement at a time and the dashboard fans
 * out several queries per request. These tests pin the two properties the fix
 * relies on.
 */

describe("DuckDB connection model", () => {
  it("serves overlapping readers on separate connections", async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const setup = await instance.connect();
    await setup.run(DDL);
    await setup.run(VIEWS);
    setup.closeSync();

    // Ten simultaneous readers, each on its own connection — the shape the
    // dashboard produces when several clients poll at once. This hung outright
    // when every caller shared a single connection.
    const results = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => {
        const connection = await instance.connect();
        try {
          const reader = await connection.runAndReadAll(
            "SELECT $1::INTEGER AS n, count(*) AS rows FROM v_requests",
            [i],
          );
          return Number(reader.getRowObjects()[0].n);
        } finally {
          connection.closeSync();
        }
      }),
    );

    expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    instance.closeSync();
  });

  it("keeps queued writes in order behind a mutex", async () => {
    // Mirrors the `serialise()` helper in client.ts: each task chains onto the
    // previous one, so interleaved callers still produce one ordered sequence.
    let chain: Promise<void> = Promise.resolve();
    const order: number[] = [];

    const serialise = (task: () => Promise<void>): Promise<void> => {
      const run = chain.then(task, task);
      chain = run.catch(() => undefined);
      return run;
    };

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        serialise(async () => {
          // Deliberately yield so an unserialised implementation interleaves.
          await new Promise((r) => setTimeout(r, 5 - i));
          order.push(i);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not let one failed write poison the queue", async () => {
    let chain: Promise<void> = Promise.resolve();
    const serialise = (task: () => Promise<void>): Promise<void> => {
      const run = chain.then(task, task);
      chain = run.catch(() => undefined);
      return run;
    };

    const failing = serialise(async () => {
      throw new Error("ingest blew up");
    });
    await expect(failing).rejects.toThrow("ingest blew up");

    // The next caller must still run rather than inheriting the rejection.
    let ran = false;
    await serialise(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

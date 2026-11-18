# TokenWatch engineering notes

[Project overview and local setup](../README.md)

## Architecture

```mermaid
flowchart LR
  G["Event generator<br/><i>seeded, deterministic per minute</i>"]
  I["Ingestion<br/><i>DuckDB appender</i>"]
  S[("DuckDB<br/>requests (fact)<br/>models (dimension)")]
  Q["SQL layer<br/><i>aggregation · insights<br/>anomalies · simulation</i>"]
  A["/api/stream · /api/metrics<br>/api/requests · /api/simulate"]
  U["Dashboard<br/><i>SSE client</i>"]

  G -->|"backfill 7d, then<br/>append elapsed slices"| I
  I --> S
  S --> Q
  Q --> A
  A -->|"push on change"| U
```

The dashboard queries its core aggregates from the DuckDB fact table.
The client receives them over Server-Sent Events.

| Layer | Where | What it does |
|---|---|---|
| Generation | `lib/generator.ts` | Poisson arrivals, log-normal tokens and latency, a diurnal traffic curve, and deterministic incidents |
| Ingestion | `lib/db/client.ts` | 7-day backfill through DuckDB's appender, then continuous sub-minute appends |
| Schema | `lib/db/schema.ts` | `requests` fact table + `models` price-book dimension |
| Transformation | `lib/db/{queries,insights,anomalies,simulate}.ts` | All aggregation, in SQL |
| Serving | `app/api/*` | SSE stream, snapshot endpoint, drill-down, simulator |

---

## Engineering notes

The decisions worth explaining, and why they went the way they did.

### The SQL is checked against a second implementation

`lib/aggregate.ts` is a pure-TypeScript roll-up that computes the same summary
the SQL layer does. It is not dead code — the test suite runs both over an
identical event stream and asserts they agree, down to per-bucket per-model
cost and interpolated latency percentiles.

Two independent implementations of one spec disagree only if one of them is
wrong. That is a much stronger check than asserting either against hand-written
expected values, which mostly tests that you can do arithmetic twice the same
way. The same pattern covers the savings insights and the median/MAD used by
the anomaly detector.

### Incremental ingestion had to be provably equivalent to a backfill

The store appends only the time that has actually elapsed since the last tick —
a few seconds' worth. For the history to be correct, appending in slices must
produce exactly what one large backfill would have produced.

That holds because generation is seeded from each minute's **absolute index**
rather than from a running PRNG, so:

```
generateRange(a, c) === generateRange(a, b) ++ generateRange(b, c)
```

for any split point `b`, including mid-minute. `lib/generator.test.ts` asserts
it at minute boundaries, mid-minute, and across many small slices.

### Why the anomaly detector uses median and MAD

The obvious detector — flag anything beyond 3σ — fails on exactly the data it
is meant to police. Both the mean and the standard deviation are dragged around
by the spikes being detected, so one incident inflates the threshold enough to
mask the next, and a sustained outage quietly becomes the new normal.

The detector uses a rolling **median** baseline and **median absolute
deviation**, scored with the Iglewicz–Hoaglin modified z-score. Both statistics
have a 50% breakdown point. The point under test is excluded from its own
baseline, since including it pulls the median toward the value being judged.

A first version could not detect error storms *at all*. A healthy service sits
at exactly zero errors, so more than half the trailing window shares a value,
MAD collapses to zero, and the metric most worth alerting on could never fire.
Each metric now has a floor on its spread estimate — which doubles as a
practical-significance gate, so a metric that normally varies by a rounding
error does not raise an alert for varying by two rounding errors.

Because window functions cannot be nested, MAD is computed by collecting the
trailing window with `array_agg() OVER` and reducing it with list lambdas —
exact, rather than the common shortcut of deviating from a per-row median.

### Pricing lives in a table, which is what makes the simulator cheap

`models` is a dimension table, not just a TypeScript constant. Asking "what
would this traffic have cost on a different model?" is therefore a **join**, not
a loop — so re-pricing 54,000 requests under a new scenario is one pass over the
fact table rather than 54,000 iterations in JavaScript.

The moved subset is chosen with `hash(id) % 1000`, so the same request always
lands on the same side of a split. Nudging one slider never reshuffles which
calls moved, and the projection settles instead of jittering.

### One DuckDB connection is not a connection pool

The first version shared a single connection across all requests. One request
worked fine; two overlapping ones **deadlocked the server**, because a
connection executes one statement at a time and each page load fans out several
queries.

Writes now go through one dedicated connection behind a mutex — two overlapping
ingests would otherwise append the same slice twice — while readers borrow their
own short-lived connection. Verified with 12 concurrent requests and pinned by
`lib/db/concurrency.test.ts`.

### A native dependency the bundler could not see

The first deployment built green, deployed green, and returned 500 on every
single request. Nothing in the build output hinted at it.

The DuckDB platform package ships two files that matter: `duckdb.node`, the
~1 MB N-API addon, and the engine itself as a ~35 MB shared library
(`libduckdb.so` on Linux, `duckdb.dll` on Windows). The addon is reached
through a static `require()`, so Next's file tracing finds it. The shared
library is not — it is resolved by the **operating system's dynamic loader** at
load time, and no static analysis of the module graph can see that edge.

So the function shipped the 1 MB addon without the 35 MB library it links
against. `outputFileTracingIncludes` is the only way to declare a dependency
that never appears in the module graph:

```ts
outputFileTracingIncludes: {
  "/api/**": ["./node_modules/@duckdb/node-bindings-*/**"],
},
```

Two things made this take longer than it should have, and both are now fixed:

- **The driver was imported at module load.** A module that fails to load never
  reaches any error handling, so the platform returned its own opaque HTML 500
  and the JSON error wrapper never ran. The import is now deferred to first use,
  which moves the failure inside a request where it can be caught and reported.
- **There was nothing to ask.** `/api/health` now reports each stage separately
  — resolve the binding, create an instance, build the store, query it — with
  platform, arch, Node version and region. It named the cause in one request:
  `libduckdb.so: cannot open shared object file`.

### DuckDB's defaults are host defaults

Every DuckDB default is derived from the machine it starts on, which is the
wrong machine inside a function container:

| Setting | Default here | Why it breaks |
|---|---|---|
| `temp_directory` | `.tmp` | Relative to the working directory — `/var/task`, read-only |
| `memory_limit` | 25 GiB | 80% of the dev machine's RAM, against a ~1 GB function |
| `threads` | 20 | Host core count, against ~2 vCPU |
| extension autoload | on | Would download and write extensions under a read-only `$HOME` |

All four are pinned in `lib/config.ts` and overridable by environment variable.
The workload is small enough that 512 MB and two threads are generous for it.

### The "live" indicator tells the truth

The earlier version polled every 5 seconds and rendered an animated "live"
badge, while the underlying data only changed once a minute — eleven of every
twelve responses were byte-identical. Now the server pushes over SSE only when
the payload actually changes, and the indicator reports real `EventSource` state:
`connecting`, `live`, `reconnecting`, `disconnected`, plus how long ago the last
frame landed.

A serverless function cannot hold a connection open indefinitely, so the stream
would otherwise be severed mid-flight and the browser would report a network
error — the badge would flicker for every visitor. Instead the stream retires
itself at 50s, under a declared `maxDuration` of 60, announcing the hand-over
with a `rotating` event first. The client holds its `live` state across an
announced rotation and reports `reconnecting` only for genuine faults.

---

## Honesty about the numbers

A cost dashboard that overstates savings is worse than no dashboard, so the
distinction is built into the data model rather than the copy.

- **Savings are split into `measured` and `estimate`.** Re-routing savings are
  re-priced from observed token counts against the price book — exact. The
  prompt-caching recommendation rests on an assumption the event stream cannot
  confirm (it carries no prompt text to diff), and is labelled and totalled
  separately.
- **Every routing recommendation carries its quality cost.** `qualityDelta` is
  shown next to the dollar figure, because a saving that silently trades away
  output quality is not a saving.
- **The simulator re-prices the observed token counts from the demo dataset.**
  It projects quality from each target model's synthetic baseline score.
- **Recommendations operate on disjoint endpoint sets**, so summing them does
  not double-count. Adding an overlapping recommendation would break that and
  needs the overlap netted out first.

### About the data

The event stream is **simulated** — no LLM API is called and no real traffic is
involved. It is shaped to behave like production traffic (Poisson arrivals,
log-normal token and latency distributions, a diurnal curve, and incidents), and
it contains deliberate inefficiencies for the analysis to find.

Model pricing is **representative, not a live price book**. The figures are
realistic and the *relationships* are what matter: output costs several times
input, cached input is far cheaper than fresh, and a frontier model costs
15–20× a small one for a modest quality gain.

---

## Running it

```bash
npm ci
npm run dev          # http://localhost:3000
```

By default, the store backfills seven days of simulated history on first
request and appends new events as time advances.

```bash
npm run verify       # typecheck + lint + tests
npm run test:watch   # tests in watch mode
npm run build        # production build
```

### Querying the data yourself

The dashboard's claims should be checkable without trusting the dashboard.
`npm run seed` writes the same schema to a file you can open in the DuckDB CLI:

```bash
npm run seed                              # 7 days, default settings
npx tsx scripts/seed.ts --hours 24        # pass flags via tsx, not `npm run --`
duckdb data/events.duckdb
```

```sql
-- The routing leak the Insights panel reports, found by hand.
SELECT endpoint, model,
       count(*)              AS calls,
       round(sum(cost_usd),2) AS usd
FROM v_requests
WHERE endpoint = 'classify'
GROUP BY 1, 2
ORDER BY usd DESC;
```

### Configuration

Everything is optional; see `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `SIM_SEED` | `42` | PRNG seed — the same seed replays the same history |
| `SIM_RATE_PER_MIN` | `8` | Nominal traffic rate, before the diurnal curve |
| `SIM_RETENTION_HOURS` | `168` | How much history the store keeps |
| `DUCKDB_PATH` | `:memory:` | Store location; a path persists between restarts |

---

## Testing

The suite is weighted toward things that are easy to get quietly wrong:

- **Reconciliation** — SQL aggregation vs. the independent TypeScript
  implementation, per bucket and per model
- **Determinism** — the concatenation identity that incremental ingestion
  depends on, at minute boundaries, mid-minute, and across many small slices
- **Statistics** — median/MAD properties including "unmoved by an outlier" and
  "not blinded by an earlier spike in its own history"
- **Detection** — a planted incident, asserting all three metrics fire on the
  right bucket and nothing fires on the ordinary ones
- **Simulation** — the empty scenario must re-price to exactly the observed
  spend, or every other projection is built on a broken foundation
- **Concurrency** — the regression that deadlocked the server
- **Input validation** — unknown filter values are dropped rather than matched;
  scenario input is clamped

CI runs typecheck, lint, tests and a build on pull requests and pushes to `main`, then seeds a DuckDB
file and queries it back to prove the pipeline works on a clean machine.

---

## Known limitations

Stated rather than hidden, because they are the honest boundaries of a
weekend-scale project:

- **The store is per-instance.** On serverless, each cold start rebuilds its own
  in-memory store. Fine for a demo; a real deployment would point `DUCKDB_PATH`
  at shared storage or use MotherDuck.
- **The stream recomputes per subscriber.** Every connected client triggers its
  own query pass every two seconds. A shared computation fanned out to
  subscribers would scale further.
- **Light theme only.**
- **Latency has no time series.** `TimeBucket` (`lib/aggregate.ts`) carries cost
  and request count per bucket, not latency, so the dashboard can only show p50
  / p95 / p99 for the window as a whole — a quantile strip, which plots the
  three known points and interpolates nothing. A real latency-over-time chart
  needs `latencyP95` added to the bucket and a `quantile_cont(latency_ms, 0.95)`
  in the time-series `GROUP BY`.
- **Drilling into an endpoint hides the others.** `queryEndpointMatrix` applies
  the endpoint filter, so clicking a bar in "Cost by endpoint" drops the
  remaining endpoints from the payload instead of letting them recede. Keeping
  the chart you filter *by* fully populated would mean not passing
  `filters.endpoints` to that one query.
- **Quality is synthetic.** `qualityScore` is a generated proxy, not a real
  evaluation. Wiring in an actual eval harness is the most valuable next step.

## Refreshing the screenshots

Open the local dashboard at 1,440 px wide. Capture the Overview with an
anomaly marker visible, then select **Test 50% in simulator** and capture the
result after the projection updates. Save them as `screenshot-dashboard.png`
and `screenshot-simulator.png` in this directory.

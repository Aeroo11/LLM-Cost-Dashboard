/**
 * Physical schema for the analytics store.
 *
 * A deliberately small star schema: one fact table (`requests`, one row per LLM
 * API call) and one dimension (`models`, the price book). Keeping pricing in a
 * table rather than only in TypeScript means cost re-pricing — "what would this
 * traffic have cost on a different model?" — is a join, not a loop, which is
 * what makes the what-if simulator a single query.
 *
 * DDL lives here as SQL text rather than a .sql file so the bundler traces it
 * into the serverless function without a filesystem read at request time.
 */

export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS models (
  id                  VARCHAR PRIMARY KEY,
  label               VARCHAR NOT NULL,
  vendor              VARCHAR NOT NULL,
  tier                VARCHAR NOT NULL,
  input_per_1m        DOUBLE  NOT NULL,
  output_per_1m       DOUBLE  NOT NULL,
  cached_input_per_1m DOUBLE  NOT NULL,
  quality_baseline    DOUBLE  NOT NULL,
  base_latency_ms     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id            VARCHAR   NOT NULL,
  ts            TIMESTAMP NOT NULL,
  model         VARCHAR   NOT NULL,
  endpoint      VARCHAR   NOT NULL,
  input_tokens  INTEGER   NOT NULL,
  output_tokens INTEGER   NOT NULL,
  cached_tokens INTEGER   NOT NULL,
  latency_ms    INTEGER   NOT NULL,
  status        VARCHAR   NOT NULL,
  quality_score DOUBLE    NOT NULL,
  cost_usd      DOUBLE    NOT NULL
);

-- Every query is time-bounded, so this is the one index that earns its keep.
CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests (ts);
`;

/**
 * Convenience view: the derived columns every query would otherwise repeat.
 * `fresh_input_tokens` is the billable, non-cached portion — the quantity the
 * caching insight is computed against.
 */
export const VIEWS = /* sql */ `
CREATE OR REPLACE VIEW v_requests AS
SELECT
  r.*,
  r.input_tokens - r.cached_tokens          AS fresh_input_tokens,
  r.status = 'success'                      AS is_success,
  CAST(epoch_ms(r.ts) AS BIGINT)            AS ts_ms
FROM requests r;
`;

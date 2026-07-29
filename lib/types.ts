/** Core domain types for the LLM cost dashboard. */

export type ModelId =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-sonnet-5"
  | "claude-haiku-4-5";

/** The kind of workload a request belongs to. Drives token profile + routing. */
export type Endpoint = "chat" | "classify" | "summarize" | "rag";

export type RequestStatus = "success" | "error" | "rate_limited" | "timeout";

/** A single LLM API call — the atomic event the whole dashboard is built on. */
export interface LLMRequest {
  id: string;
  /** Epoch milliseconds. */
  timestamp: number;
  model: ModelId;
  endpoint: Endpoint;
  inputTokens: number;
  outputTokens: number;
  /** Portion of input tokens served from prompt cache (cheaper). */
  cachedTokens: number;
  latencyMs: number;
  status: RequestStatus;
  /** 0..1 heuristic quality score (thumbs-up proxy). */
  qualityScore: number;
  /** Billed cost of this request in USD. */
  costUsd: number;
}

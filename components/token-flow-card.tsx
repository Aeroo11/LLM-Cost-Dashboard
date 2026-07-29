import { Coins } from "lucide-react";
import type { Summary } from "@/lib/aggregate";
import { formatPercent, formatTokens } from "@/lib/format";
import { Card } from "./ui/card";
import { Meter } from "./ui/meter";

/**
 * Where the tokens went, and how many of them were free.
 *
 * Cache coverage was previously the sixth item in a run of 14px text, which is
 * the wrong weight for the number the caching insight is entirely about. Giving
 * it a mark of its own means the two panels reinforce each other.
 */
export function TokenFlowCard({ summary }: { summary: Summary }) {
  const input = summary.totalInputTokens;
  const cached = Math.min(summary.totalCachedTokens, input);
  const fresh = Math.max(0, input - cached);
  const coverage = input > 0 ? cached / input : 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Coins
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-text-subtle"
            />
            Token flow
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Input split by cache, and what came back out
          </p>
        </div>
      </div>

      <p className="mt-4 flex items-baseline gap-2">
        <span className="text-stat font-semibold">{formatPercent(coverage, 0)}</span>
        <span className="text-xs text-text-muted">of input served from cache</span>
      </p>

      <Meter
        className="mt-4"
        segments={[
          { value: input > 0 ? cached / input : 0, color: "var(--success)", label: "Cached" },
          { value: input > 0 ? fresh / input : 0, color: "var(--accent)", label: "Fresh" },
        ]}
      />

      <dl className="mt-3 flex justify-between text-eyebrow uppercase text-text-muted">
        {[
          ["Cached in", formatTokens(cached)],
          ["Fresh in", formatTokens(fresh)],
          ["Out", formatTokens(summary.totalOutputTokens)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt>{label}</dt>
            <dd className="text-xs normal-case tabular-nums text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

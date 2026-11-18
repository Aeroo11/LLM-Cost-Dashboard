import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The one card shell. Every raised surface in the app composes this rather than
 * re-typing the recipe, so a change to radius or elevation is a one-line diff.
 *
 * No hover state by design — a card that lifts on hover but isn't clickable is
 * a lie. Interactive children carry their own affordances.
 */
export function Card({
  as: As = "div",
  padded = true,
  raised = false,
  className,
  children,
}: {
  as?: "div" | "section" | "article";
  padded?: boolean;
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <As
      className={cn(
        "rounded-panel border border-border bg-surface",
        raised ? "shadow-raised" : "shadow-panel",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </As>
  );
}

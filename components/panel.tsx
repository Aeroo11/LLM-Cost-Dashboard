import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card } from "./ui/card";

export function Panel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            {Icon && (
              <Icon
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-text-subtle"
              />
            )}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Legend chip used across charts — a coloured dot + label in ink, never colour-alone. */
export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

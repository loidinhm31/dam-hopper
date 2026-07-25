import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils.js";

export interface UsageMetricCardProps {
  label: string;
  value: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "default" | "primary" | "success" | "warning" | "danger";
  unavailable?: boolean;
  className?: string;
}

const toneStyles = {
  default: "text-[var(--color-text)]",
  primary: "text-[var(--color-primary)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  danger: "text-[var(--color-danger)]",
} as const;

export function UsageMetricCard({
  label,
  value,
  description,
  icon: Icon,
  tone = "default",
  unavailable = false,
  className,
}: UsageMetricCardProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        "min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{label}</p>
        {Icon ? <Icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", toneStyles[tone])} /> : null}
      </div>
      <p className={cn("mt-1.5 truncate text-xl font-semibold tabular-nums", unavailable ? "text-[var(--color-text-muted)]" : toneStyles[tone])}>
        {unavailable ? "—" : value}
      </p>
      {description ? (
        <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-[var(--color-text-muted)]">
          {unavailable ? <Info aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" /> : null}
          <span>{description}</span>
        </p>
      ) : null}
    </section>
  );
}

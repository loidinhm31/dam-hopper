import { cn } from "@/lib/utils.js";

type Variant = "success" | "danger" | "warning" | "neutral" | "primary";

const variantClasses: Record<Variant, string> = {
  success: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
  danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  neutral: "bg-[var(--color-border)] text-[var(--color-text-muted)]",
  primary: "bg-[var(--color-primary)]/15 text-[var(--color-primary)]",
};

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
}

export function Badge({ children, variant = "neutral", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

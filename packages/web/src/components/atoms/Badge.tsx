import { cn } from "@/lib/utils.js";

type Variant = "success" | "danger" | "warning" | "neutral" | "primary";

const variantClasses: Record<Variant, string> = {
  success: "bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/30",
  danger:  "bg-[var(--color-danger)]/10  text-[var(--color-danger)]  border border-[var(--color-danger)]/30",
  warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)] border border-[var(--color-warning)]/30",
  neutral: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]",
  primary: "bg-[var(--color-primary)]/10 text-[var(--color-primary)] border border-[var(--color-primary)]/30",
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
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium tracking-wide uppercase",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

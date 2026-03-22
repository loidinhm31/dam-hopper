import { cn } from "@/lib/utils.js";
import type { ButtonHTMLAttributes } from "react";

export const inputClass =
  "w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] " +
  "text-sm text-[var(--color-text)] px-2.5 py-1.5 outline-none " +
  "focus:border-[var(--color-primary)] transition-colors " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50",
  secondary:
    "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:bg-[var(--color-border)] border border-[var(--color-border)]",
  danger:
    "bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25",
  ghost:
    "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled ?? loading}
      className={cn(
        "inline-flex items-center gap-1.5 rounded font-medium transition-colors cursor-pointer",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {loading && (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

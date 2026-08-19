import type { ReactNode } from "react";

export function SshForwardProfileField({
  label,
  error,
  errorId,
  children,
}: {
  label: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
      {label}
      {children}
      {error ? (
        <span
          id={errorId}
          className="text-[11px] normal-case tracking-normal text-[var(--color-danger)]"
        >
          {error}
        </span>
      ) : null}
    </label>
  );
}

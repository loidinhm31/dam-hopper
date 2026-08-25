import { cn } from "@/lib/utils.js";
import type { ReactNode } from "react";

interface SettingsActionRowProps {
  title: string;
  description: ReactNode;
  action: ReactNode;
  status?: ReactNode;
  danger?: boolean;
}

export function SettingsActionRow({
  title,
  description,
  action,
  status,
  danger = false,
}: SettingsActionRowProps) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium",
            danger ? "text-[var(--color-danger)]" : "text-[var(--color-text)]",
          )}
        >
          {title}
        </p>
        <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
          {description}
        </div>
        {status && <div className="mt-2 text-xs leading-5">{status}</div>}
      </div>
      <div className="flex shrink-0 items-center sm:justify-end">{action}</div>
    </div>
  );
}

interface SettingsStatusMessageProps {
  tone: "success" | "danger";
  children: ReactNode;
}

export function SettingsStatusMessage({
  tone,
  children,
}: SettingsStatusMessageProps) {
  return (
    <p
      className={cn(
        tone === "success"
          ? "text-[var(--color-success)]"
          : "text-[var(--color-danger)]",
      )}
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "success" ? "polite" : undefined}
    >
      {children}
    </p>
  );
}

import { cn } from "@/lib/utils.js";
import type { SSEStatus } from "@/hooks/useSSE.js";

interface Props {
  status: SSEStatus;
}

const labels: Record<SSEStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
};

export function ConnectionDot({ status }: Props) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          status === "connected" && "bg-[var(--color-success)]",
          status === "connecting" && "bg-[var(--color-warning)] animate-pulse",
          status === "disconnected" && "bg-[var(--color-danger)]",
        )}
      />
      {labels[status]}
    </span>
  );
}

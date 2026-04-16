import { cn } from "@/lib/utils.js";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

interface Props {
  status: ConnectionStatus;
  collapsed?: boolean;
  devMode?: boolean;
}

const DOT_CLASS: Record<ConnectionStatus, string> = {
  connected:    "bg-[var(--color-success)] status-glow-green",
  connecting:   "bg-yellow-400 animate-pulse",
  disconnected: "bg-[var(--color-text-muted)]",
  error:        "bg-red-500",
};

const LABEL_CLASS: Record<ConnectionStatus, string> = {
  connected:    "text-[var(--color-success)]/70",
  connecting:   "text-yellow-400/70",
  disconnected: "text-[var(--color-text-muted)]/70",
  error:        "text-red-400/70",
};

const LABELS: Record<ConnectionStatus, string> = {
  connected:    "online",
  connecting:   "connecting",
  disconnected: "offline",
  error:        "error",
};

export function ConnectionDot({ status, collapsed = false, devMode = false }: Props) {
  return (
    <span className="flex items-center gap-1.5 text-xs tracking-wide">
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", DOT_CLASS[status])} />
      {!collapsed && (
        <>
          <span className={cn("uppercase text-[10px] tracking-widest", LABEL_CLASS[status])}>
            {LABELS[status]}
          </span>
          {devMode && status === "connected" && (
            <span className="px-1 py-0.5 text-[9px] font-semibold tracking-wider bg-yellow-500/20 text-yellow-500 rounded uppercase">
              DEV
            </span>
          )}
        </>
      )}
    </span>
  );
}

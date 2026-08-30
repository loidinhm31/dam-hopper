import { useCallback, useSyncExternalStore } from "react";
import {
  getTerminalOutputActivitySnapshot,
  subscribeToTerminalOutputActivity,
} from "@/lib/terminal-output-activity.js";

interface TerminalActivityIndicatorProps {
  sessionId: string;
  alive?: boolean;
}

export function TerminalActivityIndicator({
  sessionId,
  alive,
}: TerminalActivityIndicatorProps) {
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToTerminalOutputActivity(sessionId, listener),
    [sessionId],
  );
  const getSnapshot = useCallback(
    () => getTerminalOutputActivitySnapshot(sessionId),
    [sessionId],
  );
  const activitySnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const presentation =
    alive === false
      ? {
          label: "Stopped",
          title: "Terminal stopped",
          className: "bg-[var(--color-danger)]",
        }
      : !activitySnapshot.streamReady
        ? {
            label: "Output unavailable",
            title: "Output stream unavailable",
            className: "bg-[var(--color-text-muted)]",
          }
        : activitySnapshot.recentOutput
          ? {
              label: "Receiving output",
              title: "Receiving output",
              className: "bg-[var(--color-success)]",
            }
          : {
              label: "Quiet",
              title: "Quiet; no recent output observed",
              className: "bg-[var(--color-warning)]",
            };

  return (
    <>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.className}`}
        title={presentation.title}
      />
      <span className="sr-only">{presentation.label}</span>
    </>
  );
}

export function TerminalRunningIndicator({ running }: { running: boolean }) {
  const label = running ? "Running terminals" : "No running terminals";
  return (
    <>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          running
            ? "bg-[var(--color-success)] status-glow-green"
            : "bg-[var(--color-warning)] status-glow-orange"
        }`}
        title={label}
      />
      <span className="sr-only">{label}</span>
    </>
  );
}

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  getTerminalOutputActivityRevision,
  getTerminalOutputActivitySnapshot,
  getTerminalOutputActivityStatus,
  subscribeToTerminalOutputActivity,
  subscribeToTerminalOutputActivitySessions,
  type TerminalOutputActivityStatus,
} from "@/lib/terminal-output-activity.js";

const PRESENTATION_BY_STATUS: Record<
  TerminalOutputActivityStatus,
  { label: string; title: string; className: string }
> = {
  stopped: {
    label: "Stopped",
    title: "Terminal stopped",
    className: "bg-[var(--color-danger)]",
  },
  unavailable: {
    label: "Output unavailable",
    title: "Output stream unavailable",
    className: "bg-[var(--color-text-muted)]",
  },
  receiving: {
    label: "Receiving output",
    title: "Receiving output",
    className: "bg-[var(--color-success)]",
  },
  quiet: {
    label: "Quiet",
    title: "Quiet; no recent output observed",
    className: "bg-[var(--color-warning)]",
  },
};
interface TerminalProjectActivityTab {
  readonly sessionId: string;
  readonly session?: { readonly alive: boolean };
}

export function TerminalProjectActivityIndicator({
  tabs,
}: {
  tabs: readonly TerminalProjectActivityTab[];
}) {
  const sessionIds = useMemo(() => tabs.map((tab) => tab.sessionId), [tabs]);
  const subscribe = useCallback(
    (listener: () => void) =>
      subscribeToTerminalOutputActivitySessions(sessionIds, listener),
    [sessionIds],
  );
  const activityRevision = useSyncExternalStore(
    subscribe,
    getTerminalOutputActivityRevision,
    getTerminalOutputActivityRevision,
  );
  const hasReceivingOutput = useMemo(
    () =>
      tabs.some(
        (tab) =>
          getTerminalOutputActivityStatus(
            getTerminalOutputActivitySnapshot(tab.sessionId),
            tab.session?.alive,
          ) === "receiving",
      ),
    [activityRevision, tabs],
  );
  const label = hasReceivingOutput
    ? "Receiving terminal output"
    : "No recent terminal output";
  return (
    <>
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          hasReceivingOutput
            ? "bg-[var(--color-success)] status-glow-green"
            : "bg-[var(--color-warning)] status-glow-orange"
        }`}
        title={label}
      />
      <span className="sr-only">{label}</span>
    </>
  );
}
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
    PRESENTATION_BY_STATUS[
      getTerminalOutputActivityStatus(activitySnapshot, alive)
    ];

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

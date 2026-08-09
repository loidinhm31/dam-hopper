// Event bridge — routes backend push events into the in-memory listener bus.
// Forwards WebSocket push events via WsTransport.

import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  getTransport,
  getTransportGeneration,
  subscribeTransportChanges,
} from "../api/transport.js";
import type { ConnectionStatus } from "../components/atoms/ConnectionDot.js";
import { removeExplorerLanguageScanCaches } from "@/lib/explorer-language-scan.js";

export type IpcStatus = ConnectionStatus;

export interface IpcEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

type Listener = (event: IpcEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeIpc(type: string, cb: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(cb);
  return () => listeners.get(type)?.delete(cb);
}

function dispatch(type: string, data: unknown) {
  const event: IpcEvent = { type, data, timestamp: Date.now() };
  listeners.get(type)?.forEach((cb) => cb(event));
  listeners.get("*")?.forEach((cb) => cb(event));
}

const PUSH_EVENT_CHANNELS = [
  "git:progress",
  "status:changed",
  "config:changed",
  "workspace:changed",
  "terminal:changed",
  "port:discovered",
  "port:lost",
  "tunnel:created",
  "tunnel:ready",
  "tunnel:failed",
  "tunnel:stopped",
  "install:progress",
  "install:done",
  "install:failed",
] as const;

let initialized = false;
const unsubscribers: Array<() => void> = [];

function initTransportListeners(): void {
  if (initialized) return;
  initialized = true;

  const transport = getTransport();
  for (const channel of PUSH_EVENT_CHANNELS) {
    const unsub = transport.onEvent(channel, (data) => dispatch(channel, data));
    unsubscribers.push(unsub);
  }
}

/**
 * Reset transport listeners — call before reconfigureTransport() so the new
 * transport gets fresh subscriptions when useIpc() re-runs.
 */
export function resetTransportListeners(): void {
  unsubscribers.forEach((fn) => fn());
  unsubscribers.length = 0;
  initialized = false;
}

/** Duck-type interface for WsTransport status methods. Avoids a hard import cycle. */
export interface HasWsStatus {
  getStatus(): IpcStatus;
  onStatusChange(cb: (status: IpcStatus) => void): () => void;
}

export function hasWsStatus(t: unknown): t is HasWsStatus {
  return (
    typeof t === "object" &&
    t !== null &&
    "getStatus" in t &&
    "onStatusChange" in t
  );
}

export function handleIpcStatusChange(
  status: IpcStatus,
  setStatus: (status: IpcStatus) => void,
  invalidateTerminalSessions: () => void,
): void {
  setStatus(status);
  if (status === "connected") {
    invalidateTerminalSessions();
  }
}

export function handleWorkspaceChanged(
  queryClient: Pick<
    QueryClient,
    "invalidateQueries" | "removeQueries" | "resetQueries" | "setQueriesData"
  >,
): Promise<void> {
  return removeExplorerLanguageScanCaches(queryClient).then(() => {
    void queryClient.invalidateQueries();
    void queryClient.invalidateQueries({ queryKey: ["known-workspaces"] });
  });
}

export function useIpc(): { status: IpcStatus } {
  const qc = useQueryClient();
  const transportGeneration = useSyncExternalStore(
    subscribeTransportChanges,
    getTransportGeneration,
    getTransportGeneration,
  );

  const [wsStatus, setWsStatus] = useState<IpcStatus>(() => {
    try {
      const t = getTransport();
      return hasWsStatus(t) ? t.getStatus() : "connecting";
    } catch {
      return "connecting";
    }
  });

  useEffect(() => {
    initTransportListeners();

    const unsubs = [
      subscribeIpc("status:changed", (e) => {
        try {
          const { projectName } = e.data as { projectName: string };
          void qc.invalidateQueries({
            queryKey: ["project-status", projectName],
          });
          void qc.invalidateQueries({ queryKey: ["projects"] });
        } catch {
          void qc.invalidateQueries({ queryKey: ["projects"] });
        }
      }),

      subscribeIpc("config:changed", () => {
        void qc.invalidateQueries({ queryKey: ["config"] });
        void qc.invalidateQueries({ queryKey: ["workspace"] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }),

      subscribeIpc("workspace:changed", () => {
        void handleWorkspaceChanged(qc);
      }),

      subscribeIpc("terminal:changed", () => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [qc, transportGeneration]);

  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      let cancelled = false;
      const unsubscribe = t.onStatusChange((status) =>
        handleIpcStatusChange(status as IpcStatus, setWsStatus, () => {
          void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
        }),
      );
      queueMicrotask(() => {
        if (!cancelled) setWsStatus(t.getStatus());
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    } catch {
      return;
    }
  }, [qc, transportGeneration]);

  return { status: wsStatus };
}

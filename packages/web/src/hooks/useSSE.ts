// Event bridge — routes main-process push events into the in-memory listener bus.
// In Electron: forwards window.devhub.on() IPC events
// In web mode: forwards WebSocket push events via WsTransport

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTransport, isWebMode } from "../api/transport.js";

export type IpcStatus = "connected";

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

// Push event channel names (same for both transports)
const PUSH_EVENT_CHANNELS = [
  "git:progress",
  "status:changed",
  "config:changed",
  "workspace:changed",
  "terminal:changed",
] as const;

// Register transport listeners once at module level (not per-component)
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

export function useIpc(): { status: IpcStatus } {
  const qc = useQueryClient();

  useEffect(() => {
    initTransportListeners();

    const unsubs = [
      subscribeIpc("status:changed", (e) => {
        try {
          const { projectName } = e.data as { projectName: string };
          void qc.invalidateQueries({ queryKey: ["project-status", projectName] });
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
        void qc.invalidateQueries(); // Nuclear — full workspace change
        void qc.invalidateQueries({ queryKey: ["known-workspaces"] });
      }),

      subscribeIpc("terminal:changed", () => {
        void qc.invalidateQueries({ queryKey: ["terminal-sessions"] });
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  return { status: "connected" };
}

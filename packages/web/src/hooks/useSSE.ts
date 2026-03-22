// IPC event bridge — replaces the former SSE/EventSource implementation.
// Events are pushed from Electron main process via webContents.send() and
// received here via window.devhub.on(). No HTTP, no EventSource.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type SSEStatus = "connected";

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

type Listener = (event: SSEEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeSSE(type: string, cb: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(cb);
  return () => listeners.get(type)?.delete(cb);
}

function dispatch(type: string, data: unknown) {
  const event: SSEEvent = { type, data, timestamp: Date.now() };
  listeners.get(type)?.forEach((cb) => cb(event));
  listeners.get("*")?.forEach((cb) => cb(event));
}

// Channel list is authoritative in the electron package (ipc-channels.ts).
// At runtime, the preload exposes it as window.devhub.eventChannels.
// Falls back to a local copy for non-Electron environments (tests/storybook).
const FALLBACK_EVENT_CHANNELS = [
  "git:progress",
  "status:changed",
  "config:changed",
  "workspace:changed",
] as const;

function getEventChannels(): readonly string[] {
  return (
    (window.devhub as { eventChannels?: readonly string[] }).eventChannels ??
    FALLBACK_EVENT_CHANNELS
  );
}

// Register IPC listeners once at module level (not per-component).
// These forward main-process pushes into the in-memory listener bus.
const unsubscribers: Array<() => void> = [];

function initIpcListeners() {
  if (unsubscribers.length > 0) return; // already initialized
  for (const channel of getEventChannels()) {
    const unsub = window.devhub.on(channel, (data) => dispatch(channel, data));
    unsubscribers.push(unsub);
  }
}

export function useSSE(): { status: SSEStatus } {
  const qc = useQueryClient();

  useEffect(() => {
    initIpcListeners();

    const unsubs = [
      subscribeSSE("status:changed", (e) => {
        try {
          const { projectName } = e.data as { projectName: string };
          void qc.invalidateQueries({ queryKey: ["project-status", projectName] });
          void qc.invalidateQueries({ queryKey: ["projects"] });
        } catch {
          void qc.invalidateQueries({ queryKey: ["projects"] });
        }
      }),

      subscribeSSE("config:changed", () => {
        void qc.invalidateQueries({ queryKey: ["config"] });
        void qc.invalidateQueries({ queryKey: ["workspace"] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }),

      subscribeSSE("workspace:changed", () => {
        void qc.invalidateQueries(); // Nuclear — full workspace change
        void qc.invalidateQueries({ queryKey: ["known-workspaces"] });
      }),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  // IPC is always connected — no reconnect logic needed
  return { status: "connected" };
}

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type SSEStatus = "connecting" | "connected" | "disconnected";

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

function dispatch(type: string, rawData: string) {
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // leave as string
  }
  const event: SSEEvent = { type, data, timestamp: Date.now() };
  listeners.get(type)?.forEach((cb) => cb(event));
  listeners.get("*")?.forEach((cb) => cb(event));
}

export function useSSE() {
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const qc = useQueryClient();
  const retryDelay = useRef(1000);
  const esRef = useRef<EventSource | null>(null);
  // Track pending retry timer so we can cancel it on unmount (C1 fix)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource("/api/events");
    esRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      retryDelay.current = 1000;
    };

    es.onerror = () => {
      setStatus("disconnected");
      es.close();
      esRef.current = null;
      const delay = Math.min(retryDelay.current, 30_000);
      retryDelay.current = Math.min(delay * 2, 30_000);
      retryTimerRef.current = setTimeout(connect, delay);
    };

    const eventTypes = [
      "git:progress",
      "build:progress",
      "process:event",
      "status:changed",
      "config:changed",
    ] as const;

    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        dispatch(type, e.data as string);
      });
    }

    // Invalidate queries on status:changed
    es.addEventListener("status:changed", (e: MessageEvent) => {
      try {
        const { projectName } = JSON.parse(e.data as string) as {
          projectName: string;
        };
        void qc.invalidateQueries({
          queryKey: ["project-status", projectName],
        });
        void qc.invalidateQueries({ queryKey: ["projects"] });
      } catch {
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }
    });

    es.addEventListener("process:event", () => {
      void qc.invalidateQueries({ queryKey: ["processes"] });
    });

    es.addEventListener("config:changed", () => {
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    });
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      // Cancel any pending retry timer before closing (C1 fix)
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  return { status };
}

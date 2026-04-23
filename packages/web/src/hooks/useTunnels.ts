import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport } from "../api/transport.js";
import { subscribeIpc, hasWsStatus } from "./useSSE.js";
import type { TunnelInfo } from "../api/client.js";

export function useTunnels() {
  const qc = useQueryClient();
  const transport = getTransport();

  const query = useQuery({
    queryKey: ["tunnels"],
    queryFn: () => transport.invoke<TunnelInfo[]>("tunnel:list"),
  });

  // Patch cache in-place from WS push events — no round-trip
  useEffect(() => {
    const unsubs = [
      subscribeIpc("tunnel:created", ({ data }) => {
        const next = data as TunnelInfo;
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.some((t) => t.id === next.id) ? prev : [...prev, next],
        );
      }),
      subscribeIpc("tunnel:ready", ({ data }) => {
        const { id, url } = data as { id: string; url: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.map((t) => (t.id === id ? { ...t, status: "ready" as const, url } : t)),
        );
      }),
      subscribeIpc("tunnel:failed", ({ data }) => {
        const { id, error } = data as { id: string; error: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.map((t) => (t.id === id ? { ...t, status: "failed" as const, error } : t)),
        );
      }),
      subscribeIpc("tunnel:stopped", ({ data }) => {
        const { id } = data as { id: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.filter((t) => t.id !== id),
        );
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  // Resync on WS reconnect to recover from missed events
  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      // Init from current status so first-connect doesn't double-fetch
      let wasConnected = t.getStatus() === "connected";
      return t.onStatusChange((status) => {
        if (status === "connected" && !wasConnected) {
          void qc.invalidateQueries({ queryKey: ["tunnels"] });
        }
        wasConnected = status === "connected";
      });
    } catch {
      return;
    }
  }, [qc]);

  const createTunnel = useCallback(
    async (port: number, label: string) => {
      await transport.invoke("tunnel:create", { port, label });
      // WS tunnel:created patches the list; no manual invalidate needed
    },
    [transport],
  );

  const stopTunnel = useCallback(
    async (id: string) => {
      // Optimistic remove with rollback on failure
      const snapshot = qc.getQueryData<TunnelInfo[]>(["tunnels"]);
      qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
        prev.filter((t) => t.id !== id),
      );
      try {
        await transport.invoke("tunnel:stop", { id });
      } catch (e) {
        qc.setQueryData(["tunnels"], snapshot);
        throw e;
      }
    },
    [qc, transport],
  );

  return {
    tunnels: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createTunnel,
    stopTunnel,
  };
}

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport } from "../api/transport.js";
import { subscribeIpc, hasWsStatus } from "./useSSE.js";
import type { TunnelInfo } from "../api/client.js";

export interface InstallState {
  status: "idle" | "installing" | "done" | "error";
  downloaded: number;
  total: number;
  error?: string;
}

export function useTunnels() {
  const qc = useQueryClient();
  const transport = getTransport();

  const [installState, setInstallState] = useState<InstallState>({
    status: "idle",
    downloaded: 0,
    total: 0,
  });

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

  // Install progress events
  useEffect(() => {
    const unsubs = [
      subscribeIpc("install:progress", ({ data }) => {
        const { downloaded, total } = data as { downloaded: number; total: number };
        setInstallState({ status: "installing", downloaded, total });
      }),
      subscribeIpc("install:done", () => {
        setInstallState({ status: "done", downloaded: 0, total: 0 });
      }),
      subscribeIpc("install:failed", ({ data }) => {
        const { error } = data as { error: string };
        setInstallState({ status: "error", downloaded: 0, total: 0, error });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);

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
          // Reconcile install state — events sent while disconnected are lost.
          void t
            .invoke<{ installing: boolean; installed: boolean }>("tunnel:install:status")
            .then(({ installed, installing: stillInstalling }) => {
              setInstallState((s) => {
                if (s.status !== "installing") return s;
                if (installed) return { status: "done", downloaded: 0, total: 0 };
                if (!stillInstalling) return { status: "idle", downloaded: 0, total: 0 };
                return s;
              });
            })
            .catch(() => {
              // best-effort; if endpoint unavailable just reset to idle
              setInstallState((s) =>
                s.status === "installing" ? { status: "idle", downloaded: 0, total: 0 } : s,
              );
            });
        }
        wasConnected = status === "connected";
      });
    } catch {
      return;
    }
  }, [qc]);

  const installCloudflared = useCallback(async () => {
    setInstallState({ status: "installing", downloaded: 0, total: 0 });
    try {
      await transport.invoke("tunnel:install");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // 409 = already installing server-side; keep "installing" state and wait for WS events.
      if (msg.toLowerCase().includes("already in progress")) return;
      setInstallState({
        status: "error",
        downloaded: 0,
        total: 0,
        error: msg || "Install request failed",
      });
    }
  }, [transport]);

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
    installCloudflared,
    installState,
  };
}

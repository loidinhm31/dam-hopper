import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport } from "../api/transport.js";
import { subscribeIpc, hasWsStatus } from "./useSSE.js";
import type { TunnelInfo, DetectedPort } from "../api/client.js";

export interface InstallState {
  status: "idle" | "installing" | "done" | "error";
  downloaded: number;
  total: number;
  error?: string;
}

export interface PortEntry {
  port: number;
  project: string | null;
  state: "provisional" | "listening" | "lost";
  /** Active tunnel for this port, or null if none. */
  tunnel: TunnelInfo | null;
}

export function usePorts(): {
  ports: PortEntry[];
  isLoading: boolean;
  isError: boolean;
  createTunnel: (port: number, label: string) => Promise<void>;
  stopTunnel: (id: string) => Promise<void>;
  installCloudflared: () => Promise<void>;
  installState: InstallState;
} {
  const qc = useQueryClient();
  const transport = getTransport();

  const [installState, setInstallState] = useState<InstallState>({
    status: "idle",
    downloaded: 0,
    total: 0,
  });

  const portsQuery = useQuery({
    queryKey: ["ports"],
    queryFn: async () => {
      const resp = await transport.invoke<{ ports: DetectedPort[] }>("port:list");
      return resp.ports;
    },
  });

  const tunnelsQuery = useQuery({
    queryKey: ["tunnels"],
    queryFn: () => transport.invoke<TunnelInfo[]>("tunnel:list"),
  });

  // Merge detected ports + active tunnels
  const ports = useMemo<PortEntry[]>(() => {
    const detected = portsQuery.data ?? [];
    const tunnels = tunnelsQuery.data ?? [];
    const tunnelByPort = new Map(tunnels.map((t) => [t.port, t]));

    const result: PortEntry[] = detected.map((p) => ({
      port: p.port,
      project: p.project,
      state: p.state,
      tunnel: tunnelByPort.get(p.port) ?? null,
    }));

    // Append tunnel-only entries (tunnels for ports not currently in /proc/net/tcp)
    const detectedPorts = new Set(detected.map((p) => p.port));
    for (const t of tunnels) {
      if (!detectedPorts.has(t.port)) {
        result.push({
          port: t.port,
          project: t.label,
          state: "listening",
          tunnel: t,
        });
      }
    }

    return result;
  }, [portsQuery.data, tunnelsQuery.data]);

  // Port push events — patch ["ports"] cache in-place
  useEffect(() => {
    const unsubs = [
      subscribeIpc("port:discovered", ({ data }) => {
        const port = data as DetectedPort;
        qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) => {
          const exists = prev.some((p) => p.port === port.port);
          if (exists) {
            return prev.map((p) => (p.port === port.port ? port : p));
          }
          return [...prev, port];
        });
      }),
      subscribeIpc("port:lost", ({ data }) => {
        const { port } = data as { port: number };
        qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) =>
          prev.filter((p) => p.port !== port),
        );
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc]);

  // Tunnel push events — patch ["tunnels"] cache in-place
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

  // Resync both caches on WS reconnect
  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      let wasConnected = t.getStatus() === "connected";
      return t.onStatusChange((status) => {
        if (status === "connected" && !wasConnected) {
          void qc.invalidateQueries({ queryKey: ["ports"] });
          void qc.invalidateQueries({ queryKey: ["tunnels"] });
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
    },
    [transport],
  );

  const stopTunnel = useCallback(
    async (id: string) => {
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
    ports,
    isLoading: portsQuery.isLoading || tunnelsQuery.isLoading,
    isError: portsQuery.isError || tunnelsQuery.isError,
    createTunnel,
    stopTunnel,
    installCloudflared,
    installState,
  };
}

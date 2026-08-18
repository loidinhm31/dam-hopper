import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport, getTransportGeneration } from "../api/transport.js";
import { getActiveProfileId } from "../api/server-config.js";
import { subscribeIpc, hasWsStatus } from "./use-sse.js";
import { useTransportGeneration } from "./use-transport-generation.js";
import type { TunnelInfo, DetectedPort } from "../api/client.js";
import {
  acceptsTerminalPortIncarnation,
  confirmTerminalPortIncarnation,
  retireTerminalPortIncarnation,
} from "@/lib/terminal-incarnation-state.js";

export interface InstallState {
  status: "idle" | "installing" | "done" | "error";
  downloaded: number;
  total: number;
  error?: string;
}

const IDLE_INSTALL_STATE: InstallState = {
  status: "idle",
  downloaded: 0,
  total: 0,
};

export interface PortEntry {
  port: number;
  project: string | null;
  state: "provisional" | "listening" | "lost";
  sessionId: string | null;
  /** Active tunnel for this port, or null if none. */
  tunnel: TunnelInfo | null;
}

/** Reject delayed port events before they can seed an empty query cache. */
export function acceptsDetectedPortEvent(port: DetectedPort): boolean {
  return (
    !!port &&
    typeof port.session_id === "string" &&
    Number.isSafeInteger(port.incarnation) &&
    acceptsTerminalPortIncarnation(
      port.session_id,
      port.port,
      port.incarnation,
    )
  );
}

export function usePorts(): {
  ports: PortEntry[];
  isLoading: boolean;
  isError: boolean;
  createTunnel: (port: number, label: string) => Promise<void>;
  stopTunnel: (id: string) => Promise<void>;
  killPortSession: (sessionId: string) => Promise<void>;
  installCloudflared: () => Promise<void>;
  installState: InstallState;
} {
  const qc = useQueryClient();
  const transportGeneration = useTransportGeneration();
  const transport = getTransport();

  const [installStateSnapshot, setInstallStateSnapshot] = useState<{
    generation: number;
    state: InstallState;
  }>({ generation: transportGeneration, state: IDLE_INSTALL_STATE });
  const updateInstallState = useCallback(
    (next: SetStateAction<InstallState>) => {
      setInstallStateSnapshot((previous) => {
        const previousState =
          previous.generation === transportGeneration
            ? previous.state
            : IDLE_INSTALL_STATE;
        return {
          generation: transportGeneration,
          state: typeof next === "function" ? next(previousState) : next,
        };
      });
    },
    [transportGeneration],
  );
  const currentInstallState =
    installStateSnapshot.generation === transportGeneration
      ? installStateSnapshot.state
      : IDLE_INSTALL_STATE;

  const portsQuery = useQuery({
    queryKey: ["ports"],
    queryFn: async () => {
      const resp = await transport.invoke<{ ports: DetectedPort[] }>(
        "port:list",
      );
      for (const port of resp.ports) {
        confirmTerminalPortIncarnation(
          port.session_id,
          port.port,
          port.incarnation,
        );
      }
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
      sessionId: p.session_id,
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
          sessionId: null,
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
        if (!acceptsDetectedPortEvent(port)) return;
        qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) => {
          const existing = prev.find((p) => p.port === port.port);
          if (
            existing &&
            Number.isSafeInteger(existing.incarnation) &&
            port.incarnation < existing.incarnation
          ) {
            return prev;
          }
          if (existing) {
            return prev.map((p) => (p.port === port.port ? port : p));
          }
          return [...prev, port];
        });
      }),
      subscribeIpc("port:lost", ({ data }) => {
        if (typeof data !== "object" || data === null) return;
        const { port, session_id, incarnation } = data as {
          port?: unknown;
          session_id?: unknown;
          incarnation?: unknown;
        };
        if (
          typeof port !== "number" ||
          !Number.isSafeInteger(port) ||
          typeof session_id !== "string" ||
          typeof incarnation !== "number" ||
          !Number.isSafeInteger(incarnation)
        ) {
          return;
        }
        retireTerminalPortIncarnation(session_id, port, incarnation);
        qc.setQueryData<DetectedPort[]>(["ports"], (prev = []) =>
          prev.filter((p) => p.port !== port || p.incarnation !== incarnation),
        );
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc, transportGeneration]);

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
          prev.map((t) =>
            t.id === id ? { ...t, status: "ready" as const, url } : t,
          ),
        );
      }),
      subscribeIpc("tunnel:failed", ({ data }) => {
        const { id, error } = data as { id: string; error: string };
        qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
          prev.map((t) =>
            t.id === id ? { ...t, status: "failed" as const, error } : t,
          ),
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
  }, [qc, transportGeneration]);

  // Install progress events
  useEffect(() => {
    const isCurrentTransport = () => getTransport() === transport;
    const unsubs = [
      subscribeIpc("install:progress", ({ data }) => {
        if (!isCurrentTransport()) return;
        const { downloaded, total } = data as {
          downloaded: number;
          total: number;
        };
        updateInstallState({ status: "installing", downloaded, total });
      }),
      subscribeIpc("install:done", () => {
        if (!isCurrentTransport()) return;
        updateInstallState({ status: "done", downloaded: 0, total: 0 });
      }),
      subscribeIpc("install:failed", ({ data }) => {
        if (!isCurrentTransport()) return;
        const { error } = data as { error: string };
        updateInstallState({ status: "error", downloaded: 0, total: 0, error });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [transport, transportGeneration, updateInstallState]);

  // Resync both caches on WS reconnect
  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      const boundGeneration = transportGeneration;
      let wasConnected = t.getStatus() === "connected";
      return t.onStatusChange((status) => {
        if (status === "connected" && !wasConnected) {
          void qc.invalidateQueries({ queryKey: ["ports"] });
          void qc.invalidateQueries({ queryKey: ["tunnels"] });
          void t
            .invoke<{ installing: boolean; installed: boolean }>(
              "tunnel:install:status",
            )
            .then(({ installed, installing: stillInstalling }) => {
              if (
                getTransport() !== t ||
                getTransportGeneration() !== boundGeneration
              ) {
                return;
              }
              updateInstallState((s) => {
                if (s.status !== "installing") return s;
                if (installed)
                  return { status: "done", downloaded: 0, total: 0 };
                if (!stillInstalling)
                  return { status: "idle", downloaded: 0, total: 0 };
                return s;
              });
            })
            .catch(() => {
              if (
                getTransport() !== t ||
                getTransportGeneration() !== boundGeneration
              ) {
                return;
              }
              updateInstallState((s) =>
                s.status === "installing"
                  ? { status: "idle", downloaded: 0, total: 0 }
                  : s,
              );
            });
        }
        wasConnected = status === "connected";
      });
    } catch {
      return;
    }
  }, [qc, transportGeneration, updateInstallState]);

  const installCloudflared = useCallback(async () => {
    const requestGeneration = transportGeneration;
    const requestTransport = transport;
    updateInstallState({ status: "installing", downloaded: 0, total: 0 });
    try {
      await requestTransport.invoke("tunnel:install");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.toLowerCase().includes("already in progress")) return;
      if (
        getTransport() !== requestTransport ||
        getTransportGeneration() !== requestGeneration
      ) {
        return;
      }
      updateInstallState({
        status: "error",
        downloaded: 0,
        total: 0,
        error: msg || "Install request failed",
      });
    }
  }, [transport, transportGeneration, updateInstallState]);

  const createTunnel = useCallback(
    async (port: number, label: string) => {
      await transport.invoke("tunnel:create", { port, label });
    },
    [transport],
  );

  const stopTunnel = useCallback(
    async (id: string) => {
      const mutationProfileId = getActiveProfileId();
      const snapshot = qc.getQueryData<TunnelInfo[]>(["tunnels"]);
      qc.setQueryData<TunnelInfo[]>(["tunnels"], (prev = []) =>
        prev.filter((t) => t.id !== id),
      );
      try {
        await transport.invoke("tunnel:stop", { id });
      } catch (e) {
        if (
          getActiveProfileId() === mutationProfileId &&
          getTransport() === transport
        ) {
          qc.setQueryData(["tunnels"], snapshot);
        }
        throw e;
      }
    },
    [qc, transport],
  );

  const killPortSession = useCallback(
    async (sessionId: string) => {
      await transport.invoke("terminal:kill", sessionId);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["ports"] }),
        qc.invalidateQueries({ queryKey: ["terminal-sessions"] }),
      ]);
    },
    [qc, transport],
  );

  return {
    ports,
    isLoading: portsQuery.isLoading || tunnelsQuery.isLoading,
    isError: portsQuery.isError || tunnelsQuery.isError,
    createTunnel,
    stopTunnel,
    killPortSession,
    installCloudflared,
    installState: currentInstallState,
  };
}

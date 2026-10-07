import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type SetStateAction,
} from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { getTransport, getTransportGeneration } from "../api/transport.js";
import { getActiveProfileId, getProfiles, subscribeToProfileChanges, type ServerProfile } from "../api/server-config.js";
import { getTransport as getBoundTransport, getConnectionSnapshot, isCurrentConnection, subscribeConnections } from "../api/connections.js";
import { profilePortsQueryKey, profileTunnelsQueryKey } from "../api/query-client.js";
import type { ConnectionRef, ProfileId } from "../api/ownership.js";
import { subscribeIpc, hasWsStatus } from "./use-sse.js";
import { useTransportGeneration } from "./use-transport-generation.js";
import type { TunnelInfo, DetectedPort } from "../api/client.js";
import { subscribeTunnelCacheEvents } from "./tunnel-cache-events.js";
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
const EMPTY_PROFILES: ServerProfile[] = [];
const getEmptyProfiles = () => EMPTY_PROFILES;


export interface PortEntry {
  profileId: string;
  port: number;
  project: string | null;
  state: "provisional" | "listening" | "lost" | "unknown";
  sessionId: string | null;
  incarnation?: number;
  /** Active tunnel for this port, or null if none. */
  tunnel: TunnelInfo | null;
}

export function portEntryKey(entry: PortEntry): string {
  return `${entry.profileId}:${entry.port}:${entry.sessionId ?? ""}:${entry.incarnation ?? 0}`;
}

/** Reject delayed port events before they can seed an empty query cache. */
export function acceptsDetectedPortEvent(port: DetectedPort, profileId: ProfileId): boolean {
  return (
    !!port &&
    typeof port.session_id === "string" &&
    Number.isSafeInteger(port.incarnation) &&
    acceptsTerminalPortIncarnation({ profileId, id: port.session_id }, port.port, port.incarnation)
  );
}

export function usePorts(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
  aggregate?: boolean;
}): {
  ports: PortEntry[];
  isLoading: boolean;
  isError: boolean;
  createTunnel: (port: number, label: string, targetProfileId?: string) => Promise<void>;
  stopTunnel: (id: string, targetProfileId?: string) => Promise<void>;
  killPortSession: (sessionId: string, targetProfileId?: string) => Promise<void>;
  installCloudflared: (targetProfileId?: string) => Promise<void>;
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

  const profiles = useSyncExternalStore(
    subscribeToProfileChanges,
    getProfiles,
    getEmptyProfiles,
  );

  const ownerProfileId = options?.owner?.profileId;
  const explicitProfileId = options?.profileId;
  const aggregate = options?.aggregate;

  const targetProfiles = useMemo(() => {
    if (ownerProfileId) {
      return [{ id: ownerProfileId }];
    }
    if (explicitProfileId && !aggregate) {
      return [{ id: explicitProfileId }];
    }
    if (profiles.length > 0) {
      return profiles;
    }
    const active = getActiveProfileId();
    return [{ id: active || "default" }];
  }, [ownerProfileId, explicitProfileId, aggregate, profiles]);

  useSyncExternalStore(
    subscribeConnections,
    () => targetProfiles.map(({ id }) => {
      const snapshot = getConnectionSnapshot(id);
      return `${id}:${snapshot?.owner.generation ?? 0}:${snapshot?.status ?? "disconnected"}`;
    }).join("|"),
    () => "",
  );
  const targetOwners = targetProfiles.map(({ id }) =>
    options?.owner?.profileId === id
      ? options.owner
      : getConnectionSnapshot(id)?.owner ?? { profileId: id, generation: 0 },
  );
  const portQueries = useQueries({
    queries: targetProfiles.map((p) => {
      const conn = targetOwners.find((owner) => owner.profileId === p.id)!;
      return {
        queryKey: profilePortsQueryKey(conn),
        enabled: isCurrentConnection(conn),
        queryFn: async () => {
          const resp = await getBoundTransport(conn).invoke<{ ports: DetectedPort[] }>("port:list");
          if (!isCurrentConnection(conn)) return [];
          for (const port of resp.ports) {
            confirmTerminalPortIncarnation(
              { profileId: conn.profileId, id: port.session_id },
              port.port,
              port.incarnation,
            );
          }
          return resp.ports;
        },
      };
    }),
  });

  const tunnelQueries = useQueries({
    queries: targetProfiles.map((p) => {
      const conn = targetOwners.find((owner) => owner.profileId === p.id)!;
      return {
        queryKey: profileTunnelsQueryKey(conn),
        enabled: isCurrentConnection(conn),
        queryFn: () => getBoundTransport(conn).invoke<TunnelInfo[]>("tunnel:list"),
      };
    }),
  });

  // Merge detected ports + active tunnels across target profiles
  const ports = useMemo<PortEntry[]>(() => {
    const result: PortEntry[] = [];
    for (let i = 0; i < targetProfiles.length; i++) {
      const profileId = targetProfiles[i].id;
      if (!isCurrentConnection(targetOwners[i])) continue;
      const detected: DetectedPort[] = (portQueries[i]?.data as DetectedPort[] | undefined) ?? [];
      const tunnels: TunnelInfo[] = (tunnelQueries[i]?.data as TunnelInfo[] | undefined) ?? [];
      const tunnelByPort = new Map<number, TunnelInfo>(tunnels.map((t: TunnelInfo) => [t.port, t]));

      for (const p of detected) {
        result.push({
          profileId,
          port: p.port,
          project: p.project,
          state: p.state,
          sessionId: p.session_id,
          incarnation: p.incarnation,
          tunnel: tunnelByPort.get(p.port) ?? null,
        });
      }

      const detectedPorts = new Set(detected.map((p: DetectedPort) => p.port));
      for (const t of tunnels) {
        if (!detectedPorts.has(t.port)) {
          result.push({
            profileId,
            port: t.port,
            project: t.label,
            state: "unknown",
            sessionId: null,
            tunnel: t,
          });
        }
      }
    }
    return result;
  }, [targetProfiles, portQueries, tunnelQueries]);
  // Port push events — patch ["ports"] cache in-place
  useEffect(() => {
    const unsubs = [
      subscribeIpc("port:discovered", (event) => {
        if (!event.profileId || event.generation === undefined) return;
        const conn = { profileId: event.profileId, generation: event.generation };
        if (!isCurrentConnection(conn)) return;
        const port = event.data as DetectedPort;
        if (!acceptsDetectedPortEvent(port, conn.profileId)) return;
        qc.setQueryData<DetectedPort[]>(profilePortsQueryKey(conn), (prev = []) => {
          const existing = prev.find((p) => p.port === port.port && p.session_id === port.session_id);
          if (
            existing &&
            Number.isSafeInteger(existing.incarnation) &&
            port.incarnation < existing.incarnation
          ) {
            return prev;
          }
          if (existing) {
            return prev.map((p) => (p.port === port.port && p.session_id === port.session_id ? port : p));
          }
          return [...prev, port];
        });
      }),
      subscribeIpc("port:lost", (event) => {
        const data = event.data;
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
        if (!event.profileId || event.generation === undefined) return;
        const conn = { profileId: event.profileId, generation: event.generation };
        if (!isCurrentConnection(conn)) return;
        retireTerminalPortIncarnation({ profileId: conn.profileId, id: session_id }, port, incarnation);
        qc.setQueryData<DetectedPort[]>(profilePortsQueryKey(conn), (prev = []) =>
          prev.filter((p) => p.port !== port || p.session_id !== session_id || p.incarnation !== incarnation),
        );
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [qc, transportGeneration]);

  useEffect(() => subscribeTunnelCacheEvents(qc), [qc]);

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
    async (port: number, label: string, targetProfileId?: string) => {
      const profileId = targetProfileId ?? options?.owner?.profileId ?? options?.profileId ?? getActiveProfileId();
      const conn = targetOwners.find((owner) => owner.profileId === profileId);
      if (!conn || !isCurrentConnection(conn)) throw new Error("Connection changed or disconnected");
      await getBoundTransport(conn).invoke("tunnel:create", { port, label });
      if (isCurrentConnection(conn)) void qc.invalidateQueries({ queryKey: profileTunnelsQueryKey(conn) });
    },
    [options?.owner?.profileId, options?.profileId, qc, targetOwners],
  );

  const stopTunnel = useCallback(
    async (id: string, targetProfileId?: string) => {
      const profileId = targetProfileId ?? options?.owner?.profileId ?? options?.profileId ?? getActiveProfileId();
      const conn = targetOwners.find((owner) => owner.profileId === profileId);
      if (!conn || !isCurrentConnection(conn)) throw new Error("Connection changed or disconnected");
      await getBoundTransport(conn).invoke("tunnel:stop", { id });
      if (isCurrentConnection(conn)) void qc.invalidateQueries({ queryKey: profileTunnelsQueryKey(conn) });
    },
    [options?.owner?.profileId, options?.profileId, qc, targetOwners],
  );

  const killPortSession = useCallback(
    async (sessionId: string, targetProfileId?: string) => {
      const profileId = targetProfileId ?? options?.owner?.profileId ?? options?.profileId ?? getActiveProfileId();
      const conn = targetOwners.find((owner) => owner.profileId === profileId);
      if (!conn || !isCurrentConnection(conn)) throw new Error("Connection changed or disconnected");
      await getBoundTransport(conn).invoke("terminal:kill", sessionId);
      if (!isCurrentConnection(conn)) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: profilePortsQueryKey(conn) }),
        qc.invalidateQueries({ queryKey: ["terminal-sessions"] }),
      ]);
    },
    [options?.owner?.profileId, options?.profileId, qc, targetOwners],
  );

  return {
    ports,
    isLoading: portQueries.some((q) => q.isLoading) || tunnelQueries.some((q) => q.isLoading),
    isError: portQueries.some((q) => q.isError) || tunnelQueries.some((q) => q.isError),
    createTunnel,
    stopTunnel,
    killPortSession,
    installCloudflared,
    installState: currentInstallState,
  };
}

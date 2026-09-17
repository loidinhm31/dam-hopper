import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransport, getTransportGeneration } from "../api/transport.js";
import { getActiveProfileId } from "../api/server-config.js";
import { getTransport as getBoundTransport, getConnectionSnapshot } from "../api/connections.js";
import { profileTunnelsQueryKey } from "../api/query-client.js";
import type { ConnectionRef, ProfileId } from "../api/ownership.js";
import { subscribeIpc, hasWsStatus } from "./use-sse.js";
import { useTransportGeneration } from "./use-transport-generation.js";
import type { TunnelInfo } from "../api/client.js";

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

export function useTunnels(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const transportGeneration = useTransportGeneration();
  const transport = getTransport();
  const profileId = options?.owner?.profileId ?? options?.profileId ?? getActiveProfileId() ?? "default";
  const snap = getConnectionSnapshot(profileId);
  const conn: ConnectionRef = options?.owner ?? snap?.owner ?? { profileId, generation: 0 };
  const boundTransport = getBoundTransport(conn) ?? transport;

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

  const query = useQuery({
    queryKey: profileTunnelsQueryKey(conn),
    queryFn: () => boundTransport.invoke<TunnelInfo[]>("tunnel:list"),
  });

  // Patch cache in-place from WS push events — no round-trip
  useEffect(() => {
    const unsubs = [
      subscribeIpc("tunnel:created", (event) => {
        const next = event.data as TunnelInfo;
        const eventProfileId = event.profileId ?? getActiveProfileId() ?? "default";
        const eventSnap = getConnectionSnapshot(eventProfileId);
        const eventConn = eventSnap?.owner ?? { profileId: eventProfileId, generation: 0 };
        qc.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(eventConn), (prev = []) =>
          prev.some((t) => t.id === next.id) ? prev : [...prev, next],
        );
      }),
      subscribeIpc("tunnel:ready", (event) => {
        const { id, url } = event.data as { id: string; url: string };
        const eventProfileId = event.profileId ?? getActiveProfileId() ?? "default";
        const eventSnap = getConnectionSnapshot(eventProfileId);
        const eventConn = eventSnap?.owner ?? { profileId: eventProfileId, generation: 0 };
        qc.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(eventConn), (prev = []) =>
          prev.map((t) =>
            t.id === id ? { ...t, status: "ready" as const, url } : t,
          ),
        );
      }),
      subscribeIpc("tunnel:failed", (event) => {
        const { id, error } = event.data as { id: string; error: string };
        const eventProfileId = event.profileId ?? getActiveProfileId() ?? "default";
        const eventSnap = getConnectionSnapshot(eventProfileId);
        const eventConn = eventSnap?.owner ?? { profileId: eventProfileId, generation: 0 };
        qc.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(eventConn), (prev = []) =>
          prev.map((t) =>
            t.id === id ? { ...t, status: "failed" as const, error } : t,
          ),
        );
      }),
      subscribeIpc("tunnel:stopped", (event) => {
        const { id } = event.data as { id: string };
        const eventProfileId = event.profileId ?? getActiveProfileId() ?? "default";
        const eventSnap = getConnectionSnapshot(eventProfileId);
        const eventConn = eventSnap?.owner ?? { profileId: eventProfileId, generation: 0 };
        qc.setQueryData<TunnelInfo[]>(profileTunnelsQueryKey(eventConn), (prev = []) =>
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

  // Resync on WS reconnect to recover from missed events
  useEffect(() => {
    try {
      const t = getTransport();
      if (!hasWsStatus(t)) return;
      const boundGeneration = transportGeneration;
      // Init from current status so first-connect doesn't double-fetch
      let wasConnected = t.getStatus() === "connected";
      return t.onStatusChange((status) => {
        if (status === "connected" && !wasConnected) {
          void qc.invalidateQueries({ queryKey: ["tunnels"] });
          // Reconcile install state — events sent while disconnected are lost.
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
              // best-effort; if endpoint unavailable just reset to idle
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
      // 409 = already installing server-side; keep "installing" state and wait for WS events.
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
      // WS tunnel:created patches the list; no manual invalidate needed
    },
    [transport],
  );

  const stopTunnel = useCallback(
    async (id: string) => {
      // Optimistic remove with rollback on failure
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

  return {
    tunnels: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    createTunnel,
    stopTunnel,
    installCloudflared,
    installState: currentInstallState,
  };
}

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type {
  HostResourceAlert,
  HostResourceResourceAlert,
  HostResourceSnapshotV1,
} from "@/api/client.js";
import {
  getProfiles,
  subscribeToProfileChanges,
  getProfileChangeVersion,
  type ServerProfile,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
  isCurrentConnection,
  type ConnectionSnapshot,
  type ConnectionStatus,
} from "@/api/connections.js";
import { resolveTargetOwner, getBoundApiClient } from "@/api/queries.js";
import { profileQueryKey } from "@/api/query-client.js";
import { ConnectionOwnerError, connectionKey, type ConnectionRef } from "@/api/ownership.js";
import {
  registerHostResourceInterest,
  getHostResourceSource,
  subscribeHostResourceSource,
  captureResourceSource,
  isResourceSourceCurrent,
  canUseResourceRest,
} from "@/api/host-resource-stream-coordinator.js";
import {
  resolveHostResourceWatchReason,
  resolveHostResourceFleetSummary,
  resolveHostResourceEntryStatus,
  type HostResourceWatchReason,
  type MultiHostResourceEntry,
  type HostResourceFleetSummary,
  type UseMultiHostResourcesResult,
} from "@/lib/host-resource-state.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";

export type {
  HostResourceWatchReason,
  MultiHostResourceEntry,
  HostResourceFleetSummary,
  UseMultiHostResourcesResult,
};

export interface UseMultiHostResourcesOptions {
  enabled?: boolean;
}

interface WatchedTarget {
  profile: ServerProfile;
  connection: ConnectionSnapshot | null;
  owner: ConnectionRef;
  connected: boolean;
  watchReason: HostResourceWatchReason;
}

type LastAlerts = { alert?: HostResourceAlert | null; alerts?: HostResourceResourceAlert[] };

export function useMultiHostResources({
  enabled = true,
}: UseMultiHostResourcesOptions = {}): UseMultiHostResourcesResult {
  const qc = useQueryClient();
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );
  const profiles = useMemo(() => getProfiles(), [profileVersion]);

  const connectionSignature = useSyncExternalStore(
    subscribeConnections,
    () =>
      JSON.stringify(
        profiles.map((p) => {
          const s = getConnectionSnapshot(p.id);
          return [p.id, s?.status ?? "disconnected", s?.intent ?? false, s?.owner.generation ?? 0];
        }),
      ),
    () => "",
  );

  const watchedTargets = useMemo(() => {
    const list: WatchedTarget[] = [];
    for (const profile of profiles) {
      const snap = getConnectionSnapshot(profile.id);
      const isConnected = snap?.status === "connected";
      const autoConnect = !!profile.autoConnect;
      if (isConnected || autoConnect) {
        const watchReason = resolveHostResourceWatchReason(isConnected, autoConnect);
        if (watchReason) {
          const owner =
            resolveTargetOwner(profile.id) ?? snap?.owner ?? { profileId: profile.id, generation: 0 };
          list.push({ profile, connection: snap, owner, connected: isConnected, watchReason });
        }
      }
    }
    return list;
  }, [profiles, connectionSignature]);
  const interestCleanupsRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const cleanups = interestCleanupsRef.current;
    const currentKeys = new Set<string>();

    if (enabled) {
      for (const target of watchedTargets) {
        if (target.connected) {
          const key = connectionKey(target.owner);
          currentKeys.add(key);
          if (!cleanups.has(key)) {
            cleanups.set(key, registerHostResourceInterest(target.owner, qc, "fleet"));
          }
        }
      }
    }

    for (const [key, dispose] of cleanups.entries()) {
      if (!currentKeys.has(key)) {
        dispose();
        cleanups.delete(key);
      }
    }
  }, [watchedTargets, enabled, qc]);

  useEffect(() => {
    return () => {
      for (const dispose of interestCleanupsRef.current.values()) {
        dispose();
      }
      interestCleanupsRef.current.clear();
    };
  }, []);

  const sourceSignature = useSyncExternalStore(
    useCallback(
      (notify) => {
        const unsubs: Array<() => void> = [];
        for (const target of watchedTargets) {
          if (target.connected) {
            unsubs.push(subscribeHostResourceSource(target.owner, qc, notify));
          }
        }
        return () => {
          for (const unsub of unsubs) unsub();
        };
      },
      [watchedTargets, qc],
    ),
    () =>
      watchedTargets
        .filter((t) => t.connected)
        .map((t) => {
          const s = getHostResourceSource(t.owner, qc);
          return `${t.owner.profileId}:${s.mode}:${s.sourceGeneration}:${s.freshness.serverEpoch}:${s.freshness.isSnapshotFresh}`;
        })
        .join("|"),
    () => "",
  );

  const querySpecs = useMemo(() => {
    return watchedTargets.map((target) => {
      const canRest = target.connected ? canUseResourceRest(target.owner, qc) : false;
      const isQueryEnabled = enabled && target.connected && canRest;
      return {
        queryKey: profileQueryKey(target.owner, "system", "resource-snapshot"),
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<HostResourceSnapshotV1> => {
          if (!target.connected) throw new Error("Target is not connected");
          if (!isCurrentConnection(target.owner) || !canUseResourceRest(target.owner, qc)) {
            const cached = qc.getQueryData<HostResourceSnapshotV1>(
              profileQueryKey(target.owner, "system", "resource-snapshot"),
            );
            if (cached) return cached;
            throw new ConnectionOwnerError("Host resource snapshot REST not permitted", "unavailable");
          }
          const sourceGen = captureResourceSource(target.owner, qc);
          const snapshot = await getBoundApiClient(target.owner).system.resourceSnapshot(signal);
          if (
            !isCurrentConnection(target.owner) ||
            !isResourceSourceCurrent(target.owner, qc, sourceGen) ||
            !canUseResourceRest(target.owner, qc)
          ) {
            const key = profileQueryKey(target.owner, "system", "resource-snapshot");
            const cached = qc.getQueryData<HostResourceSnapshotV1>(key);
            if (cached) return cached;
            const err = new ConnectionOwnerError(
              "Host resource snapshot owner or source is stale",
              "stale",
            );
            const query = qc.getQueryCache().find({ queryKey: key });
            if (query) {
              query.setState({
                status: "error",
                error: err,
                errorUpdatedAt: Date.now(),
              });
            }
            throw err;
          }
          return snapshot;
        },
        enabled: isQueryEnabled,
        refetchInterval: (isQueryEnabled && canRest ? 15_000 : false) as number | false,
      };
    });
  }, [watchedTargets, enabled, qc, sourceSignature]);
  const queryResults = useQueries({ queries: querySpecs });
  const byProfile = useHostResourceAlertPresentationStore((s) => s.byProfile);
  const recordSnapshotAlerts = useHostResourceAlertPresentationStore((s) => s.recordSnapshotAlerts);
  const lastRecordedRef = useRef<Record<string, LastAlerts>>({});

  useEffect(() => {
    if (!enabled) return;
    for (let i = 0; i < watchedTargets.length; i++) {
      const target = watchedTargets[i];
      if (!target.connected) continue;
      const result = queryResults[i];
      if (result?.data && isCurrentConnection(target.owner)) {
        const prev = lastRecordedRef.current[target.profile.id];
        const alert = result.data.alert;
        const alerts = result.data.currentAlerts;
        if (!prev || prev.alert !== alert || prev.alerts !== alerts) {
          lastRecordedRef.current[target.profile.id] = { alert, alerts };
          recordSnapshotAlerts(alert, alerts, target.profile.id);
        }
      }
    }
  }, [watchedTargets, queryResults, enabled, recordSnapshotAlerts]);

  const entries = useMemo<MultiHostResourceEntry[]>(() => {
    return watchedTargets.map((target, index) => {
      const query = queryResults[index];
      const connectionStatus: ConnectionStatus = target.connection?.status ?? "disconnected";
      const isConnected = target.connected;
      const snapshot = query?.data;
      const unreadCount = byProfile[target.profile.id]?.unreadIds.length ?? 0;
      const isLoading = isConnected ? (query?.isLoading ?? false) : false;
      const isFetching = isConnected ? (query?.isFetching ?? false) : false;
      const isError = isConnected ? (query?.isError ?? false) : false;
      const isStale = isConnected ? (query?.isStale ?? false) : false;
      const sourceState = isConnected ? getHostResourceSource(target.owner, qc) : null;

      const status = resolveHostResourceEntryStatus({
        snapshot,
        connectionStatus,
        connected: isConnected,
        isLoading,
        isFetching,
        isError,
        isStale,
        unreadCount,
        freshness: sourceState?.freshness,
        sourceMode: sourceState?.mode,
      });
      return {
        profile: target.profile,
        owner: target.owner,
        connectionStatus,
        connected: isConnected,
        watchReason: target.watchReason,
        snapshot,
        status,
        unreadCount,
        isLoading,
        isFetching,
        isError,
        isStale,
      };
    });
  }, [watchedTargets, queryResults, byProfile, qc, sourceSignature]);

  const summary = useMemo(() => resolveHostResourceFleetSummary(entries), [entries]);

  return {
    configuredProfileCount: profiles.length,
    entries,
    summary,
  };
}

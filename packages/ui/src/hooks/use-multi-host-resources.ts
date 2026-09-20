import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueries } from "@tanstack/react-query";
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
import { ConnectionOwnerError, type ConnectionRef } from "@/api/ownership.js";
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

  const querySpecs = useMemo(() => {
    return watchedTargets.map((target) => {
      const isQueryEnabled = enabled && target.connected;
      return {
        queryKey: profileQueryKey(target.owner, "system", "resource-snapshot"),
        queryFn: async (): Promise<HostResourceSnapshotV1> => {
          if (!target.connected) throw new Error("Target is not connected");
          const snapshot = await getBoundApiClient(target.owner).system.resourceSnapshot();
          if (!isCurrentConnection(target.owner)) {
            throw new ConnectionOwnerError("Host resource snapshot owner is stale", "stale");
          }
          return snapshot;
        },
        enabled: isQueryEnabled,
        refetchInterval: (isQueryEnabled ? 15_000 : false) as number | false,
      };
    });
  }, [watchedTargets, enabled]);

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

      const status = resolveHostResourceEntryStatus({
        snapshot,
        connectionStatus,
        connected: isConnected,
        isLoading,
        isFetching,
        isError,
        isStale,
        unreadCount,
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
  }, [watchedTargets, queryResults, byProfile]);

  const summary = useMemo(() => resolveHostResourceFleetSummary(entries), [entries]);

  return {
    configuredProfileCount: profiles.length,
    entries,
    summary,
  };
}

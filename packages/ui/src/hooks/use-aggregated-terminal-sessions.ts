import { useQueries } from "@tanstack/react-query";
import { useSyncExternalStore, useMemo } from "react";
import type { SessionInfo } from "@/api/client.js";
import {
  getProfiles,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
  getTransport as getConnectionTransport,
} from "@/api/connections.js";
import { profileQueryKey } from "@/api/query-client.js";
import { rememberTerminalSessionIncarnations } from "@/lib/terminal-incarnation-state.js";

export function useAggregatedTerminalSessions(): {
  sessions: SessionInfo[];
  isSuccess: boolean;
  isLoading: boolean;
} {
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  const profiles = useMemo(() => getProfiles(), [profileVersion]);

  useSyncExternalStore(
    subscribeConnections,
    () => profiles.map((p) => getConnectionSnapshot(p.id)?.status ?? "none").join(":"),
    () => "",
  );

  const querySpecs = useMemo(() => {
    return profiles.map((profile) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const isConnected = snapshot?.status === "connected";
      const owner = snapshot?.owner ?? { profileId: profile.id, generation: 0 };
      return {
        queryKey: isConnected
          ? profileQueryKey(owner, "terminal-sessions")
          : ["profile", profile.id, "disconnected", "terminal-sessions"],
        queryFn: async (): Promise<SessionInfo[]> => {
          if (!isConnected) return [];
          const transport = getConnectionTransport(owner);
          const sessions = await transport.invoke<SessionInfo[]>(
            "terminal:listDetailed",
          );
          rememberTerminalSessionIncarnations(sessions, owner.profileId);
          return sessions.map((s) => ({
            ...s,
            profileId: profile.id,
          }));
        },
        enabled: isConnected,
        staleTime: Infinity,
      };
    });
  }, [profiles]);

  const queryResults = useQueries({ queries: querySpecs });

  const { sessions, isSuccess, isLoading } = useMemo(() => {
    const list: SessionInfo[] = [];
    let anyLoading = false;

    for (const result of queryResults) {
      if (result.isLoading) anyLoading = true;
      if (Array.isArray(result.data)) {
        list.push(...result.data);
      }
    }

    return {
      sessions: list,
      isSuccess: queryResults.length > 0 && queryResults.some((r) => r.isSuccess),
      isLoading: anyLoading,
    };
  }, [queryResults]);

  return { sessions, isSuccess, isLoading };
}

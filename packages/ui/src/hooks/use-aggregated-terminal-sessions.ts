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
  isCurrentConnection,
} from "@/api/connections.js";
import { profileQueryKey } from "@/api/query-client.js";
import { ConnectionOwnerError } from "@/api/ownership.js";
import { rememberTerminalSessionIncarnations } from "@/lib/terminal-incarnation-state.js";
import { useTerminalSessions } from "@/api/queries.js";

export type AggregatedSessionInfo = SessionInfo & { profileId: string };

export function useAggregatedTerminalSessions(): {
  sessions: AggregatedSessionInfo[];
  isSuccess: boolean;
  isLoading: boolean;
} {
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  const profiles = useMemo(() => getProfiles(), [profileVersion]);
  const { data: ambientSessions = [], isSuccess: ambientSuccess, isLoading: ambientLoading } =
    useTerminalSessions(profiles.length === 0 ? undefined : { profileId: "__disabled__" });

  const connectionVersion = useSyncExternalStore(
    subscribeConnections,
    () => JSON.stringify(profiles.map((profile) => {
      const snapshot = getConnectionSnapshot(profile.id);
      return [profile.id, snapshot?.status, snapshot?.owner.generation];
    })),
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
        queryFn: async (): Promise<AggregatedSessionInfo[]> => {
          if (!isConnected) return [];
          const transport = getConnectionTransport(owner);
          const sessions = await transport.invoke<SessionInfo[]>(
            "terminal:listDetailed",
          );
          if (!isCurrentConnection(owner)) {
            throw new ConnectionOwnerError("Terminal session owner is stale", "stale");
          }
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
  }, [profiles, connectionVersion]);

  const queryResults = useQueries({ queries: querySpecs });

  const ambientSessionResults = profiles.length === 0 ? ambientSessions : queryResults;
  const { sessions, isSuccess, isLoading } = useMemo(() => {
    if (profiles.length === 0) {
      return {
        sessions: ambientSessions.map((s) => ({
          ...s,
          profileId: "default",
        })),
        isSuccess: ambientSuccess,
        isLoading: ambientLoading,
      };
    }
    const list: AggregatedSessionInfo[] = [];
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
  }, [profiles, ambientSessionResults, ambientSuccess, ambientLoading]);
  return { sessions, isSuccess, isLoading };
}

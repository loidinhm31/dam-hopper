import { useQueries } from "@tanstack/react-query";
import { useSyncExternalStore, useMemo } from "react";
import type { SessionInfo } from "@/api/client.js";
import {
  createTerminalTargetFromObservation,
  type TerminalTarget,
  type TerminalInventoryTerminationState,
  type TerminalInventoryDetailedObservation,
} from "@/api/terminal-session-contract.js";
import {
  getProfiles,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
  isCurrentConnection,
} from "@/api/connections.js";
import { profileQueryKey } from "@/api/query-client.js";
import {
  terminalInventoryQueryOptions,
  useTerminalInventory,
} from "@/api/queries.js";

export type AggregatedSessionInfo = SessionInfo & {
  profileId: string;
  generation?: number;
  terminationState?: TerminalInventoryTerminationState;
  terminationTarget: TerminalTarget | null;
};

export function useAggregatedTerminalSessions(): {
  sessions: AggregatedSessionInfo[];
  observations: TerminalInventoryDetailedObservation[];
  isSuccess: boolean;
  isLoading: boolean;
  loadedProfileIds: ReadonlySet<string>;
} {
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  const profiles = useMemo(() => getProfiles(), [profileVersion]);
  const {
    data: ambientObservation,
    isSuccess: ambientSuccess,
    isLoading: ambientLoading,
  } = useTerminalInventory(profiles.length === 0 ? null : undefined);

  const connectionVersion = useSyncExternalStore(
    subscribeConnections,
    () =>
      JSON.stringify(
        profiles.map((profile) => {
          const snapshot = getConnectionSnapshot(profile.id);
          return [profile.id, snapshot?.status, snapshot?.owner.generation];
        }),
      ),
    () => "",
  );

  const querySpecs = useMemo(() => {
    return profiles.map((profile) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const isConnected = snapshot?.status === "connected";
      const owner = snapshot?.owner ?? { profileId: profile.id, generation: 0 };
      const baseOptions = terminalInventoryQueryOptions(isConnected ? owner : null);
      return {
        ...baseOptions,
        queryKey: isConnected
          ? profileQueryKey(owner, "terminal-sessions")
          : ["profile", profile.id, "disconnected", "terminal-sessions"],
        enabled: isConnected,
      };
    });
  }, [profiles, connectionVersion]);

  const queryResults = useQueries({ queries: querySpecs });

  const { sessions, observations, isSuccess, isLoading, loadedProfileIds } = useMemo(() => {
    if (profiles.length === 0) {
      const list: AggregatedSessionInfo[] = [];
      if (ambientObservation) {
        for (const row of ambientObservation.sessions) {
          const terminationTarget = createTerminalTargetFromObservation(
            ambientObservation,
            row,
          );
          list.push({
            ...row,
            profileId: "default",
            generation: undefined,
            terminationState: row.terminationState,
            terminationTarget,
          });
        }
      }
      return {
        sessions: list,
        observations: ambientObservation ? [ambientObservation] : [],
        isSuccess: ambientSuccess,
        isLoading: ambientLoading,
        loadedProfileIds: new Set(ambientSuccess ? ["default"] : []),
      };
    }
    const sessionsList: AggregatedSessionInfo[] = [];
    const observationsList: TerminalInventoryDetailedObservation[] = [];
    const loadedProfiles = new Set<string>();
    let anyLoading = false;

    queryResults.forEach((result, idx) => {
      if (result.isLoading) anyLoading = true;
      const obs = result.data as TerminalInventoryDetailedObservation | undefined;
      if (obs && (!obs.owner || isCurrentConnection(obs.owner))) {
        const profile = profiles[idx];
        if (profile && result.isSuccess) {
          loadedProfiles.add(profile.id);
        }
        observationsList.push(obs);
        if (Array.isArray(obs.sessions)) {
          for (const row of obs.sessions) {
            const terminationTarget = createTerminalTargetFromObservation(
              obs,
              row,
            );
            sessionsList.push({
              ...row,
              profileId: obs.owner ? obs.owner.profileId : "default",
              generation: obs.owner?.generation,
              terminationState: row.terminationState,
              terminationTarget,
            });
          }
        }
      }
    });
    return {
      sessions: sessionsList,
      observations: observationsList,
      isSuccess:
        queryResults.length > 0 && queryResults.some((r) => r.isSuccess),
      isLoading: anyLoading,
      loadedProfileIds: loadedProfiles,
    };
  }, [profiles, ambientObservation, queryResults, ambientSuccess, ambientLoading]);
  return { sessions, observations, isSuccess, isLoading, loadedProfileIds };
}

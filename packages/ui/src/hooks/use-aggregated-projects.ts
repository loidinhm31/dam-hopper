import { useQueries } from "@tanstack/react-query";
import { useSyncExternalStore, useMemo } from "react";
import type { ProjectRef } from "@/api/ownership.js";
import type { ProjectConfig } from "@/api/client.js";
import {
  getProfiles,
  subscribeToProfileChanges,
  getProfileChangeVersion,
  type ServerProfile,
} from "@/api/server-config.js";
import {
  getConnectionSnapshot,
  subscribeConnections,
  getApi,
} from "@/api/connections.js";
import { profileQueryKey } from "@/api/query-client.js";

export interface AggregatedProjectItem {
  profileId: string;
  profileName: string;
  serverUrl: string;
  project: ProjectConfig;
  ref: ProjectRef;
}

export interface ProfileProjectGroup {
  profile: ServerProfile;
  serverUrl: string;
  status: string;
  projects: ProjectConfig[];
}

export function useAggregatedProjects(): {
  groups: ProfileProjectGroup[];
  allProjects: AggregatedProjectItem[];
  isLoading: boolean;
} {
  // Subscribe to profile list changes
  const profileVersion = useSyncExternalStore(
    subscribeToProfileChanges,
    () => getProfileChangeVersion(),
    () => 0,
  );

  const profiles = useMemo(() => getProfiles(), [profileVersion]);

  // Subscribe to connection snapshots
  useSyncExternalStore(
    subscribeConnections,
    () => profiles.map((p) => getConnectionSnapshot(p.id)?.status ?? "none").join(":"),
    () => "",
  );

  const querySpecs = useMemo(() => {
    return profiles.map((profile) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const isConnected = snapshot?.status === "connected";

      return {
        queryKey: isConnected && snapshot
          ? profileQueryKey(snapshot.owner, "projects")
          : ["profile", profile.id, "disconnected", "projects"],
        queryFn: async (): Promise<ProjectConfig[]> => {
          if (!isConnected || !snapshot) return [];
          const client = getApi(snapshot.owner);
          return client.projects.list();
        },
        enabled: isConnected && Boolean(snapshot),
        staleTime: 30_000,
      };
    });
  }, [profiles]);

  const queryResults = useQueries({ queries: querySpecs });

  const { groups, allProjects, isLoading } = useMemo(() => {
    const groupList: ProfileProjectGroup[] = [];
    const flatList: AggregatedProjectItem[] = [];
    let loading = false;

    profiles.forEach((profile, index) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const status = snapshot?.status ?? "disconnected";
      const result = queryResults[index];
      const projectList = (result?.data as ProjectConfig[] | undefined) ?? [];

      if (result?.isLoading && status === "connected") {
        loading = true;
      }

      groupList.push({
        profile,
        serverUrl: profile.url.replace(/\/$/, ""),
        status,
        projects: projectList,
      });

      for (const p of projectList) {
        flatList.push({
          profileId: profile.id,
          profileName: profile.name,
          serverUrl: profile.url.replace(/\/$/, ""),
          project: p,
          ref: {
            profileId: profile.id,
            project: p.name,
          },
        });
      }
    });

    return {
      groups: groupList,
      allProjects: flatList,
      isLoading: loading,
    };
  }, [profiles, queryResults]);

  return { groups, allProjects, isLoading };
}

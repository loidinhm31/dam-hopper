import { useQueries } from "@tanstack/react-query";
import { useSyncExternalStore, useMemo } from "react";
import type { ProjectRef } from "@/api/ownership.js";
import type { ProjectConfig, ProjectWithStatus } from "@/api/client.js";
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
import { useProjects } from "@/api/queries.js";

export interface AggregatedProjectItem {
  profileId: string;
  profileName: string;
  serverUrl: string;
  project: ProjectWithStatus;
  ref: ProjectRef;
}

export interface ProfileProjectGroup {
  profile: ServerProfile;
  serverUrl: string;
  status: string;
  projects: ProjectWithStatus[];
}
const DEFAULT_PROFILE: ServerProfile = Object.freeze({
  id: "default",
  name: "Default",
  url: "",
  authType: "none" as const,
  autoConnect: true,
  createdAt: 0,
});

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
  const { data: ambientProjects = [], isLoading: ambientLoading } =
    useProjects(profiles.length === 0 ? undefined : { profileId: "__disabled__" });

  // Subscribe to connection snapshots
  const connectionVersion = useSyncExternalStore(
    subscribeConnections,
    () => profiles.map((p) => {
      const snapshot = getConnectionSnapshot(p.id);
      return `${p.id}:${snapshot?.owner.generation}:${snapshot?.status}`;
    }).join("|"),
    () => "",
  );

  const querySpecs = useMemo(() => {
    return profiles.map((profile) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const isConnected = snapshot?.status === "connected";

      const owner = snapshot?.owner ?? { profileId: profile.id, generation: 0 };
      return {
        queryKey: isConnected
          ? profileQueryKey(owner, "projects")
          : ["profile", profile.id, "disconnected", "projects"],
        queryFn: async (): Promise<ProjectWithStatus[]> => {
          if (!isConnected) return [];
          const client = getApi(owner);
          return client.projects.list();
        },
        enabled: isConnected,
        staleTime: 30_000,
      };
    });
  }, [profiles, connectionVersion]);

  const queryResults = useQueries({ queries: querySpecs });

  const ambientQueryResults = profiles.length === 0 ? ambientProjects : queryResults;
  const { groups, allProjects, isLoading } = useMemo(() => {
    if (profiles.length === 0) {
      const flatList: AggregatedProjectItem[] = ambientProjects.map((p) => ({
        profileId: "default",
        profileName: "Default",
        serverUrl: "",
        project: p,
        ref: {
          profileId: "default",
          project: p.name,
        },
      }));
      return {
        groups: [
          {
            profile: DEFAULT_PROFILE,
            serverUrl: "",
            status: "connected",
            projects: ambientProjects,
          },
        ],
        allProjects: flatList,
        isLoading: ambientLoading,
      };
    }
    const groupList: ProfileProjectGroup[] = [];
    const flatList: AggregatedProjectItem[] = [];
    let loading = false;

    profiles.forEach((profile, index) => {
      const snapshot = getConnectionSnapshot(profile.id);
      const status = snapshot?.status ?? "disconnected";
      const result = queryResults[index];
      const projectList = (result?.data as ProjectWithStatus[] | undefined) ?? [];

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
  }, [profiles, ambientQueryResults, ambientLoading]);

  return { groups, allProjects, isLoading };
}

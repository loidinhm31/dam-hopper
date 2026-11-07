import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransport } from "@/api/transport.js";
import {
  captureConnection,
  getConnectionSnapshot,
  getTransport as getConnectionsTransport,
  isCurrentConnection,
  type ConnectionStatus,
} from "@/api/connections.js";
import { getProfiles } from "@/api/server-config.js";
import {
  toServerProjectTarget,
  normalizeFsTarget,
  toServerFsTarget,
  fsTargetKey,
  type ConnectionRef,
  type FsTargetRef,
} from "@/api/ownership.js";
import type {
  PathSearchResponse,
  SearchResponse,
  SearchMatch,
  PathSearchMatch,
} from "@/api/fs-types.js";
import type { WsTransport } from "@/api/ws-transport.js";
import {
  isContentSearchMatch,
  isPathSearchMatch,
  compareContentSearchMatches,
  comparePathSearchMatches,
  sortContentSearchMatches,
  sortPathSearchMatches,
  type SearchResultItem,
} from "@/lib/search-matches.js";
import type { SearchMode, SearchScope } from "@/stores/search-ui.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";

const DEBOUNCE_MS = 350;
const MAX_QUERY_LEN = 200;
const MAX_CONCURRENT_SEARCHES = 4;
const MAX_AGGREGATE_MATCHES = 500;

export interface ProfileSearchStatus {
  profileId: string;
  profileName: string;
  status: ConnectionStatus | "error";
  matchCount: number;
  truncated?: boolean;
  error?: string | null;
}

export interface FileSearchResultData {
  query: string;
  matches: SearchResultItem[];
  truncated: boolean;
  profileStatuses?: ProfileSearchStatus[];
}

export function useFileSearch(
  target: FsTargetRef | ProjectTargetInput | null,
  scope: SearchScope = "project",
  mode: SearchMode = "content",
  query = "",
) {
  const targetRef = target == null ? null : normalizeFsTarget(target);
  const project = targetRef?.kind === "project" ? targetRef.project : null;
  const targetKey = targetRef == null ? null : fsTargetKey(targetRef);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const trimmedQuery = debouncedQuery.slice(0, MAX_QUERY_LEN);
  const isWorkspace = scope === "workspace";

  const allProfiles = getProfiles();
  const eligibleProfiles = useMemo(() => {
    if (!isWorkspace) return [];
    return allProfiles
      .filter((p) => {
        const snap = getConnectionSnapshot(p.id);
        return snap?.status === "connected";
      })
      .slice(0, MAX_CONCURRENT_SEARCHES);
  }, [allProfiles, isWorkspace]);

  const eligibleKey = eligibleProfiles
    .map((p) => {
      const snap = getConnectionSnapshot(p.id);
      return `${p.id}@${snap?.owner.generation ?? 0}`;
    })
    .join(",");

  const queryKey = isWorkspace
    ? [
        mode === "filename" ? "fs-path-search-fed" : "fs-search-fed",
        eligibleKey,
        trimmedQuery,
        caseSensitive,
        scope,
      ]
    : [
        mode === "filename" ? "fs-path-search" : "fs-search",
        targetRef?.profileId ?? "__local__",
        targetRef?.profileId
          ? (getConnectionSnapshot(targetRef.profileId)?.owner.generation ?? 0)
          : ((targetRef as { generation?: number })?.generation ?? 0),
        project,
        targetKey,
        trimmedQuery,
        caseSensitive,
        scope,
      ];

  const { data, isLoading, isError, refetch } = useQuery<FileSearchResultData>({
    queryKey,
    queryFn: async () => {
      if (!isWorkspace) {
        let t: WsTransport;
        let conn: ConnectionRef | undefined;
        if (targetRef?.profileId) {
          conn = captureConnection(targetRef.profileId);
          t = getConnectionsTransport(conn) as WsTransport;
        } else {
          t = getTransport() as WsTransport;
        }
        const channel = mode === "filename" ? "fs:searchPaths" : "fs:search";
        const wire = targetRef ? toServerFsTarget(targetRef) : undefined;
        const resp = (await t.invoke(channel, {
          ...(wire ? { target: wire } : {}),
          q: trimmedQuery,
          case: caseSensitive || undefined,
          scope,
        })) as SearchResponse | PathSearchResponse;

        if (conn && !isCurrentConnection(conn)) {
          throw new Error("Connection changed during project search");
        }
        const matches = (resp.matches ?? []).map((m) => ({
          ...m,
          profileId: targetRef?.profileId,
          generation:
            conn?.generation ??
            (targetRef as { generation?: number })?.generation,
          targetRef: targetRef ?? undefined,
        }));

        return {
          query: resp.query,
          matches,
          truncated: Boolean(resp.truncated),
        };
      }

      // Federated search across up to 4 eligible connected profiles
      if (eligibleProfiles.length === 0) {
        return {
          query: trimmedQuery,
          matches: [],
          truncated: false,
        };
      }

      const channel = mode === "filename" ? "fs:searchPaths" : "fs:search";
      const searchOutcomes = await Promise.allSettled(
        eligibleProfiles.map(async (p) => {
          const snap = getConnectionSnapshot(p.id);
          if (!snap || snap.status !== "connected") {
            throw new Error("Profile disconnected");
          }
          const conn = snap.owner;
          const t = getConnectionsTransport(conn) as WsTransport;
          const resp = (await t.invoke(channel, {
            q: trimmedQuery,
            case: caseSensitive || undefined,
            scope: "workspace",
          })) as SearchResponse | PathSearchResponse;
          if (!isCurrentConnection(conn)) {
            throw new Error("Connection changed during search");
          }
          return { profile: p, conn, resp };
        }),
      );

      const profileStatuses: ProfileSearchStatus[] = allProfiles.map((p) => {
        const snap = getConnectionSnapshot(p.id);
        const eligibleIdx = eligibleProfiles.findIndex((e) => e.id === p.id);
        if (eligibleIdx === -1) {
          return {
            profileId: p.id,
            profileName: p.name,
            status: snap ? snap.status : "disconnected",
            matchCount: 0,
          };
        }
        const outcome = searchOutcomes[eligibleIdx]!;
        if (outcome.status === "rejected") {
          return {
            profileId: p.id,
            profileName: p.name,
            status: "error",
            matchCount: 0,
            error:
              outcome.reason instanceof Error
                ? outcome.reason.message
                : "Search failed",
          };
        }
        return {
          profileId: p.id,
          profileName: p.name,
          status: "connected",
          matchCount: outcome.value.resp.matches?.length ?? 0,
          truncated: Boolean(outcome.value.resp.truncated),
        };
      });

      const allMatches: SearchResultItem[] = [];
      let serverTruncated = false;

      for (let i = 0; i < eligibleProfiles.length; i++) {
        const outcome = searchOutcomes[i]!;
        if (outcome.status === "fulfilled") {
          const { profile, conn, resp } = outcome.value;
          if (resp.truncated) serverTruncated = true;
          for (const rawMatch of resp.matches ?? []) {
            allMatches.push({
              ...rawMatch,
              profileId: profile.id,
              profileName: profile.name,
              generation: conn.generation,
              targetRef: {
                profileId: profile.id,
                project: rawMatch.project ?? "",
              },
            });
          }
        }
      }

      // Stable ordering: profile display order, project, path, line
      if (mode === "content") {
        allMatches.sort((a, b) =>
          compareContentSearchMatches(a as SearchMatch, b as SearchMatch),
        );
      } else {
        allMatches.sort((a, b) =>
          comparePathSearchMatches(a as PathSearchMatch, b as PathSearchMatch),
        );
      }

      const localCapReached = allMatches.length >= MAX_AGGREGATE_MATCHES;
      const finalMatches = allMatches.slice(0, MAX_AGGREGATE_MATCHES);
      const truncated = serverTruncated || localCapReached;

      return {
        query: trimmedQuery,
        matches: finalMatches,
        truncated,
        profileStatuses,
      };
    },
    enabled: (isWorkspace || !!project) && trimmedQuery.length >= 2,
    staleTime: 30_000,
  });

  const sortedData = useMemo(() => {
    if (!data) return undefined;
    if (mode === "content") {
      return {
        ...data,
        matches: sortContentSearchMatches(
          (data.matches as SearchMatch[]).filter(isContentSearchMatch),
        ),
      };
    }

    return {
      ...data,
      matches: sortPathSearchMatches(
        (data.matches as PathSearchMatch[]).filter(isPathSearchMatch),
      ),
    };
  }, [data, mode]);
  return {
    caseSensitive,
    setCaseSensitive,
    data: sortedData,
    profileStatuses: data?.profileStatuses,
    truncated: Boolean(sortedData?.truncated),
    isLoading,
    isError,
    refetch,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  normalizeProjectTarget,
  type Branch,
  type GitLogEntry,
  type ProjectTargetRef,
  type VcsRoot,
} from "@/api/client.js";
import {
  getBoundApiClient,
  gitHistoryQueryPrefixes,
  gitLogQueryOptions,
  normalizeGitMessageQuery,
  resolveTargetOwner,
  useBranches,
  useGitRoots,
} from "@/api/queries.js";
import { projectTargetKey } from "@/api/ownership.js";
import {
  gitHistoryScopeKey,
  resolveHistoryBranch,
  toBranchCanonicalRef,
  useGitHistoryHydrated,
  useGitHistoryStore,
  type HistoryBranchPreference,
} from "@/stores/git-history.js";
import {
  deriveGitSquashSelection,
  type GitSquashSelection,
} from "@/lib/git-squash-selection.js";
import { useConnectionSnapshot } from "@/api/connections.js";

export const GIT_HISTORY_PAGE_SIZE = 200;

export interface UseGitHistoryViewOptions {
  available?: boolean;
}

export interface GitHistoryAvailability {
  isAvailable: boolean;
  reason?: string;
}

export interface GitHistoryViewResult {
  rootId: string;
  rootOptions: VcsRoot[];
  setRootId: (rootId: string) => void;
  branchRef: string | undefined;
  branchLabel: string;
  activeBranch: string;
  activeBranchRef: string | undefined;
  followActive: boolean;
  selectBranchRef: (ref: string) => void;
  followCheckedOutBranch: () => void;
  isViewingActiveBranch: boolean;
  isViewingLocalBranch: boolean;

  searchText: string;
  setSearchText: (text: string) => void;
  clearSearch: () => void;
  isComposing: boolean;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  appliedMessageQuery: string | undefined;
  isFiltered: boolean;

  page: number;
  offset: number;
  previousPage: () => void;
  nextPage: () => void;
  hasPreviousPage: boolean;
  hasNextPage: boolean;

  logs: GitLogEntry[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  availability: GitHistoryAvailability;
  notice: string | null;
  dismissNotice: () => void;
  refresh: () => Promise<void>;
  isRefreshing: boolean;

  selectedCommit: GitLogEntry | null;
  selectCommit: (entry: GitLogEntry | null) => void;
  clearSelectedCommit: () => void;
  effectiveScopeKey: string;
  squashSelectedHashes: string[];
  toggleSquashCommit: (hash: string) => void;
  clearSquashSelection: () => void;
  squashSelection: GitSquashSelection;
  squashScopeKey: string;
  squashAvailable: boolean;
  squashUnavailableReason?: string;
}

export function useGitHistoryView(
  target: ProjectTargetRef,
  options?: UseGitHistoryViewOptions,
): GitHistoryViewResult {
  const queryClient = useQueryClient();
  const targetRef = useMemo(() => normalizeProjectTarget(target), [target]);
  const connectionSnapshot = useConnectionSnapshot(targetRef.profileId ?? "");
  const isHydrated = useGitHistoryHydrated();
  const available = options?.available ?? true;

  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(
    null,
  );
  const [page, setPage] = useState(0);
  const [searchText, setSearchTextState] = useState("");
  const [appliedMessageQuery, setAppliedMessageQuery] = useState<
    string | undefined
  >(undefined);
  const [isComposing, setIsComposing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const debounceTimerRef = useRef<number | undefined>(undefined);
  // Store access
  const targetKey = useMemo(
    () => (targetRef.project ? projectTargetKey(targetRef) : ""),
    [targetRef],
  );
  const persistedRoot = useGitHistoryStore((s) =>
    targetKey ? (s.rootByTarget[targetKey] ?? ".") : ".",
  );
  const setRootForTarget = useGitHistoryStore((s) => s.setRootForTarget);

  const scopeKey = useMemo(
    () =>
      targetRef.project && targetRef.profileId
        ? gitHistoryScopeKey(targetRef, persistedRoot)
        : "",
    [targetRef, persistedRoot],
  );
  const rawBranchPreference = useGitHistoryStore((s) =>
    scopeKey ? s.branchByScope[scopeKey] : undefined,
  );
  const branchPreference = useMemo<HistoryBranchPreference>(
    () => rawBranchPreference ?? { mode: "follow-active" },
    [rawBranchPreference],
  );
  const setBranchPreference = useGitHistoryStore((s) => s.setBranchPreference);
  const clearBranchPreference = useGitHistoryStore(
    (s) => s.clearBranchPreference,
  );

  // VCS roots discovery
  const {
    data: rootsData = [],
    isSuccess: isRootsSuccess,
    isFetching: isRootsFetching,
  } = useGitRoots(targetRef);

  const rootOptions = useMemo<VcsRoot[]>(() => {
    return rootsData.length > 0
      ? rootsData
      : [
          {
            rootId: ".",
            path: ".",
            absolutePath: "",
            kind: "primary",
            warnings: [],
          },
        ];
  }, [rootsData]);

  // Reconcile missing root after successful discovery
  const effectiveRootId = useMemo(() => {
    if (!isRootsSuccess || isRootsFetching || rootsData.length === 0) {
      return persistedRoot || ".";
    }
    const exists = rootsData.some((r) => r.rootId === persistedRoot);
    return exists ? persistedRoot : ".";
  }, [isRootsSuccess, isRootsFetching, rootsData, persistedRoot]);

  useEffect(() => {
    if (
      isRootsSuccess &&
      !isRootsFetching &&
      rootsData.length > 0 &&
      persistedRoot !== "." &&
      !rootsData.some((r) => r.rootId === persistedRoot)
    ) {
      setRootForTarget(targetRef, ".");
      setNotice(
        `Selected VCS root "${persistedRoot}" is no longer available. Reverted to project root.`,
      );
    }
  }, [
    isRootsSuccess,
    isRootsFetching,
    rootsData,
    persistedRoot,
    setRootForTarget,
    targetRef,
  ]);

  // Branch discovery
  const {
    data: branches = [],
    isSuccess: isBranchesSuccess,
    isFetching: isBranchesFetching,
  } = useBranches(targetRef, effectiveRootId);

  const activeBranchObj = useMemo(() => {
    return (
      branches.find((b) => b.isCurrent && !b.isRemote) ??
      branches.find((b) => b.isCurrent)
    );
  }, [branches]);

  const activeBranch = activeBranchObj?.name ?? "";
  const activeBranchRef = activeBranchObj
    ? toBranchCanonicalRef(activeBranchObj)
    : undefined;

  // Resolve branch preference against discovered branches
  const resolved = useMemo(
    () => resolveHistoryBranch(branches, branchPreference),
    [branches, branchPreference],
  );

  // Missing pinned branch reconciliation
  useEffect(() => {
    if (
      branchPreference.mode === "pinned" &&
      resolved.notFound &&
      isBranchesSuccess &&
      !isBranchesFetching &&
      branches.length > 0
    ) {
      clearBranchPreference(targetRef, effectiveRootId);
      setNotice(
        `Pinned branch "${branchPreference.ref}" was not found. Reverted to active branch.`,
      );
    }
  }, [
    branchPreference,
    resolved.notFound,
    isBranchesSuccess,
    isBranchesFetching,
    branches.length,
    clearBranchPreference,
    targetRef,
    effectiveRootId,
  ]);

  const followActive = branchPreference.mode === "follow-active";

  const branchRef = useMemo(() => {
    if (resolved.canonicalRef) return resolved.canonicalRef;
    if (branchPreference.mode === "pinned") return branchPreference.ref;
    return activeBranchRef;
  }, [resolved.canonicalRef, branchPreference, activeBranchRef]);

  const branchLabel = useMemo(() => {
    if (resolved.branch) return resolved.branch.name;
    if (branchRef) return branchRef.replace(/^refs\/(heads|remotes)\//, "");
    return activeBranch || "HEAD";
  }, [resolved.branch, branchRef, activeBranch]);

  const isViewingActiveBranch = useMemo(() => {
    if (!resolved.branch) return true;
    if (activeBranchRef && resolved.canonicalRef === activeBranchRef)
      return true;
    return Boolean(activeBranch && resolved.branch.name === activeBranch);
  }, [resolved, activeBranchRef, activeBranch]);

  const isViewingLocalBranch = useMemo(() => {
    return Boolean(
      resolved.branch &&
        !resolved.branch.isRemote &&
        branchRef?.startsWith("refs/heads/"),
    );
  }, [resolved.branch, branchRef]);

  const owner = resolveTargetOwner(targetRef.profileId);
  const connectionGeneration =
    connectionSnapshot?.owner.generation ?? owner?.generation ?? 0;

  // Scope key for resetting transient state (includes connection generation for reconnect fencing)
  const effectiveScopeKey = useMemo(() => {
    return JSON.stringify([
      targetRef.profileId ?? "",
      targetRef.project,
      targetRef.worktreePath ?? "",
      effectiveRootId,
      branchPreference.mode === "pinned"
        ? branchPreference.ref
        : "follow-active",
      connectionGeneration,
    ]);
  }, [targetRef, effectiveRootId, branchPreference, connectionGeneration]);

  // Synchronous scope-owned state adjustment during render
  const [prevScopeKey, setPrevScopeKey] = useState(effectiveScopeKey);
  if (prevScopeKey !== effectiveScopeKey) {
    setPrevScopeKey(effectiveScopeKey);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    setSearchTextState("");
    setAppliedMessageQuery(undefined);
    setPage(0);
    setSelectedCommit(null);
    setIsRefreshing(false);
  }

  // Target availability and scope resolution gate
  const isScopeResolving =
    branchPreference.mode === "pinned" &&
    !resolved.branch &&
    !resolved.notFound;

  const availability = useMemo<GitHistoryAvailability>(() => {
    if (!targetRef.project) {
      return { isAvailable: false, reason: "No project selected" };
    }
    if (!available) {
      return { isAvailable: false, reason: "Target unavailable" };
    }
    if (!isHydrated) {
      return { isAvailable: false, reason: "Restoring history preferences..." };
    }
    return { isAvailable: true };
  }, [targetRef.project, available, isHydrated]);

  // Log query ref calculation
  const queryRef = useMemo(() => {
    if (branchPreference.mode === "pinned") {
      return resolved.branch?.lastCommit ?? branchPreference.ref;
    }
    return undefined;
  }, [branchPreference, resolved.branch]);

  const offset = page * GIT_HISTORY_PAGE_SIZE;

  const logQueryOptions = useMemo(() => {
    const base = gitLogQueryOptions(
      targetRef,
      GIT_HISTORY_PAGE_SIZE,
      offset,
      queryRef,
      effectiveRootId,
      appliedMessageQuery,
    );
    return {
      ...base,
      enabled:
        availability.isAvailable &&
        !isScopeResolving &&
        Boolean(targetRef.project),
    };
  }, [
    targetRef,
    offset,
    queryRef,
    effectiveRootId,
    appliedMessageQuery,
    availability.isAvailable,
    isScopeResolving,
  ]);

  const {
    data: logs = [],
    isLoading: isLogLoading,
    isFetching: isLogFetching,
    error: queryError,
  } = useQuery(logQueryOptions);

  const error = (queryError as Error) ?? null;
  const isLoading =
    isLogLoading || (!isHydrated && available) || isScopeResolving;
  const isFetching = isLogFetching || isBranchesFetching;

  const squashUnavailableReason = !availability.isAvailable
    ? availability.reason
    : !targetRef.profileId || connectionSnapshot?.status !== "connected"
      ? "Connect the selected profile before squashing history."
      : !isRootsSuccess ||
          !isBranchesSuccess ||
          !rootsData.some((entry) => entry.rootId === effectiveRootId)
        ? "Waiting for available root and local branch discovery."
        : !isViewingLocalBranch
          ? "Squash requires a local branch."
          : error
            ? "Refresh history before selecting commits."
            : undefined;
  const squashAvailable = !squashUnavailableReason;
  const squashScopeKey = JSON.stringify([
    effectiveScopeKey,
    resolved.canonicalRef,
    activeBranchRef,
    searchText,
    appliedMessageQuery,
    page,
    offset,
    squashAvailable,
    squashUnavailableReason,
  ]);
  const [squashState, setSquashState] = useState<{
    scope: string;
    hashes: string[];
  }>({
    scope: squashScopeKey,
    hashes: [],
  });
  const visibleHashes = useMemo(
    () => new Set(logs.map((entry) => entry.hash)),
    [logs],
  );
  const selectionMissing = squashState.hashes.some(
    (hash) => !visibleHashes.has(hash),
  );
  if (squashState.scope !== squashScopeKey || selectionMissing) {
    setSquashState({ scope: squashScopeKey, hashes: [] });
  }
  const squashSelectedHashes =
    squashState.scope === squashScopeKey && !selectionMissing
      ? squashState.hashes
      : [];
  const squashSelection = useMemo(
    () => deriveGitSquashSelection(logs, squashSelectedHashes),
    [logs, squashSelectedHashes],
  );
  const squashScopeRef = useRef(squashScopeKey);
  squashScopeRef.current = squashScopeKey;
  const clearSquashSelection = useCallback(() => {
    setSquashState({ scope: squashScopeRef.current, hashes: [] });
  }, []);
  const toggleSquashCommit = useCallback(
    (hash: string) => {
      if (
        !squashAvailable ||
        squashScopeRef.current !== squashScopeKey ||
        !visibleHashes.has(hash)
      )
        return;
      setSquashState((previous) => {
        const hashes = previous.scope === squashScopeKey ? previous.hashes : [];
        return {
          scope: squashScopeKey,
          hashes: hashes.includes(hash)
            ? hashes.filter((oid) => oid !== hash)
            : [...hashes, hash],
        };
      });
    },
    [squashAvailable, squashScopeKey, visibleHashes],
  );

  // Search input handling & 300 ms debounce
  const setSearchText = useCallback(
    (text: string) => {
      const sanitized = text.replace(/[\r\n\0]/g, "");
      setSearchTextState(sanitized);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = undefined;
      }

      if (isComposing) return;

      debounceTimerRef.current = window.setTimeout(() => {
        const normalized = normalizeGitMessageQuery(sanitized);
        setAppliedMessageQuery((prev) => {
          if (prev !== normalized) {
            setPage(0);
            setSelectedCommit(null);
          }
          return normalized;
        });
      }, 300);
    },
    [isComposing],
  );

  const clearSearch = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    setSearchTextState("");
    setAppliedMessageQuery(undefined);
    setPage(0);
    setSelectedCommit(null);
  }, []);

  const onCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const onCompositionEnd = useCallback(() => {
    setIsComposing(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
    debounceTimerRef.current = window.setTimeout(() => {
      const normalized = normalizeGitMessageQuery(searchText);
      setAppliedMessageQuery((prev) => {
        if (prev !== normalized) {
          setPage(0);
          setSelectedCommit(null);
        }
        return normalized;
      });
    }, 300);
  }, [searchText]);

  useEffect(() => {
    return () => {
      clearTimeout(debounceTimerRef.current);
    };
  }, []);

  // Actions
  const setRootId = useCallback(
    (rootId: string) => {
      setRootForTarget(targetRef, rootId);
    },
    [setRootForTarget, targetRef],
  );

  const selectBranchRef = useCallback(
    (ref: string) => {
      setBranchPreference(targetRef, { mode: "pinned", ref }, effectiveRootId);
    },
    [setBranchPreference, targetRef, effectiveRootId],
  );

  const followCheckedOutBranch = useCallback(() => {
    setBranchPreference(targetRef, { mode: "follow-active" }, effectiveRootId);
  }, [setBranchPreference, targetRef, effectiveRootId]);

  const hasPreviousPage = page > 0;
  const hasNextPage = logs.length === GIT_HISTORY_PAGE_SIZE;

  const previousPage = useCallback(() => {
    if (page > 0) {
      setPage((p) => p - 1);
      setSelectedCommit(null);
    }
  }, [page]);

  const nextPage = useCallback(() => {
    if (hasNextPage) {
      setPage((p) => p + 1);
      setSelectedCommit(null);
    }
  }, [hasNextPage]);

  const selectCommit = useCallback((entry: GitLogEntry | null) => {
    setSelectedCommit(entry);
  }, []);

  const clearSelectedCommit = useCallback(() => {
    setSelectedCommit(null);
  }, []);

  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  // Guarded refresh
  const currentScopeRef = useRef(effectiveScopeKey);
  currentScopeRef.current = effectiveScopeKey;

  const refresh = useCallback(async () => {
    if (isRefreshing || !availability.isAvailable || !targetRef.project) return;
    setIsRefreshing(true);
    const capturedScopeKey = effectiveScopeKey;
    const capturedOffset = offset;
    const capturedQuery = appliedMessageQuery;

    try {
      const prefixes = gitHistoryQueryPrefixes(targetRef, effectiveRootId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prefixes.branches }),
        queryClient.invalidateQueries({ queryKey: prefixes.projectStatus }),
        queryClient.invalidateQueries({ queryKey: prefixes.log }),
        ...prefixes
          .details()
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);

      const owner = resolveTargetOwner(targetRef.profileId);
      const refreshedBranches = await queryClient.fetchQuery<Branch[]>({
        queryKey: prefixes.branches,
        queryFn: () =>
          getBoundApiClient(owner).git.branches(targetRef, effectiveRootId),
      });

      const refreshedResolved = resolveHistoryBranch(
        refreshedBranches,
        branchPreference,
      );
      const refreshedRef =
        branchPreference.mode === "pinned"
          ? (refreshedResolved.branch?.lastCommit ?? branchPreference.ref)
          : undefined;

      const refreshedLogs = await queryClient.fetchQuery<GitLogEntry[]>(
        gitLogQueryOptions(
          targetRef,
          GIT_HISTORY_PAGE_SIZE,
          capturedOffset,
          refreshedRef,
          effectiveRootId,
          capturedQuery,
        ),
      );

      // Verify scope hasn't changed during fetch
      if (capturedScopeKey !== currentScopeRef.current) {
        return;
      }

      // Reconcile selected commit against fresh rows
      setSelectedCommit((prev) => {
        if (!prev) return null;
        return refreshedLogs.find((entry) => entry.hash === prev.hash) ?? null;
      });
    } catch (err) {
      if (capturedScopeKey === currentScopeRef.current) {
        setNotice(
          err instanceof Error ? err.message : "Failed to refresh git history",
        );
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isRefreshing,
    availability.isAvailable,
    targetRef,
    effectiveScopeKey,
    offset,
    appliedMessageQuery,
    effectiveRootId,
    queryClient,
    branchPreference,
  ]);

  return {
    rootId: effectiveRootId,
    rootOptions,
    setRootId,
    branchRef,
    branchLabel,
    activeBranch,
    activeBranchRef,
    followActive,
    selectBranchRef,
    followCheckedOutBranch,
    isViewingActiveBranch,
    isViewingLocalBranch,

    searchText,
    setSearchText,
    clearSearch,
    isComposing,
    onCompositionStart,
    onCompositionEnd,
    appliedMessageQuery,
    isFiltered: Boolean(appliedMessageQuery),

    page,
    offset,
    previousPage,
    nextPage,
    hasPreviousPage,
    hasNextPage,

    logs,
    isLoading,
    isFetching,
    error,
    availability,
    notice,
    dismissNotice,
    refresh,
    isRefreshing,

    selectedCommit,
    selectCommit,
    clearSelectedCommit,
    effectiveScopeKey,
    squashSelectedHashes,
    toggleSquashCommit,
    clearSquashSelection,
    squashSelection,
    squashScopeKey,
    squashAvailable,
    squashUnavailableReason,
  };
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import {
  api,
  isGitUnavailableError,
  isProjectTargetError,
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "./client.js";
import { getTransport } from "./transport.js";
import { useEditorStore } from "@/stores/editor.js";
import type {
  ExplorerLanguageScanCache,
  ExplorerLanguageScanCommitResult,
} from "@/lib/explorer-language-scan.js";
import {
  beginExplorerLanguageScan,
  commitExplorerLanguageScan,
  emptyExplorerLanguageScanCache,
  EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX,
  explorerLanguageScanQueryKey,
  getExplorerLanguageScanCache,
} from "@/lib/explorer-language-scan.js";
import type {
  DamHopperConfig,
  ProjectConfig,
  ProjectWithStatus,
  AgentItemCategory,
  AgentType,
  DistributionMethod,
  CheckoutStrategy,
  DiffFileEntry,
  GitDiffResult,
  FileDiffContent,
  ConflictFile,
  ResetMode,
  UiConfig,
  UsageSettingsPatch,
  UsageSetupStatus,
  UsageSummaryQuery,
  UsageSessionQuery,
  HostMetrics,
  HostResourceAlertIncident,
  HostResourceSnapshotV1,
  GitOpResult,
  SshCredentialStatus,
  SshForgetCredentialResult,
  SshLoadKeyResult,
  Worktree,
  IdleSuspendStatusV1,
  IdleSuspendTimingPatchRequest,
  IdleSuspendTimingPatchResponse,
  ForceSuspendRequest,
  ForceSuspendAcceptedResponse,
  DiagnosticExportResponse,
  SettingsImportResponse,
  KnownWorkspacesResponse,
  DiscoverResponse,
  ApiClient,
} from "./client.js";
import type { SessionInfo } from "@/api/client.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";
import { rememberTerminalSessionIncarnations } from "@/lib/terminal-incarnation-state.js";

import {
  getApi,
  getTransport as getBoundTransport,
  getConnectionSnapshot,
} from "./connections.js";
import { profileQueryKey, profileQueryPrefix } from "./query-client.js";
import type { ConnectionRef, ProfileId } from "./ownership.js";
import { resolveWorkflowOwner } from "./workflow-queries.js";
export * from "./workflow-queries.js";

export type OwnerInput =
  | ConnectionRef
  | ProfileId
  | { owner?: ConnectionRef; profileId?: ProfileId };

export function resolveTargetOwner(
  options?: OwnerInput,
): ConnectionRef | undefined {
  if (!options) return undefined;
  if (typeof options === "string") {
    const snap = getConnectionSnapshot(options);
    return snap ? snap.owner : { profileId: options, generation: 1 };
  }
  if ("generation" in options) {
    return options;
  }
  return resolveWorkflowOwner(options);
}

export function getBoundApiClient(owner?: ConnectionRef): ApiClient {
  if (!owner) return api;
  try {
    return getApi(owner);
  } catch {
    return api;
  }
}
type QueryInvalidator = Pick<
  ReturnType<typeof useQueryClient>,
  "invalidateQueries"
>;

const DEFAULT_GIT_ROOT_ID = ".";

function gitRootKey(root?: string) {
  return root ?? DEFAULT_GIT_ROOT_ID;
}

function gitQueryKey(
  prefix: string,
  target: ProjectTargetInput,
  ...parts: unknown[]
) {
  const normalized = normalizeProjectTarget(target);
  return [
    prefix,
    normalized.project,
    projectTargetCacheKey(normalized),
    ...parts,
  ];
}

async function reconcileAffectedEditorTabs(
  target: ProjectTargetInput,
  paths: string[],
) {
  if (paths.length === 0) return;
  await useEditorStore.getState().reconcileGitMutationFiles(target, paths);
}

async function reconcileProjectEditorTabs(target: ProjectTargetInput) {
  await useEditorStore.getState().reconcileGitProjectFiles(target);
}

async function reconcileAllOpenEditorTargets() {
  const state = useEditorStore.getState();
  const targets = new Map<string, ProjectTargetInput>();
  for (const tab of state.tabs ?? []) {
    const normalized = normalizeProjectTarget(tab.target);
    targets.set(
      `${normalized.project}::${projectTargetCacheKey(normalized)}`,
      normalized,
    );
  }
  await Promise.all(
    [...targets.values()].map((target) => reconcileProjectEditorTabs(target)),
  );
}

export function markTargetUnavailableIfNeeded(
  target: ProjectTargetInput,
  error: unknown,
): boolean {
  const values: string[] = [];
  if (typeof error === "string") values.push(error);
  if (error instanceof Error) values.push(error.message);
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["code", "message", "error", "reason"]) {
      const value = record[key];
      if (typeof value === "string") values.push(value);
      else if (value instanceof Error) values.push(value.message);
    }
  }
  if (isProjectTargetError(...values)) {
    markProjectTargetUnavailable(target);
    useEditorStore.getState().markTargetUnavailable(target);
    return true;
  }
  return false;
}

function markFailedGitResults(
  results: GitOpResult[] | undefined,
  requestedTargets?: ProjectTargetInput[],
) {
  if (!Array.isArray(results)) return;

  for (const result of results) {
    if (
      result.success ||
      (!result.targetUnavailable && !isProjectTargetError(result.error))
    )
      continue;

    if (requestedTargets) {
      const candidates = requestedTargets.filter(
        (candidate) =>
          normalizeProjectTarget(candidate).project === result.projectName,
      );
      const resultTargetPath = Object.prototype.hasOwnProperty.call(
        result,
        "worktreePath",
      )
        ? (result.worktreePath ?? null)
        : undefined;
      const normalizedResultTargetPath =
        resultTargetPath == null
          ? resultTargetPath
          : normalizeProjectTargetPath(resultTargetPath);
      const target =
        resultTargetPath === undefined
          ? candidates.length === 1
            ? candidates[0]
            : undefined
          : candidates.find((candidate) => {
              const candidateTargetPath =
                normalizeProjectTarget(candidate).worktreePath;
              return (
                (candidateTargetPath == null
                  ? null
                  : normalizeProjectTargetPath(candidateTargetPath)) ===
                normalizedResultTargetPath
              );
            });
      if (target) {
        if (result.targetUnavailable) {
          markProjectTargetUnavailable(target);
          useEditorStore.getState().markTargetUnavailable(target);
        } else {
          markTargetUnavailableIfNeeded(target, result.error);
        }
      }
      continue;
    }

    const openTargets = new Map<string, ProjectTargetInput>();
    for (const tab of useEditorStore.getState().tabs ?? []) {
      const normalized = normalizeProjectTarget(tab.target);
      if (normalized.project !== result.projectName) continue;
      openTargets.set(
        `${normalized.project}::${projectTargetCacheKey(normalized)}`,
        normalized,
      );
    }
    for (const target of openTargets.values()) {
      markTargetUnavailableIfNeeded(target, result.error);
    }
  }
}

function markOpenEditorTargetsUnavailableIfNeeded(error: unknown) {
  const state = useEditorStore.getState();
  const targets = new Map<string, ProjectTargetInput>();
  for (const tab of state.tabs ?? []) {
    const normalized = normalizeProjectTarget(tab.target);
    targets.set(
      `${normalized.project}::${projectTargetCacheKey(normalized)}`,
      normalized,
    );
  }
  for (const target of targets.values()) {
    markTargetUnavailableIfNeeded(target, error);
  }
}

export async function invalidateGitFileOperation(
  qc: QueryInvalidator,
  target: ProjectTargetInput,
  path: string,
) {
  const normalized = normalizeProjectTarget(target);
  await Promise.all([
    qc.invalidateQueries({ queryKey: gitQueryKey("git-diff", normalized) }),
    qc.invalidateQueries({
      queryKey: gitQueryKey("git-file-diff", normalized),
    }),
    qc.invalidateQueries({
      queryKey: [
        "project-status",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    }),
    reconcileAffectedEditorTabs(normalized, [path]),
  ]);
}

export async function invalidateGitHistoryOperation(
  qc: QueryInvalidator,
  target: ProjectTargetInput,
  affectedPaths: string[] = [],
) {
  const normalized = normalizeProjectTarget(target);
  await Promise.all([
    qc.invalidateQueries({ queryKey: gitQueryKey("git-diff", normalized) }),
    qc.invalidateQueries({
      queryKey: gitQueryKey("git-conflicts", normalized),
    }),
    qc.invalidateQueries({
      queryKey: [
        "project-status",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    }),
    qc.invalidateQueries({
      queryKey: gitQueryKey("git-file-diff", normalized),
    }),
    reconcileAffectedEditorTabs(normalized, affectedPaths),
  ]);
}

export async function invalidateGitBranchOperation(
  qc: QueryInvalidator,
  target: ProjectTargetInput,
) {
  const normalized = normalizeProjectTarget(target);
  await Promise.all([
    qc.invalidateQueries({ queryKey: gitQueryKey("branches", normalized) }),
    qc.invalidateQueries({
      queryKey: [
        "project-status",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    }),
    qc.invalidateQueries({ queryKey: ["projects"] }),
    qc.invalidateQueries({ queryKey: gitQueryKey("git-log", normalized) }),
    qc.invalidateQueries({ queryKey: gitQueryKey("git-diff", normalized) }),
    qc.invalidateQueries({
      queryKey: gitQueryKey("git-conflicts", normalized),
    }),
    qc.invalidateQueries({
      queryKey: [
        "fs-tree",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    }),
    reconcileProjectEditorTabs(normalized),
  ]);
}

function invalidateGitProjectQueries(
  qc: QueryInvalidator,
  target: ProjectTargetInput,
  options?: {
    includeBranches?: boolean;
    includeConflicts?: boolean;
    includeFileTree?: boolean;
    includeGitDiff?: boolean;
    includeGitLog?: boolean;
    includeProjects?: boolean;
    includeProjectStatus?: boolean;
    reconcileEditorTabs?: boolean;
  },
) {
  const normalized = normalizeProjectTarget(target);
  if (options?.includeBranches) {
    void qc.invalidateQueries({
      queryKey: gitQueryKey("branches", normalized),
    });
  }
  if (options?.includeProjectStatus) {
    void qc.invalidateQueries({
      queryKey: [
        "project-status",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    });
  }
  if (options?.includeProjects) {
    void qc.invalidateQueries({ queryKey: ["projects"] });
  }
  if (options?.includeGitLog) {
    void qc.invalidateQueries({ queryKey: gitQueryKey("git-log", normalized) });
  }
  if (options?.includeGitDiff) {
    void qc.invalidateQueries({
      queryKey: gitQueryKey("git-diff", normalized),
    });
  }
  if (options?.includeConflicts) {
    void qc.invalidateQueries({
      queryKey: gitQueryKey("git-conflicts", normalized),
    });
  }
  if (options?.includeFileTree) {
    void qc.invalidateQueries({
      queryKey: [
        "fs-tree",
        normalized.project,
        projectTargetCacheKey(normalized),
      ],
    });
  }
  if (options?.reconcileEditorTabs) {
    void reconcileProjectEditorTabs(normalized);
  }
}

export function useWorkspaceStatus(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "workspace-status")
    : (["workspace-status"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).workspace.status(),
    staleTime: Infinity, // driven by workspace:changed event invalidation
  });
}

export function useInitWorkspace(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (path: string) => getBoundApiClient(owner).workspace.init(path),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "workspace-status") : ["workspace-status"],
      });
    },
  });
}

export function useDiscoverProjects(path: string | null, options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "workspace-discover", path)
    : (["workspace-discover", path] as const);
  return useQuery<DiscoverResponse>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).workspace.discover(path!),
    enabled: !!path,
    staleTime: 30_000,
  });
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useWorkspace(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "workspace")
    : (["workspace"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).workspace.get(),
  });
}

export function useProjects(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "projects")
    : (["projects"] as const);

  return useQuery<ProjectWithStatus[]>({
    queryKey,
    queryFn: () => (owner ? getApi(owner).projects.list() : api.projects.list()),
    refetchInterval: 30_000,
  });
}

export function useProject(name: string) {
  return useQuery({
    queryKey: ["project", name],
    queryFn: () => api.projects.get(name),
    enabled: !!name,
  });
}

export function useProjectStatus(target: ProjectTargetInput, enabled = true) {
  const normalized = normalizeProjectTarget(target);
  return useQuery({
    queryKey: [
      "project-status",
      normalized.project,
      projectTargetCacheKey(normalized),
    ],
    queryFn: () => api.projects.status(normalized),
    enabled: enabled && !!normalized.project,
  });
}

export function useHostMetrics(enabled: boolean, options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "system", "metrics")
    : (["system", "metrics"] as const);
  return useQuery<HostMetrics>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).system.metrics(),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
  });
}

export function useHostResourceSnapshot(enabled = true, options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "system", "resource-snapshot")
    : (["system", "resource-snapshot"] as const);
  return useQuery<HostResourceSnapshotV1>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).system.resourceSnapshot(),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useHostResourceAlerts(
  enabled: boolean,
  limit = 20,
  options?: OwnerInput,
) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "system", "resource-alerts", limit)
    : (["system", "resource-alerts", limit] as const);
  return useQuery<HostResourceAlertIncident[]>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).system.resourceAlerts(limit),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}
export const IDLE_SUSPEND_STATUS_QUERY_KEY = [
  "system",
  "idle-suspend",
  "v1",
  "status",
  ];

export function useIdleSuspendStatus(enabled = true, options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "system", "idle-suspend", "v1", "status")
    : IDLE_SUSPEND_STATUS_QUERY_KEY;
  return useQuery<IdleSuspendStatusV1>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).system.idleSuspendStatus(),
    enabled,
    staleTime: 5_000,
  });
}

export function useUpdateIdleSuspendTiming(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation<
    IdleSuspendTimingPatchResponse,
    Error,
    IdleSuspendTimingPatchRequest
  >({
    mutationFn: (timing: IdleSuspendTimingPatchRequest) =>
      getBoundApiClient(owner).system.updateIdleSuspendTiming(timing),
    retry: false,
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "system", "idle-suspend", "v1", "status")
          : IDLE_SUSPEND_STATUS_QUERY_KEY,
      });
    },
  });
}

export function useForceSuspend(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation<ForceSuspendAcceptedResponse, Error, ForceSuspendRequest>({
    mutationFn: (request: ForceSuspendRequest) =>
      getBoundApiClient(owner).system.forceSuspend(request),
    retry: false,
    onSettled: () => {
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "system", "idle-suspend", "v1", "status")
          : IDLE_SUSPEND_STATUS_QUERY_KEY,
      });
    },
  });
}

export const WORKTREE_DISCOVERY_POLL_INTERVAL_MS = 10_000;

export interface WorktreeQueryOptions {
  enabled?: boolean;
  pollWhileVisible?: boolean;
}

export function useWorktrees(
  project: string,
  options: WorktreeQueryOptions = {},
) {
  const enabled = !!project && (options.enabled ?? true);
  return useQuery<Worktree[]>({
    queryKey: ["worktrees", project],
    queryFn: () => api.git.worktrees(project),
    enabled,
    refetchOnWindowFocus: enabled ? "always" : false,
    refetchOnReconnect: enabled ? "always" : false,
    refetchInterval:
      enabled && options.pollWhileVisible
        ? WORKTREE_DISCOVERY_POLL_INTERVAL_MS
        : false,
  });
}

export function useGitRoots(target: ProjectTargetInput) {
  const normalized = normalizeProjectTarget(target);
  return useQuery({
    queryKey: gitQueryKey("git-roots", normalized),
    queryFn: () => api.git.roots(normalized),
    enabled: !!normalized.project,
  });
}

export function useBranches(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery({
    queryKey: gitQueryKey("branches", normalized, rootKey),
    queryFn: () => api.git.branches(normalized, root),
    enabled: !!normalized.project,
  });
}

export function useGitLog(
  target: ProjectTargetInput,
  limit?: number,
  offset?: number,
  ref?: string,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery({
    queryKey: gitQueryKey(
      "git-log",
      normalized,
      rootKey,
      limit,
      offset,
      ref ?? null,
    ),
    queryFn: () => api.git.log(normalized, limit, offset, ref, root),
    enabled: !!normalized.project,
  });
}

export function useConfig(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "config")
    : (["config"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).config.get(),
    staleTime: Infinity, // IPC config:changed events drive invalidation
  });
}

export function useKnownWorkspaces(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "known-workspaces")
    : (["known-workspaces"] as const);
  return useQuery<KnownWorkspacesResponse>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).workspace.known(),
    staleTime: 30_000,
  });
}

type ExplorerLanguageScanQueryClient = Pick<
  QueryClient,
  "getQueryData" | "setQueryData" | "removeQueries"
>;

/**
 * Run a project scan only when the caller explicitly invokes this function.
 * Return cache state and commit status so stale responses cannot be rendered
 * accidentally as the current project result.
 */
export async function scanExplorerLanguageFiles(
  queryClient: ExplorerLanguageScanQueryClient,
  project: string,
  fetcher: (
    project: string,
    worktreePath?: string,
  ) => ReturnType<typeof api.fs.languageFiles> = (project, worktreePath) =>
    api.fs.languageFiles(
      worktreePath == null ? project : { project, worktreePath },
    ),
  worktreePath?: string,
): Promise<ExplorerLanguageScanCommitResult> {
  const targetKey = projectTargetCacheKey(
    worktreePath == null ? project : { project, worktreePath },
  );
  const scanToken = beginExplorerLanguageScan(queryClient, project, targetKey);
  const result = await fetcher(project, worktreePath);
  return commitExplorerLanguageScan(
    queryClient,
    project,
    scanToken,
    result,
    Date.now(),
    targetKey,
  );
}

/**
 * Read project scan metadata from QueryClient and expose an explicit Scan/
 * Rescan mutation. The disabled observer never performs a network request.
 */
export function useExplorerLanguageScan(target: ProjectTargetInput) {
  const queryClient = useQueryClient();
  const targetRef = normalizeProjectTarget(target);
  const project = targetRef.project;
  const worktreePath = targetRef.worktreePath ?? undefined;
  const targetKey = projectTargetCacheKey(targetRef);
  const query = useQuery<ExplorerLanguageScanCache>({
    queryKey: explorerLanguageScanQueryKey(project, targetKey),
    queryFn: () =>
      Promise.resolve(
        getExplorerLanguageScanCache(queryClient, project, targetKey) ??
          emptyExplorerLanguageScanCache(),
      ),
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
  const scan = useMutation({
    mutationFn: () =>
      scanExplorerLanguageFiles(queryClient, project, undefined, worktreePath),
  });
  const subscribe = useCallback(
    (listener: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        const queryKey = event.query.queryKey;
        if (
          queryKey.length === 3 &&
          queryKey[0] === EXPLORER_LANGUAGE_SCAN_QUERY_PREFIX &&
          queryKey[1] === project &&
          queryKey[2] === targetKey
        ) {
          listener();
        }
      }),
    [project, queryClient, targetKey],
  );
  const getCacheSnapshot = useCallback(() => {
    const cache = getExplorerLanguageScanCache(queryClient, project, targetKey);
    return cache?.result ? cache : null;
  }, [project, queryClient, targetKey]);
  const cache = useSyncExternalStore(
    subscribe,
    getCacheSnapshot,
    getCacheSnapshot,
  );

  return { ...query, scan, cache };
}

export function useGlobalConfig(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "global-config")
    : (["global-config"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).globalConfig.get(),
  });
}

export function useTerminalSessions(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "terminal-sessions")
    : (["terminal-sessions"] as const);

  return useQuery<SessionInfo[]>({
    queryKey,
    queryFn: async () => {
      const transport = owner ? getBoundTransport(owner) : getTransport();
      const sessions = await transport.invoke<SessionInfo[]>(
        "terminal:listDetailed",
      );
      rememberTerminalSessionIncarnations(sessions, owner?.profileId);
      return sessions;
    },
    staleTime: Infinity, // driven by terminal:changed push event invalidation
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useSwitchWorkspace(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (path: string) => getBoundApiClient(owner).workspace.switch(path),
    // No onSuccess invalidation — SSE workspace:changed handles nuclear cache flush
  });
}

export function useAddKnownWorkspace(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (path: string) =>
      getBoundApiClient(owner).workspace.addKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "known-workspaces")
          : ["known-workspaces"],
      }),
  });
}

export function useRemoveKnownWorkspace(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (path: string) =>
      getBoundApiClient(owner).workspace.removeKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "known-workspaces")
          : ["known-workspaces"],
      }),
  });
}

export function useUpdateGlobalDefaults(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (defaults: { workspace?: string }) =>
      getBoundApiClient(owner).globalConfig.updateDefaults(defaults),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "global-config")
          : ["global-config"],
      }),
  });
}

export function useUpdateUiConfig(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (ui: Partial<UiConfig>) =>
      getBoundApiClient(owner).globalConfig.updateUi(ui),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "global-config")
          : ["global-config"],
      }),
  });
}

export function useUpdateConfig(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation<DamHopperConfig, Error, DamHopperConfig>({
    mutationFn: (config: DamHopperConfig) =>
      getBoundApiClient(owner).config.update(config),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "config") : ["config"],
      });
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "workspace") : ["workspace"],
      });
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "projects") : ["projects"],
      });
    },
  });
}

export function useUpdateProject(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: ({
      name,
      data,
    }: {
      name: string;
      data: Partial<ProjectConfig>;
    }) => getBoundApiClient(owner).config.updateProject(name, data),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "config") : ["config"],
      });
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "projects") : ["projects"],
      });
    },
  });
}

// ── Git Diff / Change Management ──────────────────────────────────────────────

export function useGitDiff(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<GitDiffResult>({
    queryKey: gitQueryKey("git-diff", normalized, rootKey),
    queryFn: async () => {
      try {
        return {
          ...(await api.git.diff(normalized, root)),
          gitAvailable: true,
        };
      } catch (error) {
        if (isGitUnavailableError(error)) {
          return {
            gitAvailable: false,
            code: "GIT_NOT_INITIALIZED",
            entries: [],
            untrackedTruncated: false,
            untrackedTotal: 0,
          };
        }
        throw error;
      }
    },
    enabled: !!normalized.project,
    staleTime: 0,
  });
}

export function useGitUntracked(
  target: ProjectTargetInput,
  offset: number,
  limit: number,
  enabled: boolean,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<DiffFileEntry[]>({
    queryKey: gitQueryKey("git-untracked", normalized, rootKey, offset, limit),
    queryFn: () => api.git.untrackedFiles(normalized, offset, limit, root),
    enabled: !!normalized.project && enabled,
    staleTime: 0,
  });
}

export function useGitFileDiff(
  target: ProjectTargetInput,
  path: string,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<FileDiffContent>({
    queryKey: gitQueryKey("git-file-diff", normalized, rootKey, path),
    queryFn: () => api.git.fileDiff(normalized, path, root),
    enabled: !!normalized.project && !!path,
    staleTime: 0,
  });
}

export function useGitCommitFiles(
  target: ProjectTargetInput,
  hash: string,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<DiffFileEntry[]>({
    queryKey: gitQueryKey("git-commit-files", normalized, rootKey, hash),
    queryFn: () => api.git.commitFiles(normalized, hash, root),
    enabled: !!normalized.project && !!hash,
    staleTime: 60_000,
  });
}

export function useGitCommitMessage(
  target: ProjectTargetInput,
  hash: string,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<string>({
    queryKey: gitQueryKey("git-commit-message", normalized, rootKey, hash),
    queryFn: async () =>
      (await api.git.commitMessage(normalized, hash, root)).message,
    enabled: !!normalized.project && !!hash,
    staleTime: Infinity,
  });
}

export function useGitCommitFileDiff(
  target: ProjectTargetInput,
  hash: string,
  path: string,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<FileDiffContent>({
    queryKey: gitQueryKey(
      "git-commit-file-diff",
      normalized,
      rootKey,
      hash,
      path,
    ),
    queryFn: () => api.git.commitFileDiff(normalized, hash, path, root),
    enabled: !!normalized.project && !!hash && !!path,
    staleTime: Infinity, // historical diffs are immutable
  });
}

export function useGitConflicts(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const rootKey = gitRootKey(root);
  return useQuery<ConflictFile[]>({
    queryKey: gitQueryKey("git-conflicts", normalized, rootKey),
    queryFn: () => api.git.conflicts(normalized, root),
    enabled: !!normalized.project,
    staleTime: 0,
  });
}

export function useGitStage(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.git.stage(normalized, paths, root),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, normalized, {
        includeGitDiff: true,
        includeProjectStatus: true,
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitUnstage(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.git.unstage(normalized, paths, root),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, normalized, {
        includeGitDiff: true,
        includeProjectStatus: true,
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitDiscard(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.git.discard(normalized, path, root),
    onSuccess: (_data, path) =>
      void invalidateGitFileOperation(qc, normalized, path),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitDiscardHunk(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, hunkIndex }: { path: string; hunkIndex: number }) =>
      api.git.discardHunk(normalized, path, hunkIndex, root),
    onSuccess: (_data, { path }) =>
      void invalidateGitFileOperation(qc, normalized, path),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitResolve(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.git.resolve(normalized, path, content, root),
    onSuccess: (_result, { path }) =>
      void invalidateGitHistoryOperation(qc, normalized, [path]),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitCommit(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      message,
      amend = false,
    }: {
      message: string;
      amend?: boolean;
    }) => api.git.commit(normalized, message, amend, root),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, normalized, {
        includeConflicts: true,
        includeGitDiff: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitCreateBranch(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: {
      name: string;
      startPoint?: string;
      checkout?: boolean;
    }) => api.git.createBranch(normalized, { ...options, root }),
    onSuccess: (_result, vars) =>
      invalidateGitProjectQueries(qc, normalized, {
        includeBranches: true,
        includeConflicts: Boolean(vars.checkout),
        includeFileTree: Boolean(vars.checkout),
        includeGitDiff: Boolean(vars.checkout),
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
        reconcileEditorTabs: Boolean(vars.checkout),
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitCheckoutBranch(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: {
      branch: string;
      startPoint?: string;
      create?: boolean;
      strategy?: CheckoutStrategy;
    }) => api.git.checkoutBranch(normalized, { ...options, root }),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, normalized, {
        includeBranches: true,
        includeConflicts: true,
        includeFileTree: true,
        includeGitDiff: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
        reconcileEditorTabs: true,
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitDeleteBranch(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: { name: string }) =>
      api.git.deleteBranch(normalized, { ...options, root }),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, normalized, {
        includeBranches: true,
        includeGitLog: true,
      }),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitCherryPick(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) => api.git.cherryPick(normalized, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitReset(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, mode }: { hash: string; mode: ResetMode }) =>
      api.git.reset(normalized, hash, mode, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitUndoLastCommit(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.git.undoLastCommit(normalized, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitCherryPickCommitFiles(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.cherryPickCommitFiles(normalized, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, normalized, paths),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitDropCommitFiles(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.dropCommitFiles(normalized, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, normalized, paths),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitDropCommit(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash }: { hash: string }) =>
      api.git.dropCommit(normalized, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitEditCommitMessage(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, message }: { hash: string; message: string }) =>
      api.git.editCommitMessage(normalized, hash, message, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitRevertCommit(target: ProjectTargetInput, root?: string) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash }: { hash: string }) =>
      api.git.revertCommit(normalized, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, normalized),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

export function useGitRevertCommitFiles(
  target: ProjectTargetInput,
  root?: string,
) {
  const normalized = normalizeProjectTarget(target);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.revertCommitFiles(normalized, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, normalized, paths),
    onError: (error) => markTargetUnavailableIfNeeded(normalized, error),
  });
}

// ────────────────────────────────────────────────────────────────────────────

export function useGitFetch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targets?: ProjectTargetInput[]) => api.git.fetch(targets),
    onSuccess: (_result, targets) => {
      markFailedGitResults(_result, targets);
      return invalidateGitBulkTargets(qc, targets, {
        includeBranches: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      });
    },
    onError: (error, targets) => {
      if (targets?.length === 1) {
        for (const target of targets) {
          markTargetUnavailableIfNeeded(target, error);
        }
      } else if (!targets) {
        markOpenEditorTargetsUnavailableIfNeeded(error);
      }
    },
  });
}

export function useGitPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targets?: ProjectTargetInput[]) => api.git.pull(targets),
    onSuccess: (_result, targets) => {
      markFailedGitResults(_result, targets);
      return invalidateGitBulkTargets(qc, targets, {
        includeBranches: true,
        includeConflicts: true,
        includeFileTree: true,
        includeGitDiff: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
        reconcileEditorTabs: true,
      });
    },
    onError: (error, targets) => {
      if (targets?.length === 1) {
        for (const target of targets) {
          markTargetUnavailableIfNeeded(target, error);
        }
      } else if (!targets) {
        markOpenEditorTargetsUnavailableIfNeeded(error);
      }
    },
  });
}

function invalidateGitBulkTargets(
  qc: QueryInvalidator,
  targets: ProjectTargetInput[] | undefined,
  options: Parameters<typeof invalidateGitProjectQueries>[2],
) {
  if (!targets) {
    for (const prefix of [
      "branches",
      "git-conflicts",
      "git-diff",
      "git-log",
      "project-status",
      "fs-tree",
    ]) {
      void qc.invalidateQueries({ queryKey: [prefix] });
    }
    void qc.invalidateQueries({ queryKey: ["projects"] });
    if (options?.reconcileEditorTabs) {
      void reconcileAllOpenEditorTargets();
    }
    return;
  }

  for (const target of targets) {
    invalidateGitProjectQueries(qc, target, options);
  }
}

export function resolveGitPushTarget(
  target:
    | string
    | {
        project: string;
        worktreePath?: string;
        root?: string;
        force?: boolean;
      },
) {
  if (typeof target === "string") {
    return [target, undefined, undefined] as const;
  }

  return [target.project, target.root, target.force] as const;
}

export function useGitPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      target:
        | string
        | {
            project: string;
            worktreePath?: string;
            root?: string;
            force?: boolean;
          },
    ) => {
      const [project, root, force] = resolveGitPushTarget(target);
      const targetRef =
        typeof target === "string" || target.worktreePath == null
          ? project
          : { project, worktreePath: target.worktreePath };
      return api.git.push(targetRef, root, force);
    },
    onSuccess: (_result, target) => {
      const targetRef = typeof target === "string" ? target : target;
      markTargetUnavailableIfNeeded(targetRef, _result);
      invalidateGitProjectQueries(qc, targetRef, {
        includeBranches: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      });
    },
    onError: (error, target) => {
      const targetRef = typeof target === "string" ? target : target;
      markTargetUnavailableIfNeeded(targetRef, error);
    },
  });
}

export function useAddWorktree(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      path: string;
      branch: string;
      createBranch?: boolean;
    }) => api.git.addWorktree(project, opts),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["worktrees", project] });
    },
  });
}

export function useSshAddKey() {
  return useMutation({
    mutationFn: ({
      passphrase,
      keyPath,
      saveForLater,
    }: {
      passphrase: string;
      keyPath?: string;
      saveForLater?: boolean;
    }) =>
      getTransport().invoke<SshLoadKeyResult>("ssh:addKey", {
        passphrase,
        keyPath,
        saveForLater,
      }),
  });
}

export function useSshCredentialStatus(keyPath?: string) {
  return useQuery({
    queryKey: ["ssh-credential-status", keyPath ?? ""],
    queryFn: () =>
      getTransport().invoke<SshCredentialStatus>("ssh:credentialStatus", {
        keyPath,
      }),
    staleTime: 60_000,
  });
}

export function useSshForgetCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyPath?: string) =>
      getTransport().invoke<SshForgetCredentialResult>("ssh:forgetCredential", {
        keyPath,
      }),
    onSuccess: (_result, keyPath) => {
      void qc.invalidateQueries({
        queryKey: ["ssh-credential-status", keyPath ?? ""],
      });
    },
  });
}

export function useSshCheckAgent() {
  return useQuery({
    queryKey: ["ssh-agent"],
    queryFn: () =>
      getTransport().invoke<{ hasKeys: boolean; keyCount: number }>(
        "ssh:checkAgent",
      ),
    staleTime: 60_000,
  });
}

export function useSshListKeys() {
  return useQuery({
    queryKey: ["ssh-keys"],
    queryFn: () => getTransport().invoke<string[]>("ssh:listKeys"),
    staleTime: 60_000,
  });
}

export function useRemoveWorktree(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.git.removeWorktree(project, path),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["worktrees", project] });
    },
  });
}

// ── Settings & Maintenance ────────────────────────────────────────────────────

export function useClearCache(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: () => getBoundApiClient(owner).settings.clearCache(),
    onSuccess: () => {
      if (owner) {
        void qc.invalidateQueries({
          queryKey: profileQueryPrefix(owner.profileId),
        });
      } else {
        qc.clear();
      }
    },
  });
}

export function useResetWorkspace(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: () => getBoundApiClient(owner).settings.reset(),
    onSuccess: () => {
      if (owner) {
        void qc.invalidateQueries({
          queryKey: profileQueryPrefix(owner.profileId),
        });
      }
    },
  });
}

export function useExportSettings(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  return useMutation<string, Error, void>({
    mutationFn: () => getBoundApiClient(owner).settings.exportConfig(),
  });
}

export function useImportSettings(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation<SettingsImportResponse, Error, string>({
    mutationFn: (tomlContent: string) =>
      getBoundApiClient(owner).settings.importConfig(tomlContent),
    onSuccess: (result) => {
      if (result?.imported) {
        if (owner) {
          void qc.invalidateQueries({ queryKey: profileQueryKey(owner, "config") });
          void qc.invalidateQueries({ queryKey: profileQueryKey(owner, "projects") });
          void qc.invalidateQueries({ queryKey: profileQueryKey(owner, "workspace") });
        } else {
          void qc.invalidateQueries({ queryKey: ["config"] });
          void qc.invalidateQueries({ queryKey: ["projects"] });
          void qc.invalidateQueries({ queryKey: ["workspace"] });
        }
      }
    },
  });
}

export function useUsageSummary(
  query: UsageSummaryQuery = {},
  options?: OwnerInput,
) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "summary", query)
    : (["usage", "summary", query] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.summary(query),
  });
}

export const usageSessionPollInterval = () =>
  typeof document !== "undefined" && document.visibilityState === "visible"
    ? 15_000
    : false;

export function useUsageSessions(
  query: UsageSessionQuery = {},
  enabled = true,
  options?: OwnerInput,
) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "sessions", query)
    : (["usage", "sessions", query] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.sessions(query),
    enabled,
    refetchInterval: usageSessionPollInterval,
  });
}

export function useUsageSession(
  id: string | null,
  enabled = true,
  options?: OwnerInput,
) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "session", id)
    : (["usage", "session", id] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.session(id!),
    enabled: enabled && id !== null,
    refetchInterval: usageSessionPollInterval,
  });
}

export function useUsageHealth(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "health")
    : (["usage", "health"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.health(),
    refetchInterval: 30_000,
  });
}

export function useUsageSettings(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "settings")
    : (["usage", "settings"] as const);
  return useQuery({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.settings(),
  });
}

export function useUsageSetupStatus(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "usage", "setup")
    : (["usage", "setup"] as const);
  return useQuery<UsageSetupStatus>({
    queryKey,
    queryFn: () => getBoundApiClient(owner).usage.setupStatus(),
    refetchInterval: 10_000,
  });
}

export function useConfigureUsageInsights(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (patch: UsageSettingsPatch) =>
      getBoundApiClient(owner).usage.configure(patch),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "usage") : ["usage"],
      });
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "config") : ["config"],
      });
    },
  });
}

export function useUpdateUsageSettings(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: (patch: UsageSettingsPatch) =>
      getBoundApiClient(owner).usage.updateSettings(patch),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "usage") : ["usage"],
      }),
  });
}

export function useDeleteUsageData(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: () => getBoundApiClient(owner).usage.deleteAll(),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "usage") : ["usage"],
      }),
  });
}

export function useDeleteUsageRange(options?: OwnerInput) {
  const qc = useQueryClient();
  const owner = resolveTargetOwner(options);
  return useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) =>
      getBoundApiClient(owner).usage.deleteRange(from, to),
    onSuccess: () =>
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "usage") : ["usage"],
      }),
  });
}

export function useExportDiagnostics(options?: OwnerInput) {
  const owner = resolveTargetOwner(options);
  return useMutation<
    DiagnosticExportResponse,
    Error,
    Parameters<typeof api.diagnostics.export>[0]
  >({
    mutationFn: (request: Parameters<typeof api.diagnostics.export>[0]) =>
      getBoundApiClient(owner).diagnostics.export(request),
  });
}

// ── Agent Store ────────────────────────────────────────────────────────────────

export function useAgentStoreItems(
  category?: AgentItemCategory,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "items", category ?? "all")
    : (["agent-store", "items", category ?? "all"] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner ? getApi(owner).agentStore.list(category) : api.agentStore.list(category),
    staleTime: 30_000,
  });
}

export function useAgentStoreItem(
  name: string,
  category: AgentItemCategory,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "item", name, category)
    : (["agent-store", "item", name, category] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner ? getApi(owner).agentStore.get(name, category) : api.agentStore.get(name, category),
    enabled: !!name,
    staleTime: 30_000,
  });
}

export function useAgentStoreContent(
  name: string,
  category: AgentItemCategory,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "content", name, category)
    : (["agent-store", "content", name, category] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner
        ? getApi(owner).agentStore.getContent(name, category)
        : api.agentStore.getContent(name, category),
    enabled: !!name,
    staleTime: Infinity,
  });
}

export function useAgentStoreScan(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "scan")
    : (["agent-store", "scan"] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner ? getApi(owner).agentStore.scan() : api.agentStore.scan(),
    staleTime: 30_000,
  });
}

export function useAgentStoreMatrix(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "matrix")
    : (["agent-store", "matrix"] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner ? getApi(owner).agentStore.matrix() : api.agentStore.matrix(),
    staleTime: 30_000,
  });
}

export function useAgentStoreHealth(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-store", "health")
    : (["agent-store", "health"] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner ? getApi(owner).agentStore.health() : api.agentStore.health(),
    staleTime: 30_000,
  });
}

export function useRemoveFromStore(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: { name: string; category: AgentItemCategory }) =>
      owner
        ? getApi(owner).agentStore.remove(opts.name, opts.category)
        : api.agentStore.remove(opts.name, opts.category),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "agent-store") : ["agent-store"],
      });
    },
  });
}

export function useShipItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
      method?: DistributionMethod;
    }) =>
      owner
        ? getApi(owner).agentStore.ship(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
            opts.method,
          )
        : api.agentStore.ship(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
            opts.method,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "agent-store", "matrix")
          : ["agent-store", "matrix"],
      });
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "agent-store", "scan")
          : ["agent-store", "scan"],
      });
    },
  });
}

export function useUnshipItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) =>
      owner
        ? getApi(owner).agentStore.unship(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
          )
        : api.agentStore.unship(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "agent-store", "matrix")
          : ["agent-store", "matrix"],
      });
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "agent-store", "scan")
          : ["agent-store", "scan"],
      });
    },
  });
}

export function useAbsorbItem(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) =>
      owner
        ? getApi(owner).agentStore.absorb(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
          )
        : api.agentStore.absorb(
            opts.itemName,
            opts.category,
            opts.projectName,
            opts.agent,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "agent-store") : ["agent-store"],
      });
    },
  });
}

export function useBulkShip(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      items: Array<{ name: string; category: AgentItemCategory }>;
      targets: Array<{ projectName: string; agent: AgentType }>;
      method?: DistributionMethod;
    }) =>
      owner
        ? getApi(owner).agentStore.bulkShip(opts.items, opts.targets, opts.method)
        : api.agentStore.bulkShip(opts.items, opts.targets, opts.method),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "agent-store") : ["agent-store"],
      });
    },
  });
}

// ── Memory ────────────────────────────────────────────────────────────────────

export function useMemoryTemplates(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-memory", "templates")
    : (["agent-memory", "templates"] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner
        ? getApi(owner).agentMemory.templates()
        : api.agentMemory.templates(),
    staleTime: 30_000,
  });
}

export function useMemoryFile(
  projectName: string,
  agent: AgentType,
  options?: { owner?: ConnectionRef; profileId?: ProfileId },
) {
  const owner = resolveWorkflowOwner(options);
  const queryKey = owner
    ? profileQueryKey(owner, "agent-memory", "file", projectName, agent)
    : (["agent-memory", "file", projectName, agent] as const);
  return useQuery({
    queryKey,
    queryFn: () =>
      owner
        ? getApi(owner).agentMemory.get(projectName, agent)
        : api.agentMemory.get(projectName, agent),
    enabled: !!projectName,
    staleTime: 30_000,
  });
}

export function useUpdateMemoryFile(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      projectName: string;
      agent: AgentType;
      content: string;
    }) =>
      owner
        ? getApi(owner).agentMemory.update(opts.projectName, opts.agent, opts.content)
        : api.agentMemory.update(opts.projectName, opts.agent, opts.content),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: owner
          ? profileQueryKey(owner, "agent-memory", "file", vars.projectName, vars.agent)
          : ["agent-memory", "file", vars.projectName, vars.agent],
      });
    },
  });
}

export function useApplyMemoryTemplate(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      templateName: string;
      projectName: string;
      agent: AgentType;
    }) =>
      owner
        ? getApi(owner).agentMemory.apply(opts.templateName, opts.projectName, opts.agent)
        : api.agentMemory.apply(opts.templateName, opts.projectName, opts.agent),
  });
}

// ── Import from repo ──────────────────────────────────────────────────────────

export function useScanRepo(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (repoUrl: string) =>
      owner ? getApi(owner).agentImport.scan(repoUrl) : api.agentImport.scan(repoUrl),
  });
}

export function useScanLocalDir(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (dirPath: string) =>
      owner ? getApi(owner).agentImport.scanLocal(dirPath) : api.agentImport.scanLocal(dirPath),
  });
}

export function useImportConfirm(options?: {
  owner?: ConnectionRef;
  profileId?: ProfileId;
}) {
  const qc = useQueryClient();
  const owner = resolveWorkflowOwner(options);
  return useMutation({
    mutationFn: (opts: {
      tmpDir: string;
      selectedItems: Array<{
        name: string;
        category: AgentItemCategory;
        relativePath: string;
      }>;
      skipCleanup?: boolean;
    }) =>
      owner
        ? getApi(owner).agentImport.confirm(
            opts.tmpDir,
            opts.selectedItems,
            opts.skipCleanup,
          )
        : api.agentImport.confirm(
            opts.tmpDir,
            opts.selectedItems,
            opts.skipCleanup,
          ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: owner ? profileQueryKey(owner, "agent-store") : ["agent-store"],
      });
    },
  });
}

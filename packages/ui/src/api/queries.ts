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
} from "./client.js";
import type { SessionInfo } from "@/api/client.js";
import { markProjectTargetUnavailable } from "@/stores/project-target.js";

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
) {
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
  }
}

function markFailedGitResults(
  results: GitOpResult[] | undefined,
  requestedTargets?: ProjectTargetInput[],
) {
  if (!Array.isArray(results)) return;

  for (const result of results) {
    if (result.success || !isProjectTargetError(result.error)) continue;

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
      const target =
        resultTargetPath === undefined
          ? candidates.length === 1
            ? candidates[0]
            : undefined
          : candidates.find(
              (candidate) =>
                (normalizeProjectTarget(candidate).worktreePath ?? null) ===
                resultTargetPath,
            );
      if (target) markTargetUnavailableIfNeeded(target, result.error);
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

export function useWorkspaceStatus() {
  return useQuery({
    queryKey: ["workspace-status"],
    queryFn: () => api.workspace.status(),
    staleTime: Infinity, // driven by workspace:changed event invalidation
  });
}

export function useInitWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.init(path),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
    },
  });
}

export function useDiscoverProjects(path: string | null) {
  return useQuery({
    queryKey: ["workspace-discover", path],
    queryFn: () => api.workspace.discover(path!),
    enabled: !!path,
    staleTime: 30_000,
  });
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useWorkspace() {
  return useQuery({
    queryKey: ["workspace"],
    queryFn: () => api.workspace.get(),
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
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

export function useHostMetrics(enabled: boolean) {
  return useQuery<HostMetrics>({
    queryKey: ["system", "metrics"],
    queryFn: () => api.system.metrics(),
    enabled,
    refetchInterval: enabled ? 1_000 : false,
  });
}

export function useHostResourceSnapshot(enabled = true) {
  return useQuery<HostResourceSnapshotV1>({
    queryKey: ["system", "resource-snapshot"],
    queryFn: () => api.system.resourceSnapshot(),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}

export function useHostResourceAlerts(enabled: boolean, limit = 20) {
  return useQuery<HostResourceAlertIncident[]>({
    queryKey: ["system", "resource-alerts", limit],
    queryFn: () => api.system.resourceAlerts(limit),
    enabled,
    refetchInterval: enabled ? 30_000 : false,
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

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.config.get(),
    staleTime: Infinity, // IPC config:changed events drive invalidation
  });
}

export function useKnownWorkspaces() {
  return useQuery({
    queryKey: ["known-workspaces"],
    queryFn: () => api.workspace.known(),
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

export function useGlobalConfig() {
  return useQuery({
    queryKey: ["global-config"],
    queryFn: () => api.globalConfig.get(),
  });
}

export function useTerminalSessions() {
  return useQuery<SessionInfo[]>({
    queryKey: ["terminal-sessions"],
    queryFn: () =>
      getTransport().invoke<SessionInfo[]>("terminal:listDetailed"),
    staleTime: Infinity, // driven by terminal:changed push event invalidation
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useSwitchWorkspace() {
  return useMutation({
    mutationFn: (path: string) => api.workspace.switch(path),
    // No onSuccess invalidation — SSE workspace:changed handles nuclear cache flush
  });
}

export function useAddKnownWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.addKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["known-workspaces"] }),
  });
}

export function useRemoveKnownWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.workspace.removeKnown(path),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["known-workspaces"] }),
  });
}

export function useUpdateGlobalDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaults: { workspace?: string }) =>
      api.globalConfig.updateDefaults(defaults),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["global-config"] }),
  });
}

export function useUpdateUiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ui: Partial<UiConfig>) => api.globalConfig.updateUi(ui),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["global-config"] }),
  });
}

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DamHopperConfig) => api.config.update(config),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      name,
      data,
    }: {
      name: string;
      data: Partial<ProjectConfig>;
    }) => api.config.updateProject(name, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["config"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
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
      if (targets) {
        for (const target of targets) {
          markTargetUnavailableIfNeeded(target, error);
        }
      } else {
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
      if (targets) {
        for (const target of targets) {
          markTargetUnavailableIfNeeded(target, error);
        }
      } else {
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

export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.clearCache(),
    onSuccess: () => {
      qc.clear(); // Drop all cached query data — forces fresh fetches
    },
  });
}

export function useResetWorkspace() {
  // No onSuccess needed — workspace:changed(null) SSE event triggers
  // nuclear cache invalidation in useIpc hook
  return useMutation({
    mutationFn: () => api.settings.reset(),
  });
}

export function useExportSettings() {
  return useMutation({
    mutationFn: () => api.settings.exportConfig(),
  });
}

export function useImportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.importConfig(),
    onSuccess: (result) => {
      if (result?.imported) {
        void qc.invalidateQueries({ queryKey: ["config"] });
        void qc.invalidateQueries({ queryKey: ["projects"] });
        void qc.invalidateQueries({ queryKey: ["workspace"] });
      }
    },
  });
}

export function useUsageSummary(query: UsageSummaryQuery = {}) {
  return useQuery({
    queryKey: ["usage", "summary", query],
    queryFn: () => api.usage.summary(query),
  });
}

export const usageSessionPollInterval = () =>
  typeof document !== "undefined" && document.visibilityState === "visible"
    ? 15_000
    : false;

export function useUsageSessions(
  query: UsageSessionQuery = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["usage", "sessions", query],
    queryFn: () => api.usage.sessions(query),
    enabled,
    refetchInterval: usageSessionPollInterval,
  });
}

export function useUsageSession(id: string | null, enabled = true) {
  return useQuery({
    queryKey: ["usage", "session", id],
    queryFn: () => api.usage.session(id!),
    enabled: enabled && id !== null,
    refetchInterval: usageSessionPollInterval,
  });
}

export function useUsageHealth() {
  return useQuery({
    queryKey: ["usage", "health"],
    queryFn: () => api.usage.health(),
    refetchInterval: 30_000,
  });
}

export function useUsageSettings() {
  return useQuery({
    queryKey: ["usage", "settings"],
    queryFn: () => api.usage.settings(),
  });
}

export function useUsageSetupStatus() {
  return useQuery<UsageSetupStatus>({
    queryKey: ["usage", "setup"],
    queryFn: () => api.usage.setupStatus(),
    refetchInterval: 10_000,
  });
}

export function useConfigureUsageInsights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UsageSettingsPatch) => api.usage.configure(patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["usage"] });
      void qc.invalidateQueries({ queryKey: ["config"] });
    },
  });
}

export function useUpdateUsageSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UsageSettingsPatch) => api.usage.updateSettings(patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["usage"] }),
  });
}

export function useDeleteUsageData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.usage.deleteAll(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["usage"] }),
  });
}

export function useDeleteUsageRange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) =>
      api.usage.deleteRange(from, to),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["usage"] }),
  });
}

export function useExportDiagnostics() {
  return useMutation({
    mutationFn: (request: Parameters<typeof api.diagnostics.export>[0]) =>
      api.diagnostics.export(request),
  });
}

// ── Agent Store ────────────────────────────────────────────────────────────────

export function useAgentStoreItems(category?: AgentItemCategory) {
  return useQuery({
    queryKey: ["agent-store", "items", category ?? "all"],
    queryFn: () => api.agentStore.list(category),
    staleTime: 30_000,
  });
}

export function useAgentStoreItem(name: string, category: AgentItemCategory) {
  return useQuery({
    queryKey: ["agent-store", "item", name, category],
    queryFn: () => api.agentStore.get(name, category),
    enabled: !!name,
    staleTime: 30_000,
  });
}

export function useAgentStoreContent(
  name: string,
  category: AgentItemCategory,
) {
  return useQuery({
    queryKey: ["agent-store", "content", name, category],
    queryFn: () => api.agentStore.getContent(name, category),
    enabled: !!name,
    staleTime: Infinity, // file content is immutable until the item is replaced
  });
}

export function useAgentStoreScan() {
  return useQuery({
    queryKey: ["agent-store", "scan"],
    queryFn: () => api.agentStore.scan(),
    staleTime: 30_000,
  });
}

export function useAgentStoreMatrix() {
  return useQuery({
    queryKey: ["agent-store", "matrix"],
    queryFn: () => api.agentStore.matrix(),
    staleTime: 30_000,
  });
}

export function useAgentStoreHealth() {
  return useQuery({
    queryKey: ["agent-store", "health"],
    queryFn: () => api.agentStore.health(),
    staleTime: 30_000,
  });
}

export function useRemoveFromStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { name: string; category: AgentItemCategory }) =>
      api.agentStore.remove(opts.name, opts.category),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

export function useShipItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
      method?: DistributionMethod;
    }) =>
      api.agentStore.ship(
        opts.itemName,
        opts.category,
        opts.projectName,
        opts.agent,
        opts.method,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store", "matrix"] });
      void qc.invalidateQueries({ queryKey: ["agent-store", "scan"] });
    },
  });
}

export function useUnshipItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) =>
      api.agentStore.unship(
        opts.itemName,
        opts.category,
        opts.projectName,
        opts.agent,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store", "matrix"] });
      void qc.invalidateQueries({ queryKey: ["agent-store", "scan"] });
    },
  });
}

export function useAbsorbItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      itemName: string;
      category: AgentItemCategory;
      projectName: string;
      agent: AgentType;
    }) =>
      api.agentStore.absorb(
        opts.itemName,
        opts.category,
        opts.projectName,
        opts.agent,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

export function useBulkShip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      items: Array<{ name: string; category: AgentItemCategory }>;
      targets: Array<{ projectName: string; agent: AgentType }>;
      method?: DistributionMethod;
    }) => api.agentStore.bulkShip(opts.items, opts.targets, opts.method),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

// ── Memory ────────────────────────────────────────────────────────────────────

export function useMemoryTemplates() {
  return useQuery({
    queryKey: ["agent-memory", "templates"],
    queryFn: () => api.agentMemory.templates(),
    staleTime: 30_000,
  });
}

export function useMemoryFile(projectName: string, agent: AgentType) {
  return useQuery({
    queryKey: ["agent-memory", "file", projectName, agent],
    queryFn: () => api.agentMemory.get(projectName, agent),
    enabled: !!projectName,
    staleTime: 30_000,
  });
}

export function useUpdateMemoryFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: {
      projectName: string;
      agent: AgentType;
      content: string;
    }) => api.agentMemory.update(opts.projectName, opts.agent, opts.content),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["agent-memory", "file", vars.projectName, vars.agent],
      });
    },
  });
}

export function useApplyMemoryTemplate() {
  return useMutation({
    mutationFn: (opts: {
      templateName: string;
      projectName: string;
      agent: AgentType;
    }) =>
      api.agentMemory.apply(opts.templateName, opts.projectName, opts.agent),
  });
}

// ── Import from repo ──────────────────────────────────────────────────────────

export function useScanRepo() {
  return useMutation({
    mutationFn: (repoUrl: string) => api.agentImport.scan(repoUrl),
  });
}

export function useScanLocalDir() {
  return useMutation({
    mutationFn: (dirPath: string) => api.agentImport.scanLocal(dirPath),
  });
}

export function useImportConfirm() {
  const qc = useQueryClient();
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
      api.agentImport.confirm(
        opts.tmpDir,
        opts.selectedItems,
        opts.skipCleanup,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

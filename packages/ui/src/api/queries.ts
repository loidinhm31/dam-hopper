import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import { getTransport } from "./transport.js";
import { useEditorStore } from "@/stores/editor.js";
import type {
  DamHopperConfig,
  ProjectConfig,
  AgentItemCategory,
  AgentType,
  DistributionMethod,
  CheckoutStrategy,
  DiffFileEntry,
  DiffResponse,
  FileDiffContent,
  ConflictFile,
  ResetMode,
  UiConfig,
  UsageSettingsPatch,
  UsageSetupStatus,
  UsageSummaryQuery,
  HostMetrics,
  SshCredentialStatus,
  SshForgetCredentialResult,
  SshLoadKeyResult,
} from "./client.js";
import type { GitStatus, SessionInfo } from "@/api/client.js";

type QueryInvalidator = Pick<
  ReturnType<typeof useQueryClient>,
  "invalidateQueries"
>;

const DEFAULT_GIT_ROOT_ID = ".";

function gitRootKey(root?: string) {
  return root ?? DEFAULT_GIT_ROOT_ID;
}

async function reconcileAffectedEditorTabs(project: string, paths: string[]) {
  if (paths.length === 0) return;
  await useEditorStore.getState().reconcileGitMutationFiles(project, paths);
}

async function reconcileProjectEditorTabs(project: string) {
  await useEditorStore.getState().reconcileGitProjectFiles(project);
}

export async function invalidateGitFileOperation(
  qc: QueryInvalidator,
  project: string,
  path: string,
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["git-diff", project] }),
    qc.invalidateQueries({ queryKey: ["git-file-diff", project] }),
    qc.invalidateQueries({ queryKey: ["project-status", project] }),
    reconcileAffectedEditorTabs(project, [path]),
  ]);
}

export async function invalidateGitHistoryOperation(
  qc: QueryInvalidator,
  project: string,
  affectedPaths: string[] = [],
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["git-diff", project] }),
    qc.invalidateQueries({ queryKey: ["git-conflicts", project] }),
    qc.invalidateQueries({ queryKey: ["project-status", project] }),
    qc.invalidateQueries({ queryKey: ["git-file-diff", project] }),
    reconcileAffectedEditorTabs(project, affectedPaths),
  ]);
}

export async function invalidateGitBranchOperation(
  qc: QueryInvalidator,
  project: string,
) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: ["branches", project] }),
    qc.invalidateQueries({ queryKey: ["project-status", project] }),
    qc.invalidateQueries({ queryKey: ["projects"] }),
    qc.invalidateQueries({ queryKey: ["git-log", project] }),
    qc.invalidateQueries({ queryKey: ["git-diff", project] }),
    qc.invalidateQueries({ queryKey: ["git-conflicts", project] }),
    qc.invalidateQueries({ queryKey: ["fs-tree", project] }),
    reconcileProjectEditorTabs(project),
  ]);
}

function invalidateGitProjectQueries(
  qc: QueryInvalidator,
  project: string,
  options?: {
    includeBranches?: boolean;
    includeConflicts?: boolean;
    includeFileTree?: boolean;
    includeGitDiff?: boolean;
    includeGitLog?: boolean;
    includeProjects?: boolean;
    includeProjectStatus?: boolean;
  },
) {
  if (options?.includeBranches) {
    void qc.invalidateQueries({ queryKey: ["branches", project] });
  }
  if (options?.includeProjectStatus) {
    void qc.invalidateQueries({ queryKey: ["project-status", project] });
  }
  if (options?.includeProjects) {
    void qc.invalidateQueries({ queryKey: ["projects"] });
  }
  if (options?.includeGitLog) {
    void qc.invalidateQueries({ queryKey: ["git-log", project] });
  }
  if (options?.includeGitDiff) {
    void qc.invalidateQueries({ queryKey: ["git-diff", project] });
  }
  if (options?.includeConflicts) {
    void qc.invalidateQueries({ queryKey: ["git-conflicts", project] });
  }
  if (options?.includeFileTree) {
    void qc.invalidateQueries({ queryKey: ["fs-tree", project] });
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

export function useProjectStatus(name: string) {
  return useQuery({
    queryKey: ["project-status", name],
    queryFn: () => api.projects.status(name),
    enabled: !!name,
  });
}

/**
 * Loads a project's Git status only after an explicit user action.
 * The returned project name lets callers ignore a result from a previously
 * selected project without starting a background request.
 */
export function useManualProjectStatus() {
  return useMutation<{ project: string; status: GitStatus | null }, Error, string>({
    mutationFn: async (project: string) => ({
      project,
      status: await api.projects.status(project),
    }),
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

export function useWorktrees(project: string) {
  return useQuery({
    queryKey: ["worktrees", project],
    queryFn: () => api.git.worktrees(project),
    enabled: !!project,
  });
}

export function useGitRoots(project: string) {
  return useQuery({
    queryKey: ["git-roots", project],
    queryFn: () => api.git.roots(project),
    enabled: !!project,
  });
}

export function useBranches(project: string, root?: string) {
  const rootKey = gitRootKey(root);
  return useQuery({
    queryKey: ["branches", project, rootKey],
    queryFn: () => api.git.branches(project, root),
    enabled: !!project,
  });
}

export function useGitLog(
  project: string,
  limit?: number,
  offset?: number,
  ref?: string,
  root?: string,
) {
  const rootKey = gitRootKey(root);
  return useQuery({
    queryKey: ["git-log", project, rootKey, limit, offset, ref ?? null],
    queryFn: () => api.git.log(project, limit, offset, ref, root),
    enabled: !!project,
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

export function useGitDiff(project: string, root?: string) {
  const rootKey = gitRootKey(root);
  return useQuery<DiffResponse>({
    queryKey: ["git-diff", project, rootKey],
    queryFn: () => api.git.diff(project, root),
    enabled: !!project,
    staleTime: 0,
  });
}

export function useGitUntracked(
  project: string,
  offset: number,
  limit: number,
  enabled: boolean,
  root?: string,
) {
  const rootKey = gitRootKey(root);
  return useQuery<DiffFileEntry[]>({
    queryKey: ["git-untracked", project, rootKey, offset, limit],
    queryFn: () => api.git.untrackedFiles(project, offset, limit, root),
    enabled: !!project && enabled,
    staleTime: 0,
  });
}

export function useGitFileDiff(project: string, path: string, root?: string) {
  const rootKey = gitRootKey(root);
  return useQuery<FileDiffContent>({
    queryKey: ["git-file-diff", project, rootKey, path],
    queryFn: () => api.git.fileDiff(project, path, root),
    enabled: !!project && !!path,
    staleTime: 0,
  });
}

export function useGitCommitFiles(
  project: string,
  hash: string,
  root?: string,
) {
  const rootKey = gitRootKey(root);
  return useQuery<DiffFileEntry[]>({
    queryKey: ["git-commit-files", project, rootKey, hash],
    queryFn: () => api.git.commitFiles(project, hash, root),
    enabled: !!project && !!hash,
    staleTime: 60_000,
  });
}

export function useGitCommitMessage(
  project: string,
  hash: string,
  root?: string,
) {
  const rootKey = gitRootKey(root);
  return useQuery<string>({
    queryKey: ["git-commit-message", project, rootKey, hash],
    queryFn: async () =>
      (await api.git.commitMessage(project, hash, root)).message,
    enabled: !!project && !!hash,
    staleTime: Infinity,
  });
}

export function useGitCommitFileDiff(
  project: string,
  hash: string,
  path: string,
  root?: string,
) {
  const rootKey = gitRootKey(root);
  return useQuery<FileDiffContent>({
    queryKey: ["git-commit-file-diff", project, rootKey, hash, path],
    queryFn: () => api.git.commitFileDiff(project, hash, path, root),
    enabled: !!project && !!hash && !!path,
    staleTime: Infinity, // historical diffs are immutable
  });
}

export function useGitConflicts(project: string, root?: string) {
  const rootKey = gitRootKey(root);
  return useQuery<ConflictFile[]>({
    queryKey: ["git-conflicts", project, rootKey],
    queryFn: () => api.git.conflicts(project, root),
    enabled: !!project,
    staleTime: 0,
  });
}

export function useGitStage(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.git.stage(project, paths, root),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["git-diff", project] }),
  });
}

export function useGitUnstage(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (paths: string[]) => api.git.unstage(project, paths, root),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["git-diff", project] }),
  });
}

export function useGitDiscard(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.git.discard(project, path, root),
    onSuccess: (_data, path) =>
      void invalidateGitFileOperation(qc, project, path),
  });
}

export function useGitDiscardHunk(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, hunkIndex }: { path: string; hunkIndex: number }) =>
      api.git.discardHunk(project, path, hunkIndex, root),
    onSuccess: (_data, { path }) =>
      void invalidateGitFileOperation(qc, project, path),
  });
}

export function useGitResolve(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.git.resolve(project, path, content, root),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["git-conflicts", project] });
      void qc.invalidateQueries({ queryKey: ["git-diff", project] });
    },
  });
}

export function useGitCommit(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      message,
      amend = false,
    }: {
      message: string;
      amend?: boolean;
    }) => api.git.commit(project, message, amend, root),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, project, {
        includeConflicts: true,
        includeGitDiff: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      }),
  });
}

export function useGitCreateBranch(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: {
      name: string;
      startPoint?: string;
      checkout?: boolean;
    }) => api.git.createBranch(project, { ...options, root }),
    onSuccess: (_result, vars) =>
      invalidateGitProjectQueries(qc, project, {
        includeBranches: true,
        includeConflicts: Boolean(vars.checkout),
        includeFileTree: Boolean(vars.checkout),
        includeGitDiff: Boolean(vars.checkout),
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      }),
  });
}

export function useGitCheckoutBranch(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: {
      branch: string;
      startPoint?: string;
      create?: boolean;
      strategy?: CheckoutStrategy;
    }) => api.git.checkoutBranch(project, { ...options, root }),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, project, {
        includeBranches: true,
        includeConflicts: true,
        includeFileTree: true,
        includeGitDiff: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      }),
  });
}

export function useGitDeleteBranch(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: { name: string }) =>
      api.git.deleteBranch(project, { ...options, root }),
    onSuccess: () =>
      invalidateGitProjectQueries(qc, project, {
        includeBranches: true,
        includeGitLog: true,
      }),
  });
}

export function useGitCherryPick(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (hash: string) => api.git.cherryPick(project, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitReset(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, mode }: { hash: string; mode: ResetMode }) =>
      api.git.reset(project, hash, mode, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitUndoLastCommit(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.git.undoLastCommit(project, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitCherryPickCommitFiles(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.cherryPickCommitFiles(project, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, project, paths),
  });
}

export function useGitDropCommitFiles(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.dropCommitFiles(project, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, project, paths),
  });
}

export function useGitDropCommit(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash }: { hash: string }) =>
      api.git.dropCommit(project, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitEditCommitMessage(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, message }: { hash: string; message: string }) =>
      api.git.editCommitMessage(project, hash, message, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitRevertCommit(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash }: { hash: string }) =>
      api.git.revertCommit(project, hash, root),
    onSuccess: () => void invalidateGitBranchOperation(qc, project),
  });
}

export function useGitRevertCommitFiles(project: string, root?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hash, paths }: { hash: string; paths: string[] }) =>
      api.git.revertCommitFiles(project, hash, paths, root),
    onSuccess: (_result, { paths }) =>
      void invalidateGitHistoryOperation(qc, project, paths),
  });
}

// ────────────────────────────────────────────────────────────────────────────

export function useGitFetch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projects?: string[]) => api.git.fetch(projects),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useGitPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projects?: string[]) => api.git.pull(projects),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function resolveGitPushTarget(
  target: string | { project: string; root?: string; force?: boolean },
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
      target: string | { project: string; root?: string; force?: boolean },
    ) => {
      const [project, root, force] = resolveGitPushTarget(target);
      return api.git.push(project, root, force);
    },
    onSuccess: (_result, target) => {
      const project = typeof target === "string" ? target : target.project;
      invalidateGitProjectQueries(qc, project, {
        includeBranches: true,
        includeGitLog: true,
        includeProjects: true,
        includeProjectStatus: true,
      });
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

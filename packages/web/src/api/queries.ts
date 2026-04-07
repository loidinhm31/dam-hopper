import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import { getTransport } from "./transport.js";
import type {
  DevHubConfig,
  ProjectConfig,
  AgentItemCategory,
  AgentType,
  DistributionMethod,
  RepoScanItem,
} from "./client.js";
import type { SessionInfo } from "@/api/client.js";

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

export function useWorktrees(project: string) {
  return useQuery({
    queryKey: ["worktrees", project],
    queryFn: () => api.git.worktrees(project),
    enabled: !!project,
  });
}

export function useBranches(project: string) {
  return useQuery({
    queryKey: ["branches", project],
    queryFn: () => api.git.branches(project),
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
    queryFn: () => getTransport().invoke<SessionInfo[]>("terminal:listDetailed"),
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

export function useUpdateConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: DevHubConfig) => api.config.update(config),
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

export function useGitPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.git.push(project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
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
    }: {
      passphrase: string;
      keyPath?: string;
    }) => getTransport().invoke<{ success: boolean; error?: string }>("ssh:addKey", { passphrase, keyPath }),
  });
}

export function useSshCheckAgent() {
  return useQuery({
    queryKey: ["ssh-agent"],
    queryFn: () => getTransport().invoke<{ hasKeys: boolean; keyCount: number }>("ssh:checkAgent"),
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

export function useAgentStoreContent(name: string, category: AgentItemCategory) {
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
    }) => api.agentStore.ship(opts.itemName, opts.category, opts.projectName, opts.agent, opts.method),
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
    }) => api.agentStore.unship(opts.itemName, opts.category, opts.projectName, opts.agent),
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
    }) => api.agentStore.absorb(opts.itemName, opts.category, opts.projectName, opts.agent),
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
    mutationFn: (opts: { projectName: string; agent: AgentType; content: string }) =>
      api.agentMemory.update(opts.projectName, opts.agent, opts.content),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: ["agent-memory", "file", vars.projectName, vars.agent],
      });
    },
  });
}

export function useApplyMemoryTemplate() {
  return useMutation({
    mutationFn: (opts: { templateName: string; projectName: string; agent: AgentType }) =>
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
      selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>;
      skipCleanup?: boolean;
    }) => api.agentImport.confirm(opts.tmpDir, opts.selectedItems, opts.skipCleanup),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["agent-store"] });
    },
  });
}

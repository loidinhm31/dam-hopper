import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import type { DevHubConfig, ProjectConfig } from "./client.js";
import type { SessionInfo } from "@/types/electron.js";

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
    queryFn: () => window.devhub.terminal.listDetailed(),
    refetchInterval: 3_000,
    refetchIntervalInBackground: false,
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

export function useRemoveWorktree(project: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => api.git.removeWorktree(project, path),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["worktrees", project] });
    },
  });
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client.js";
import type { DevHubConfig, ProjectConfig } from "./client.js";

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

export function useProcesses() {
  return useQuery({
    queryKey: ["processes"],
    queryFn: () => api.processes.list(),
    refetchInterval: 5_000,
  });
}

export function useProcessLogs(project: string, lines = 100) {
  return useQuery({
    queryKey: ["process-logs", project, lines],
    queryFn: () => api.processes.logs(project, lines),
    enabled: !!project,
    refetchInterval: 3_000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => api.config.get(),
    staleTime: Infinity, // SSE config:changed events drive invalidation
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

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
    mutationFn: ({ name, data }: { name: string; data: Partial<ProjectConfig> }) =>
      api.config.updateProject(name, data),
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

export function useBuild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.build.start(project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useStartProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.processes.start(project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["processes"] });
    },
  });
}

export function useStopProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.processes.stop(project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["processes"] });
    },
  });
}

export function useRestartProcess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.processes.restart(project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["processes"] });
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

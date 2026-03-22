// IPC-only API client — all calls route through window.devhub (Electron contextBridge).
// No HTTP fetch or SSE code.

export type ProjectType =
  | "maven"
  | "gradle"
  | "npm"
  | "pnpm"
  | "cargo"
  | "custom";

export interface ServiceConfig {
  name: string;
  buildCommand?: string;
  runCommand?: string;
}

export interface ProjectConfig {
  name: string;
  path: string;
  type: ProjectType;
  services?: ServiceConfig[];
  commands?: Record<string, string>;
  envFile?: string;
  tags?: string[];
}

export interface WorkspaceConfig {
  name: string;
  root: string;
}

export interface DevHubConfig {
  workspace: WorkspaceConfig;
  projects: ProjectConfig[];
}

export interface GitStatus {
  projectName: string;
  branch: string;
  isClean: boolean;
  ahead: number;
  behind: number;
  modified: string[];
  untracked: string[];
}

export interface ProjectWithStatus extends ProjectConfig {
  status: GitStatus | null;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  projectCount: number;
}

export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface KnownWorkspacesResponse {
  workspaces: KnownWorkspace[];
  current: string;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
}

export interface Worktree {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommit?: string;
}

export interface GitOpResult {
  projectName: string;
  success: boolean;
  error?: string;
}

export const api = {
  workspace: {
    get: () => window.devhub.workspace.get(),
    switch: (path: string) => window.devhub.workspace.switch(path),
    known: () => window.devhub.workspace.known(),
    addKnown: (path: string) => window.devhub.workspace.addKnown(path),
    removeKnown: (path: string) => window.devhub.workspace.removeKnown(path),
  },
  globalConfig: {
    get: () => window.devhub.globalConfig.get(),
    updateDefaults: (defaults: { workspace?: string }) =>
      window.devhub.globalConfig.updateDefaults(defaults),
  },
  projects: {
    list: () => window.devhub.projects.list(),
    get: (name: string) => window.devhub.projects.get(name),
    status: (name: string) => window.devhub.projects.status(name),
  },
  git: {
    fetch: (projects?: string[]) => window.devhub.git.fetch(projects),
    pull: (projects?: string[]) => window.devhub.git.pull(projects),
    push: (project: string) => window.devhub.git.push(project),
    worktrees: (project: string) => window.devhub.git.worktrees(project),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => window.devhub.git.addWorktree(project, options),
    removeWorktree: (project: string, path: string) =>
      window.devhub.git.removeWorktree(project, path),
    branches: (project: string) => window.devhub.git.branches(project),
    updateBranch: (project: string, branch?: string) =>
      window.devhub.git.updateBranch(project, branch),
  },
  config: {
    get: () => window.devhub.config.get(),
    update: (config: DevHubConfig) => window.devhub.config.update(config),
    updateProject: (name: string, data: Partial<ProjectConfig>) =>
      window.devhub.config.updateProject(name, data),
  },
};

// Typed API client using plain fetch — server routes don't use Hono validators
// so Hono RPC client is not applicable here.

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

export interface BuildResult {
  success: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface ProcessInfo {
  projectName: string;
  command: string;
  pid?: number;
  status: "running" | "stopped" | "error";
  startedAt?: string;
}

export interface GitOpResult {
  projectName: string;
  success: boolean;
  error?: string;
}

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function del(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error: string }).error ?? res.statusText);
  }
}

// W3: encode project names so names with slashes/spaces don't break URL paths
const enc = encodeURIComponent;

export const api = {
  workspace: {
    get: () => get<WorkspaceInfo>("/workspace"),
  },
  projects: {
    list: () => get<ProjectWithStatus[]>("/projects"),
    get: (name: string) => get<ProjectWithStatus>(`/projects/${enc(name)}`),
    status: (name: string) =>
      get<GitStatus | null>(`/projects/${enc(name)}/status`),
  },
  git: {
    fetch: (projects?: string[]) =>
      post<GitOpResult[]>("/git/fetch", { projects }),
    pull: (projects?: string[]) =>
      post<GitOpResult[]>("/git/pull", { projects }),
    push: (project: string) => post<GitOpResult>(`/git/push/${enc(project)}`),
    worktrees: (project: string) =>
      get<Worktree[]>(`/git/worktrees/${enc(project)}`),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => post<Worktree>(`/git/worktrees/${enc(project)}`, options),
    removeWorktree: (project: string, path: string) =>
      del(`/git/worktrees/${enc(project)}`, { path }),
    branches: (project: string) =>
      get<Branch[]>(`/git/branches/${enc(project)}`),
    updateBranch: (project: string, branch?: string) =>
      post<GitOpResult[]>(`/git/branches/${enc(project)}/update`, { branch }),
  },
  config: {
    get: () => get<DevHubConfig>("/config"),
    update: (config: DevHubConfig) => put<DevHubConfig>("/config", config),
    updateProject: (name: string, data: Partial<ProjectConfig>) =>
      patch<ProjectConfig>(`/config/projects/${enc(name)}`, data),
  },
  build: {
    start: (project: string) => post<BuildResult>(`/build/${enc(project)}`),
  },
  processes: {
    list: () => get<ProcessInfo[]>("/processes"),
    start: (project: string) => post<ProcessInfo>(`/run/${enc(project)}`),
    stop: (project: string) => del(`/run/${enc(project)}`),
    restart: (project: string) =>
      post<ProcessInfo>(`/run/${enc(project)}/restart`),
    logs: (project: string, lines = 100) =>
      get<string[]>(`/run/${enc(project)}/logs?lines=${lines}`),
  },
};

import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export interface TerminalLaunchProject {
  name: string;
  path: string;
}

export interface TerminalLaunchContext {
  projectName?: string;
  projectPath?: string;
}

export interface TerminalLaunchRequest {
  cwd?: string;
  displayCwd?: string;
  worktreePath?: string;
}

function normalizeLaunchPath(path: string): string {
  return normalizeProjectTargetPath(path);
}

function comparableLaunchPath(path: string): string {
  const normalized = normalizeLaunchPath(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function isAbsoluteLaunchPath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

function isPathWithin(path: string, root: string): boolean {
  const comparablePath = comparableLaunchPath(path);
  const comparableRoot = comparableLaunchPath(root);
  return (
    comparablePath === comparableRoot ||
    comparablePath.startsWith(`${comparableRoot}/`)
  );
}

function projectRelativeCwd(
  projectPath: string | undefined,
  requestedCwd: string | undefined,
): string | undefined {
  if (!requestedCwd || !projectPath || !isAbsoluteLaunchPath(requestedCwd)) {
    return requestedCwd;
  }
  if (!isPathWithin(requestedCwd, projectPath)) return requestedCwd;

  const normalizedCwd = normalizeLaunchPath(requestedCwd);
  const normalizedProject = normalizeLaunchPath(projectPath);
  if (
    comparableLaunchPath(normalizedCwd) ===
    comparableLaunchPath(normalizedProject)
  ) {
    return undefined;
  }
  return normalizedCwd.slice(normalizedProject.length + 1);
}

/** Convert a mounted terminal cwd back to the project/profile representation. */
export function getProjectRelativeTerminalCwd(
  projectPath: string | undefined,
  targetPath: string | undefined,
  requestedCwd: string | undefined,
): string | undefined {
  return projectRelativeCwd(targetPath ?? projectPath, requestedCwd);
}

/**
 * Returns a profile-safe cwd when saving a terminal under a project. A
 * root-scoped terminal from another project may carry its source project's
 * absolute cwd; that path must not be persisted into the destination profile.
 */
export function getSafeProjectProfileCwd({
  destinationProjectName,
  sourceProjectName,
  projectPath,
  targetPath,
  requestedCwd,
}: {
  destinationProjectName: string;
  sourceProjectName?: string;
  projectPath?: string;
  targetPath?: string;
  requestedCwd?: string;
}): string | undefined {
  const relativeCwd = getProjectRelativeTerminalCwd(
    projectPath,
    targetPath,
    requestedCwd,
  );
  if (
    !targetPath &&
    sourceProjectName !== destinationProjectName &&
    relativeCwd &&
    isAbsoluteLaunchPath(relativeCwd)
  ) {
    return ".";
  }
  return relativeCwd;
}

function displayCwd(worktreePath: string, cwd: string | undefined): string {
  if (!cwd) return worktreePath;
  if (isAbsoluteLaunchPath(cwd)) return cwd;
  return `${worktreePath.replace(/[\\/]+$/, "")}/${cwd.replace(/^[\\/]+/, "")}`;
}

/** Project configured-root-relative terminal directories into the selected worktree. */
export function getTerminalLaunchRequest(
  projectPath: string | undefined,
  worktreePath: string | undefined,
  requestedCwd?: string,
): TerminalLaunchRequest {
  const trimmedCwd = requestedCwd?.trim() || undefined;
  if (!worktreePath) {
    const cwd = trimmedCwd ?? projectPath;
    return { cwd, displayCwd: cwd };
  }

  const cwd = projectRelativeCwd(projectPath, trimmedCwd);
  return {
    cwd,
    displayCwd: displayCwd(worktreePath, cwd),
    worktreePath,
  };
}

export function getTerminalLaunchContext(
  projects: readonly TerminalLaunchProject[],
  projectName?: string,
): TerminalLaunchContext {
  const project = projectName
    ? projects.find((candidate) => candidate.name === projectName)
    : undefined;

  return {
    projectName: project?.name,
    projectPath: project?.path,
  };
}

import type { ProjectTargetRef } from "@/api/client.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export interface WorkflowTerminalCandidate {
  sessionId: string;
  project: string | null;
  worktreePath: string | null;
  alive: boolean;
  incarnation?: number;
  targetUnavailable: boolean;
}

export interface TerminalSessionSummaryInput {
  sessionId?: string;
  project?: string | null;
  worktreePath?: string | null;
  target?: ProjectTargetRef | null;
  alive?: boolean;
  incarnation?: number;
}

function isPathUnavailable(path: string | null, list?: readonly string[]): boolean {
  if (!path || !list || list.length === 0) return false;
  const normalized = normalizeProjectTargetPath(path);
  return list.some((p) => normalizeProjectTargetPath(p) === normalized);
}

/**
 * Derives terminal link candidates from authoritative sessionMap and mountedSessions.
 * Excludes command, cwd, and output.
 */
export function deriveWorkflowTerminalCandidates(
  sessionMap?: ReadonlyMap<string, TerminalSessionSummaryInput> | null,
  mountedSessions?: ReadonlyArray<TerminalSessionSummaryInput> | null,
  unavailableTargetsByProject?: Record<string, string[]> | null,
): WorkflowTerminalCandidate[] {
  const result = new Map<string, WorkflowTerminalCandidate>();

  if (mountedSessions) {
    for (const session of mountedSessions) {
      if (!session?.sessionId) continue;
      const project = session.project ?? session.target?.project ?? null;
      const worktreePath = session.worktreePath ?? session.target?.worktreePath ?? null;
      const unavailList = project && unavailableTargetsByProject ? unavailableTargetsByProject[project] : undefined;
      result.set(session.sessionId, {
        sessionId: session.sessionId,
        project,
        worktreePath,
        alive: session.alive ?? true,
        incarnation: session.incarnation,
        targetUnavailable: isPathUnavailable(worktreePath, unavailList),
      });
    }
  }

  if (sessionMap) {
    for (const [sessionId, session] of sessionMap.entries()) {
      if (!sessionId || !session) continue;
      const project = session.project ?? session.target?.project ?? null;
      const worktreePath = session.worktreePath ?? session.target?.worktreePath ?? null;
      const unavailList = project && unavailableTargetsByProject ? unavailableTargetsByProject[project] : undefined;
      const targetUnavailable = isPathUnavailable(worktreePath, unavailList);
      const existing = result.get(sessionId);
      result.set(sessionId, {
        sessionId,
        project: project ?? existing?.project ?? null,
        worktreePath: worktreePath ?? existing?.worktreePath ?? null,
        alive: session.alive ?? existing?.alive ?? false,
        incarnation: session.incarnation ?? existing?.incarnation,
        targetUnavailable: targetUnavailable || Boolean(existing?.targetUnavailable),
      });
    }
  }

  return Array.from(result.values());
}

export interface ResolveWorkflowTerminalRevealArgs {
  sessionId: string;
  activeProfileId?: string | null;
  currentProfileId?: string | null;
  sessionMap?: ReadonlyMap<string, { alive?: boolean }> | null;
  mountedSessions?: ReadonlyArray<{ sessionId: string }> | null;
  isCompactWorkspace?: boolean;
}

export interface WorkflowTerminalRevealOutcome {
  canReveal: boolean;
  sessionId?: string;
  requestedCompactSurface?: "terminal";
  reason?: "missing_session_id" | "profile_mismatch" | "session_not_found";
}

/**
 * Pure decision helper for revealing a linked terminal.
 */
export function resolveWorkflowTerminalReveal({
  sessionId,
  activeProfileId,
  currentProfileId,
  sessionMap,
  mountedSessions,
  isCompactWorkspace = false,
}: ResolveWorkflowTerminalRevealArgs): WorkflowTerminalRevealOutcome {
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
    return { canReveal: false, reason: "missing_session_id" };
  }
  const trimmedId = sessionId.trim();
  if (activeProfileId && currentProfileId && activeProfileId !== currentProfileId) {
    return { canReveal: false, reason: "profile_mismatch" };
  }
  const inSessionMap = Boolean(sessionMap?.has(trimmedId));
  const inMountedSessions = Boolean(mountedSessions?.some((s) => s.sessionId === trimmedId));
  if (!inSessionMap && !inMountedSessions) {
    return { canReveal: false, reason: "session_not_found" };
  }
  return {
    canReveal: true,
    sessionId: trimmedId,
    requestedCompactSurface: isCompactWorkspace ? "terminal" : undefined,
  };
}

export interface ResolveWorkflowTargetSelectionArgs {
  target: ProjectTargetRef | null | undefined;
  projects: ReadonlyArray<{ name: string }>;
  unavailableTargetsByProject?: Record<string, string[]>;
}

export interface WorkflowTargetSelectionOutcome {
  canSelect: boolean;
  project?: string;
  worktreePath?: string | null;
  reason?: "missing_target" | "project_not_configured" | "target_unavailable";
  errorMessage?: string;
}

/**
 * Pure decision helper for selecting a workflow target.
 */
export function resolveWorkflowTargetSelection({
  target,
  projects,
  unavailableTargetsByProject,
}: ResolveWorkflowTargetSelectionArgs): WorkflowTargetSelectionOutcome {
  if (!target?.project || target.project.trim() === "") {
    return { canSelect: false, reason: "missing_target", errorMessage: "No target project specified." };
  }
  const projectName = target.project.trim();
  if (!projects.some((p) => p.name === projectName)) {
    return {
      canSelect: false,
      reason: "project_not_configured",
      errorMessage: `Project "${projectName}" is not configured in this workspace.`,
    };
  }
  if (target.worktreePath) {
    const rawPath = target.worktreePath.trim();
    if (isPathUnavailable(rawPath, unavailableTargetsByProject?.[projectName])) {
      return {
        canSelect: false,
        project: projectName,
        worktreePath: rawPath,
        reason: "target_unavailable",
        errorMessage: `Worktree "${rawPath}" is currently unavailable.`,
      };
    }
    return { canSelect: true, project: projectName, worktreePath: rawPath };
  }
  return { canSelect: true, project: projectName, worktreePath: null };
}

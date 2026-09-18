import { useMemo } from "react";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { useAggregatedTerminalSessions } from "@/hooks/use-aggregated-terminal-sessions.js";
import { projectKey, terminalKey, parseTerminalKey, type ProjectRef } from "@/api/ownership.js";
import { sanitizeSessionSegment } from "@/lib/utils.js";
import {
  targetScopedCommandSessionId,
  terminalProfileSessionPrefix,
} from "@/lib/terminal-target-identity.js";
import type {
  ProjectTargetInput,
  ProjectType,
  SessionInfo,
} from "@/api/client.js";
import { normalizeProjectTarget } from "@/api/client.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export const FREE_TERMINAL_PREFIX = "free:" as const;

export function isRecoverableTerminalSession(
  session: Pick<SessionInfo, "id" | "targetUnavailable">,
): boolean {
  return (
    session.targetUnavailable === true ||
    (parseTerminalKey(session.id)?.id ?? session.id).startsWith(FREE_TERMINAL_PREFIX)
  );
}

export interface TreeCommand {
  key: string;
  /** Human-readable display name (falls back to key if absent) */
  label?: string;
  type: "build" | "run" | "custom" | "terminal";
  command: string;
  cwd?: string;
  sessionId: string;
  session?: SessionInfo;
  /** Multiple running instances (terminal profiles only) */
  sessions?: SessionInfo[];
  /** Saved profile name (terminal profiles only) */
  profileName?: string;
}

export interface TreeProject {
  ref: ProjectRef;
  key: string;
  profileName: string;
  name: string;
  type: ProjectType;
  path: string;
  branch?: string;
  isDirty?: boolean;
  commands: TreeCommand[];
  activeCount: number;
}

function comparablePath(path: string): string {
  return normalizeProjectTargetPath(path);
}

/** Return true for a target path or any directory below it. */
export function isPathWithinTarget(path: string, targetPath: string): boolean {
  const child = comparablePath(path);
  const root = comparablePath(targetPath);
  if (!child || !root) return false;
  if (root === "/") return child.startsWith("/");
  return child === root || child.startsWith(`${root}/`);
}

export function sessionBelongsToProjectTarget(
  session: Pick<SessionInfo, "project" | "cwd" | "alive" | "worktreePath">,
  target: ProjectTargetInput,
  configuredRoot: string,
): boolean {
  const normalized = normalizeProjectTarget(target);
  return (
    session.alive === true &&
    session.project === normalized.project &&
    (normalized.worktreePath != null
      ? (session.worktreePath != null &&
          normalizeProjectTargetPath(session.worktreePath) ===
            normalizeProjectTargetPath(normalized.worktreePath)) ||
        (session.worktreePath == null &&
          isPathWithinTarget(session.cwd, normalized.worktreePath))
      : isPathWithinTarget(session.cwd, configuredRoot))
  );
}

/** Match persisted sessions to a target without requiring the session to be live. */
export function sessionMatchesProjectTarget(
  session: Pick<SessionInfo, "project" | "cwd" | "worktreePath">,
  target: ProjectTargetInput,
  configuredRoot: string,
): boolean {
  const normalized = normalizeProjectTarget(target);
  if (session.project !== normalized.project) return false;
  if (normalized.worktreePath != null) {
    return (
      (session.worktreePath != null &&
        normalizeProjectTargetPath(session.worktreePath) ===
          normalizeProjectTargetPath(normalized.worktreePath)) ||
      (session.worktreePath == null &&
        isPathWithinTarget(session.cwd, normalized.worktreePath))
    );
  }
  return (
    session.worktreePath == null &&
    isPathWithinTarget(session.cwd, configuredRoot)
  );
}

export function countLiveTerminalSessionsForTarget(
  sessions: ReadonlyArray<
    Pick<SessionInfo, "project" | "cwd" | "alive" | "worktreePath">
  >,
  target: ProjectTargetInput,
  configuredRoot: string,
): number {
  return sessions.filter((session) =>
    sessionBelongsToProjectTarget(session, target, configuredRoot),
  ).length;
}

export function markOrphanedSessions(
  sessions: SessionInfo[],
  unavailableTargets: Record<string, string[]>,
): SessionInfo[] {
  return sessions.map((session) => {
    const targetPaths =
      session.project == null
        ? []
        : (unavailableTargets[session.project] ?? []);
    const orphaned =
      session.targetUnavailable === true ||
      (session.alive === true &&
        (session.worktreePath != null
          ? targetPaths.some(
              (targetPath) =>
                normalizeProjectTargetPath(targetPath) ===
                normalizeProjectTargetPath(session.worktreePath!),
            )
          : targetPaths.some((targetPath) =>
              isPathWithinTarget(session.cwd, targetPath),
            )));
    return orphaned ? { ...session, orphaned: true } : session;
  });
}

export function useTerminalTree() {
  const { allProjects, isLoading: projectsLoading } = useAggregatedProjects();
  const { sessions: remoteSessions, isLoading: sessionsLoading, isSuccess: hasSnapshot } = useAggregatedTerminalSessions();
  const projects = useMemo(() => allProjects.map((item) => ({ ...item.project, profileId: item.profileId, profileName: item.profileName, ref: item.ref })), [allProjects]);
  const sessions = useMemo(() => remoteSessions.map((session) => ({
    ...session,
    id: terminalKey({ profileId: session.profileId, id: session.id }),
  })), [remoteSessions]);
  const unavailableTargets = useProjectTargetStore(
    (state) => state.unavailableTargetsByProject,
  );
  const activeTargetByProject = useProjectTargetStore(
    (state) => state.activeTargetByProject,
  );

  const sessionsWithTargetState = useMemo(
    () => sessions.map((session) => markOrphanedSessions([session], {
      [session.project ?? ""]: unavailableTargets[projectKey({profileId: session.profileId, project: session.project ?? ""})] ?? [],
    })[0]),
    [sessions, unavailableTargets],
  );

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const s of sessionsWithTargetState) if (s.id) map.set(s.id, s);
    return map;
  }, [sessionsWithTargetState]);

  const freeTerminals = useMemo<SessionInfo[]>(() => {
    const list = sessionsWithTargetState.filter(isRecoverableTerminalSession);
    const order: string[] = [];

    if (order.length > 0) {
      return [...list].sort((a, b) => {
        const idxA = order.indexOf(a.id);
        const idxB = order.indexOf(b.id);

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;

        return a.startedAt - b.startedAt;
      });
    }

    return list.sort((a, b) => a.startedAt - b.startedAt);
  }, [sessionsWithTargetState]);

  const tree = useMemo<TreeProject[]>(() => {
    const projectOrder: string[] = [];
    const commandOrderMap: Record<string, string[]> = {};

    const unsortedTree = projects.map((p) => {
      const commands: TreeCommand[] = [];
      const activeWorktreePath = activeTargetByProject[projectKey(p.ref)];
      const activeTarget = activeWorktreePath
        ? { ...p.ref, worktreePath: activeWorktreePath }
        : p.ref;

      // Build command
      const buildCmd = p.services?.[0]?.buildCommand;
      if (buildCmd) {
        const sessionId = targetScopedCommandSessionId(
          "build",
          p.name,
          activeWorktreePath,
        );
        commands.push({
          key: "build",
          label: "Build",
          type: "build",
          command: buildCmd,
          sessionId: terminalKey({ profileId: p.profileId, id: sessionId }),
          session: sessionMap.get(terminalKey({ profileId: p.profileId, id: sessionId })),
        });
      }

      // Run command
      const runCmd = p.services?.[0]?.runCommand;
      if (runCmd) {
        const sessionId = targetScopedCommandSessionId(
          "run",
          p.name,
          activeWorktreePath,
        );
        commands.push({
          key: "run",
          label: "Run",
          type: "run",
          command: runCmd,
          sessionId: terminalKey({ profileId: p.profileId, id: sessionId }),
          session: sessionMap.get(terminalKey({ profileId: p.profileId, id: sessionId })),
        });
      }

      // Custom commands from config
      for (const [key, cmd] of Object.entries(p.commands ?? {})) {
        const sessionId = targetScopedCommandSessionId(
          "custom",
          p.name,
          activeWorktreePath,
          key,
        );
        commands.push({
          key,
          type: "custom",
          command: cmd,
          sessionId: terminalKey({ profileId: p.profileId, id: sessionId }),
          session: sessionMap.get(terminalKey({ profileId: p.profileId, id: sessionId })),
        });
      }

      // Saved terminal profiles
      for (const terminal of p.terminals ?? []) {
        const sanitizedName = sanitizeSessionSegment(
          terminal.name.replace(/ /g, "_"),
        );
        const prefix = terminalProfileSessionPrefix(
          p.name,
          sanitizedName,
          activeWorktreePath,
        );
        const matchingSessions = sessionsWithTargetState.filter(
          (s) =>
            parseTerminalKey(s.id)?.profileId === p.profileId &&
            parseTerminalKey(s.id)!.id.startsWith(prefix) &&
            sessionMatchesProjectTarget(s, activeTarget, p.path),
        );
        commands.push({
          key: `terminal:${terminal.name}`,
          label: terminal.name,
          type: "terminal",
          command: terminal.command,
          cwd: terminal.cwd,
          sessionId: terminalKey({ profileId: p.profileId, id: prefix }),
          sessions: matchingSessions,
          profileName: terminal.name,
        });
      }

      // Sort commands within project
      const pCommandOrder = commandOrderMap[p.name] ?? [];
      if (pCommandOrder.length > 0) {
        commands.sort((a, b) => {
          const idxA = pCommandOrder.indexOf(a.key);
          const idxB = pCommandOrder.indexOf(b.key);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return 0; // maintain original relative order
        });
      }

      const activeCount = commands.filter(
        (c) => c.session?.alive || c.sessions?.some((s) => s.alive),
      ).length;

      return {
        name: p.name,
        ref: p.ref,
        key: projectKey(p.ref),
        profileName: p.profileName,
        type: p.type,
        path: p.path,
        branch: p.status?.branch,
        isDirty: p.status ? !p.status.isClean : undefined,
        commands,
        activeCount,
      };
    });

    // Sort projects
    if (projectOrder.length > 0) {
      unsortedTree.sort((a, b) => {
        const idxA = projectOrder.indexOf(a.name);
        const idxB = projectOrder.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    return unsortedTree;
  }, [
    activeTargetByProject,
    projects,
    sessionMap,
    sessionsWithTargetState,
  ]);

  return { tree, freeTerminals, projects, sessions: sessionsWithTargetState, hasSnapshot, isLoading: projectsLoading || sessionsLoading };
}

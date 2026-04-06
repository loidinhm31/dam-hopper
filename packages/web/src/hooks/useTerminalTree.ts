import { useMemo } from "react";
import { useProjects } from "@/api/queries.js";
import { useTerminalSessions } from "@/api/queries.js";
import type { ProjectType } from "@/api/client.js";
import type { SessionInfo } from "@/api/client.js";

export const FREE_TERMINAL_PREFIX = "free:" as const;

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
  name: string;
  type: ProjectType;
  path: string;
  branch?: string;
  isDirty?: boolean;
  commands: TreeCommand[];
  activeCount: number;
}

export function useTerminalTree() {
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: sessions = [], isLoading: sessionsLoading } =
    useTerminalSessions();

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  const freeTerminals = useMemo<SessionInfo[]>(() => {
    return sessions
      .filter((s) => s.id.startsWith(FREE_TERMINAL_PREFIX))
      .sort((a, b) => a.startedAt - b.startedAt);
  }, [sessions]);

  const tree = useMemo<TreeProject[]>(() => {
    return projects.map((p) => {
      const commands: TreeCommand[] = [];

      // Build command
      const buildCmd = p.services?.[0]?.buildCommand;
      if (buildCmd) {
        const sessionId = `build:${p.name}`;
        commands.push({
          key: "build",
          label: "Build",
          type: "build",
          command: buildCmd,
          sessionId,
          session: sessionMap.get(sessionId),
        });
      }

      // Run command
      const runCmd = p.services?.[0]?.runCommand;
      if (runCmd) {
        const sessionId = `run:${p.name}`;
        commands.push({
          key: "run",
          label: "Run",
          type: "run",
          command: runCmd,
          sessionId,
          session: sessionMap.get(sessionId),
        });
      }

      // Custom commands from config
      for (const [key, cmd] of Object.entries(p.commands ?? {})) {
        const sessionId = `custom:${p.name}:${key}`;
        commands.push({
          key,
          type: "custom",
          command: cmd,
          sessionId,
          session: sessionMap.get(sessionId),
        });
      }

      // Saved terminal profiles
      for (const terminal of p.terminals ?? []) {
        const sanitizedName = terminal.name.replace(/ /g, "_");
        const prefix = `terminal:${p.name}:${sanitizedName}:`;
        const matchingSessions = sessions.filter((s) => s.id.startsWith(prefix));
        commands.push({
          key: `terminal:${terminal.name}`,
          label: terminal.name,
          type: "terminal",
          command: terminal.command,
          cwd: terminal.cwd,
          sessionId: prefix,
          sessions: matchingSessions,
          profileName: terminal.name,
        });
      }

      const activeCount = commands.filter(
        (c) => c.session?.alive || c.sessions?.some((s) => s.alive),
      ).length;

      return {
        name: p.name,
        type: p.type,
        path: p.path,
        branch: p.status?.branch,
        isDirty: p.status ? !p.status.isClean : undefined,
        commands,
        activeCount,
      };
    });
  }, [projects, sessionMap, sessions]);

  return { tree, freeTerminals, isLoading: projectsLoading || sessionsLoading };
}

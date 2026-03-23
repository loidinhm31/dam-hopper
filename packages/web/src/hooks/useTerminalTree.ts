import { useMemo } from "react";
import { useProjects } from "@/api/queries.js";
import { useTerminalSessions } from "@/api/queries.js";
import type { ProjectType } from "@/api/client.js";
import type { SessionInfo } from "@/types/electron.js";

export interface TreeCommand {
  key: string;
  type: "build" | "run" | "custom" | "shell";
  command: string;
  sessionId: string;
  session?: SessionInfo;
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

/** Default build commands per project type (mirrors core presets). */
const BUILD_PRESET: Partial<Record<ProjectType, string>> = {
  maven: "mvn clean install -DskipTests",
  gradle: "./gradlew build",
  npm: "npm run build",
  pnpm: "pnpm build",
  cargo: "cargo build",
};

/** Default run commands per project type. */
const RUN_PRESET: Partial<Record<ProjectType, string>> = {
  maven: "mvn spring-boot:run",
  gradle: "./gradlew bootRun",
  npm: "npm start",
  pnpm: "pnpm start",
  cargo: "cargo run",
};

export function useTerminalTree() {
  const { data: projects = [], isLoading: projectsLoading } = useProjects();
  const { data: sessions = [], isLoading: sessionsLoading } =
    useTerminalSessions();

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const s of sessions) map.set(s.id, s);
    return map;
  }, [sessions]);

  const tree = useMemo<TreeProject[]>(() => {
    return projects.map((p) => {
      const commands: TreeCommand[] = [];

      // Build command
      const buildCmd =
        p.services?.[0]?.buildCommand ?? BUILD_PRESET[p.type];
      if (buildCmd) {
        const sessionId = `build:${p.name}`;
        commands.push({
          key: "build",
          type: "build",
          command: buildCmd,
          sessionId,
          session: sessionMap.get(sessionId),
        });
      }

      // Run command
      const runCmd = p.services?.[0]?.runCommand ?? RUN_PRESET[p.type];
      if (runCmd) {
        const sessionId = `run:${p.name}`;
        commands.push({
          key: "run",
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

      // Shell sessions for this project (from live sessions)
      for (const s of sessions) {
        if (s.type === "shell" && s.project === p.name) {
          // Only add if not already in commands (from config)
          const alreadyInCommands = commands.some(
            (c) => c.sessionId === s.id,
          );
          if (!alreadyInCommands) {
            commands.push({
              key: s.id,
              type: "shell",
              command: s.command,
              sessionId: s.id,
              session: s,
            });
          }
        }
      }

      const activeCount = commands.filter((c) => c.session?.alive).length;

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

  return { tree, isLoading: projectsLoading || sessionsLoading };
}

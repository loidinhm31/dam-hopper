import EventEmitter from "eventemitter3";
import type { ProjectConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import type { BuildProgressEvent } from "./types.js";

export class CommandService {
  readonly emitter = new EventEmitter<{ progress: [BuildProgressEvent] }>();

  /**
   * Resolve command context (command string, env, cwd) for a named custom command.
   * Execution is delegated to the caller (e.g., Electron PTY session manager).
   */
  async getCommandContext(
    project: ProjectConfig,
    commandName: string,
    workspaceRoot: string,
  ): Promise<{ command: string; cwd: string; env: Record<string, string> } | null> {
    const command = project.commands?.[commandName];
    if (!command) return null;
    const env = await resolveEnv(project, workspaceRoot);
    return { command, cwd: project.path, env };
  }

  /** Look up a command string by name. */
  resolve(project: ProjectConfig, commandName: string): string | undefined {
    return project.commands?.[commandName];
  }
}

import { execa, ExecaError } from "execa";
import EventEmitter from "eventemitter3";
import type { ProjectConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import { pipeLines } from "./stream-utils.js";
import type { BuildResult, BuildProgressEvent } from "./types.js";

export class CommandService {
  readonly emitter = new EventEmitter<{ progress: [BuildProgressEvent] }>();

  /**
   * Execute a named custom command from project.commands.
   * Emits BuildProgressEvent with phase started/output/completed/failed.
   *
   * Note: `serviceName` in emitted events carries the command name as context.
   * A dedicated CommandResult type may be introduced in a future phase if needed.
   */
  async execute(
    project: ProjectConfig,
    commandName: string,
    workspaceRoot: string,
  ): Promise<BuildResult> {
    const command = project.commands?.[commandName];
    const start = performance.now();

    if (!command) {
      const result: BuildResult = {
        projectName: project.name,
        serviceName: commandName,
        command: "",
        success: false,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: `No command "${commandName}" configured for "${project.name}"`,
      };
      this.emitter.emit("progress", {
        projectName: project.name,
        serviceName: commandName,
        phase: "failed",
        result,
      });
      return result;
    }

    const env = await resolveEnv(project, workspaceRoot);

    this.emitter.emit("progress", {
      projectName: project.name,
      serviceName: commandName,
      phase: "started",
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    try {
      // SECURITY: shell:true required for complex commands. Commands come from user's dev-hub.toml.
      const subprocess = execa(command, {
        shell: true,
        cwd: project.path,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      pipeLines(subprocess.stdout, (line) => {
        stdoutLines.push(line);
        this.emitter.emit("progress", {
          projectName: project.name,
          serviceName: commandName,
          phase: "output",
          stream: "stdout",
          line,
        });
      });

      pipeLines(subprocess.stderr, (line) => {
        stderrLines.push(line);
        this.emitter.emit("progress", {
          projectName: project.name,
          serviceName: commandName,
          phase: "output",
          stream: "stderr",
          line,
        });
      });

      await subprocess;

      const durationMs = performance.now() - start;
      const result: BuildResult = {
        projectName: project.name,
        serviceName: commandName,
        command,
        success: true,
        exitCode: 0,
        durationMs,
        stdout: stdoutLines.slice(-100).join("\n"),
        stderr: stderrLines.slice(-100).join("\n"),
      };
      this.emitter.emit("progress", {
        projectName: project.name,
        serviceName: commandName,
        phase: "completed",
        result,
      });
      return result;
    } catch (err: unknown) {
      const durationMs = performance.now() - start;
      const exitCode =
        err instanceof ExecaError ? (err.exitCode ?? null) : null;
      const message = err instanceof Error ? err.message : String(err);
      const result: BuildResult = {
        projectName: project.name,
        serviceName: commandName,
        command,
        success: false,
        exitCode,
        durationMs,
        stdout: stdoutLines.slice(-100).join("\n"),
        stderr: stderrLines.slice(-100).join("\n"),
        error: message,
      };
      this.emitter.emit("progress", {
        projectName: project.name,
        serviceName: commandName,
        phase: "failed",
        result,
      });
      return result;
    }
  }
}

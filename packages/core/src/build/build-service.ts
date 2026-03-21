import { execa, ExecaError } from "execa";
import EventEmitter from "eventemitter3";
import pLimit from "p-limit";
import { getEffectiveCommand } from "../config/index.js";
import type { ProjectConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import type { BuildResult, BuildProgressEvent } from "./types.js";

export class BuildService {
  readonly emitter = new EventEmitter<{ progress: [BuildProgressEvent] }>();

  async build(project: ProjectConfig, workspaceRoot: string): Promise<BuildResult> {
    const command = getEffectiveCommand(project, "build");
    const start = performance.now();

    if (!command) {
      const result: BuildResult = {
        projectName: project.name,
        command: "",
        success: false,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "",
        error: "No build command configured",
      };
      this.emitter.emit("progress", {
        projectName: project.name,
        phase: "failed",
        result,
      });
      return result;
    }

    const env = await resolveEnv(project, workspaceRoot);

    this.emitter.emit("progress", { projectName: project.name, phase: "started" });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    try {
      // SECURITY: shell:true is required for preset commands (pipes, env expansions).
      // Commands come from the user's own dev-hub.toml — treated as trusted input.
      const subprocess = execa(command, {
        shell: true,
        cwd: project.path,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Stream stdout line by line
      if (subprocess.stdout) {
        let stdoutPartial = "";
        subprocess.stdout.on("data", (chunk: Buffer) => {
          stdoutPartial += chunk.toString();
          const lines = stdoutPartial.split("\n");
          stdoutPartial = lines.pop() ?? "";
          for (const line of lines) {
            stdoutLines.push(line);
            this.emitter.emit("progress", {
              projectName: project.name,
              phase: "output",
              stream: "stdout",
              line,
            });
          }
        });
      }

      // Stream stderr line by line
      if (subprocess.stderr) {
        let stderrPartial = "";
        subprocess.stderr.on("data", (chunk: Buffer) => {
          stderrPartial += chunk.toString();
          const lines = stderrPartial.split("\n");
          stderrPartial = lines.pop() ?? "";
          for (const line of lines) {
            stderrLines.push(line);
            this.emitter.emit("progress", {
              projectName: project.name,
              phase: "output",
              stream: "stderr",
              line,
            });
          }
        });
      }

      await subprocess;

      const durationMs = performance.now() - start;
      const result: BuildResult = {
        projectName: project.name,
        command,
        success: true,
        exitCode: 0,
        durationMs,
        stdout: stdoutLines.slice(-100).join("\n"),
        stderr: stderrLines.slice(-100).join("\n"),
      };
      this.emitter.emit("progress", { projectName: project.name, phase: "completed", result });
      return result;
    } catch (err: unknown) {
      const durationMs = performance.now() - start;
      const exitCode = err instanceof ExecaError ? err.exitCode ?? null : null;
      const message = err instanceof Error ? err.message : String(err);
      const result: BuildResult = {
        projectName: project.name,
        command,
        success: false,
        exitCode,
        durationMs,
        stdout: stdoutLines.slice(-100).join("\n"),
        stderr: stderrLines.slice(-100).join("\n"),
        error: message,
      };
      this.emitter.emit("progress", { projectName: project.name, phase: "failed", result });
      return result;
    }
  }

  async buildMultiple(
    projects: ProjectConfig[],
    workspaceRoot: string,
    concurrency = 4,
  ): Promise<BuildResult[]> {
    const limit = pLimit(concurrency);
    return Promise.all(projects.map((p) => limit(() => this.build(p, workspaceRoot))));
  }
}

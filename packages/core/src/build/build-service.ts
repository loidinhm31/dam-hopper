import EventEmitter from "eventemitter3";
import pLimit from "p-limit";
import { getProjectServices } from "../config/index.js";
import type { ProjectConfig, ServiceConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import type { BuildResult, BuildProgressEvent } from "./types.js";

export class BuildService {
  readonly emitter = new EventEmitter<{ progress: [BuildProgressEvent] }>();

  /**
   * Resolve build context (env, command) for a service.
   * Execution is delegated to the caller (e.g., Electron PTY session manager).
   */
  async getServiceContext(
    project: ProjectConfig,
    service: ServiceConfig,
    workspaceRoot: string,
  ): Promise<{ command: string; cwd: string; env: Record<string, string> }> {
    const env = await resolveEnv(project, workspaceRoot);
    return { command: service.buildCommand ?? "", cwd: project.path, env };
  }

  getServices(project: ProjectConfig): ServiceConfig[] {
    return getProjectServices(project);
  }

  emitNoCommand(project: ProjectConfig, service: ServiceConfig): BuildResult {
    const result: BuildResult = {
      projectName: project.name,
      serviceName: service.name,
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
      serviceName: service.name,
      phase: "failed",
      result,
    });
    return result;
  }

  async buildMultiple(
    projects: ProjectConfig[],
    workspaceRoot: string,
    concurrency = 4,
  ): Promise<Array<{ project: ProjectConfig; services: ServiceConfig[] }>> {
    const limit = pLimit(concurrency);
    return Promise.all(
      projects.map((p) =>
        limit(() =>
          Promise.resolve({
            project: p,
            services: getProjectServices(p),
          }),
        ),
      ),
    );
  }
}

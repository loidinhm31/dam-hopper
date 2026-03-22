import EventEmitter from "eventemitter3";
import { getProjectServices } from "../config/index.js";
import type { ProjectConfig, ServiceConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import type { RunProgressEvent } from "./types.js";

export class RunService {
  readonly emitter = new EventEmitter<{ progress: [RunProgressEvent] }>();

  /**
   * Resolve run context (command, env, cwd) for a service.
   * Execution is delegated to the caller (e.g., Electron PTY session manager).
   */
  async getServiceContext(
    project: ProjectConfig,
    service: ServiceConfig,
    workspaceRoot: string,
  ): Promise<{ command: string; cwd: string; env: Record<string, string> }> {
    const env = await resolveEnv(project, workspaceRoot);
    return { command: service.runCommand ?? "", cwd: project.path, env };
  }

  getServices(project: ProjectConfig): ServiceConfig[] {
    return getProjectServices(project);
  }

  getFirstService(project: ProjectConfig, serviceName?: string): ServiceConfig | undefined {
    const services = getProjectServices(project);
    if (serviceName) return services.find((s) => s.name === serviceName);
    return services[0];
  }
}

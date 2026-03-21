import { execa } from "execa";
import EventEmitter from "eventemitter3";
import { getProjectServices } from "../config/index.js";
import type { ProjectConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import { LogBuffer } from "./log-buffer.js";
import { pipeLines } from "./stream-utils.js";
import type {
  RunningProcess,
  ProcessLogEntry,
  RunProgressEvent,
} from "./types.js";

interface ManagedProcess {
  info: RunningProcess;
  kill: (signal: NodeJS.Signals) => void;
  done: Promise<void>;
  logs: LogBuffer;
  project: ProjectConfig;
  workspaceRoot: string;
  /** True when stop() has been called, so process exit is not treated as a crash. */
  intentionallyStopped: boolean;
}

const SIGTERM_TIMEOUT_MS = 5000;

export class RunService {
  private readonly processes = new Map<string, ManagedProcess>();
  readonly emitter = new EventEmitter<{ progress: [RunProgressEvent] }>();

  // --- Key helpers ---
  // O(n) scans are acceptable: a workspace has a small, bounded number of services
  // (typically 1-5 per project, <<50 total). A secondary index would add complexity
  // for no practical gain.

  private processKey(projectName: string, serviceName: string): string {
    return `${projectName}:${serviceName}`;
  }

  private firstKeyForProject(projectName: string): string | undefined {
    const prefix = `${projectName}:`;
    for (const key of this.processes.keys()) {
      if (key.startsWith(prefix)) return key;
    }
    return undefined;
  }

  private allKeysForProject(projectName: string): string[] {
    const prefix = `${projectName}:`;
    return Array.from(this.processes.keys()).filter((k) =>
      k.startsWith(prefix),
    );
  }

  // --- Core process spawn ---

  private async _startService(
    project: ProjectConfig,
    serviceName: string,
    workspaceRoot: string,
  ): Promise<RunningProcess> {
    const services = getProjectServices(project);
    const service = services.find((s) => s.name === serviceName);

    // Guard against internal misuse (public callers validate serviceName before calling this).
    if (!service) {
      throw new Error(
        `Service "${serviceName}" not found for project "${project.name}"`,
      );
    }

    const command = service.runCommand;
    if (!command) {
      throw new Error(`No run command configured for "${project.name}"`);
    }

    const key = this.processKey(project.name, serviceName);
    const existing = this.processes.get(key);
    if (existing && existing.info.status === "running") {
      throw new Error(
        `Process for "${project.name}" is already running. Stop it first.`,
      );
    }

    const env = await resolveEnv(project, workspaceRoot);

    // SECURITY: shell:true is required for complex commands (pipes, env expansions in presets).
    // Commands originate from the user's own dev-hub.toml — treat as trusted input.
    // Do not pass untrusted/user-supplied strings directly to this method.
    const subprocess = execa(command, {
      shell: true,
      cwd: project.path,
      env,
      stdout: "pipe",
      stderr: "pipe",
      detached: false,
    });

    const pid = subprocess.pid;
    if (!pid) {
      throw new Error(
        `Failed to spawn process for "${project.name}" — no PID assigned`,
      );
    }

    const prevRestartCount = this.processes.get(key)?.info.restartCount ?? 0;

    // serviceName is always set here; the RunningProcess.serviceName field is optional
    // only to remain compatible with external code that constructs RunningProcess objects.
    const info: RunningProcess = {
      projectName: project.name,
      serviceName,
      command,
      pid,
      startedAt: new Date(),
      status: "running",
      restartCount: prevRestartCount,
    };

    const logs = new LogBuffer();

    pipeLines(subprocess.stdout, (line) => {
      const entry: ProcessLogEntry = {
        timestamp: new Date(),
        stream: "stdout",
        line,
      };
      logs.push(entry);
      this.emitter.emit("progress", {
        projectName: project.name,
        serviceName,
        phase: "output",
        stream: "stdout",
        line,
        process: { ...info },
      });
    });

    pipeLines(subprocess.stderr, (line) => {
      const entry: ProcessLogEntry = {
        timestamp: new Date(),
        stream: "stderr",
        line,
      };
      logs.push(entry);
      this.emitter.emit("progress", {
        projectName: project.name,
        serviceName,
        phase: "output",
        stream: "stderr",
        line,
        process: { ...info },
      });
    });

    const done = subprocess.then(
      () => {
        info.status = "stopped";
        info.exitCode = 0;
        this.emitter.emit("progress", {
          projectName: project.name,
          serviceName,
          phase: "stopped",
          process: { ...info },
        });
      },
      (err: { exitCode?: number }) => {
        const managed = this.processes.get(key);
        const intentional = managed?.intentionallyStopped ?? false;
        // exitCode is non-zero when the error branch fires; `!== 0` is sufficient.
        const crashed = !intentional && err.exitCode !== 0;
        info.status = crashed ? "crashed" : "stopped";
        info.exitCode = err.exitCode ?? undefined;
        this.emitter.emit("progress", {
          projectName: project.name,
          serviceName,
          phase: crashed ? "crashed" : "stopped",
          process: { ...info },
        });
      },
    );

    const managed: ManagedProcess = {
      info,
      kill: (signal) => subprocess.kill(signal),
      done,
      logs,
      project,
      workspaceRoot,
      intentionallyStopped: false,
    };

    this.processes.set(key, managed);

    this.emitter.emit("progress", {
      projectName: project.name,
      serviceName,
      phase: "started",
      process: { ...info },
    });

    return { ...info };
  }

  private async _stopByKey(key: string): Promise<void> {
    const managed = this.processes.get(key);
    if (!managed) return;

    managed.intentionallyStopped = true;
    managed.kill("SIGTERM");

    const exited = await Promise.race([
      managed.done.then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), SIGTERM_TIMEOUT_MS),
      ),
    ]);

    if (!exited) {
      managed.kill("SIGKILL");
      try {
        await managed.done;
      } catch {
        // Expected: process killed with SIGKILL; the done-promise rejection is intentional.
      }
    }

    managed.info.status = "stopped";
    this.processes.delete(key);
  }

  // --- Public API ---

  /**
   * Start a specific service (or the first service if no serviceName given).
   * Throws if the named service is not found — no silent fallback.
   */
  async start(
    project: ProjectConfig,
    workspaceRoot: string,
    serviceName?: string,
  ): Promise<RunningProcess> {
    const services = getProjectServices(project);
    if (serviceName) {
      const service = services.find((s) => s.name === serviceName);
      if (!service) {
        throw new Error(
          `Service "${serviceName}" not found for project "${project.name}"`,
        );
      }
      return this._startService(project, service.name, workspaceRoot);
    }
    const first = services[0];
    if (!first) {
      throw new Error(`No run command configured for "${project.name}"`);
    }
    return this._startService(project, first.name, workspaceRoot);
  }

  /**
   * Start all services for a project concurrently.
   * Services within a project are independent processes — parallel start is intentional.
   */
  async startAll(
    project: ProjectConfig,
    workspaceRoot: string,
  ): Promise<RunningProcess[]> {
    const services = getProjectServices(project);
    return Promise.all(
      services.map((s) => this._startService(project, s.name, workspaceRoot)),
    );
  }

  /**
   * Stop a specific service, or all services for a project if no serviceName given.
   * Backward-compatible: stop(projectName) stops all services for that project.
   */
  async stop(projectName: string, serviceName?: string): Promise<void> {
    if (serviceName) {
      await this._stopByKey(this.processKey(projectName, serviceName));
    } else {
      const keys = this.allKeysForProject(projectName);
      await Promise.allSettled(keys.map((k) => this._stopByKey(k)));
    }
  }

  /**
   * Restart a specific service (or first service if no serviceName given).
   * If _startService fails after stopping, the service remains stopped and the
   * error message reflects that state explicitly.
   */
  async restart(
    projectName: string,
    serviceName?: string,
  ): Promise<RunningProcess> {
    let key: string | undefined;
    if (serviceName) {
      key = this.processKey(projectName, serviceName);
    } else {
      key = this.firstKeyForProject(projectName);
    }

    const managed = key ? this.processes.get(key) : undefined;
    if (!managed) {
      throw new Error(`No process found for "${projectName}"`);
    }

    const resolvedServiceName = managed.info.serviceName!; // always set by _startService
    const { project, workspaceRoot } = managed;
    // Capture restartCount before stop() — _stopByKey deletes the map entry, so the
    // managed object becomes inaccessible afterwards. _startService then initialises
    // the new entry with restartCount=0 (key absent), and we patch it to prevCount+1 below.
    const prevRestartCount = managed.info.restartCount;

    await this.stop(projectName, resolvedServiceName);

    try {
      await this._startService(project, resolvedServiceName, workspaceRoot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to restart service "${resolvedServiceName}" for "${projectName}" ` +
          `(service is now stopped): ${msg}`,
      );
    }

    const newKey = this.processKey(projectName, resolvedServiceName);
    const newManaged = this.processes.get(newKey);
    if (newManaged) {
      newManaged.info.restartCount = prevRestartCount + 1;
    }

    const result = newManaged
      ? { ...newManaged.info }
      : ({ projectName } as RunningProcess);

    this.emitter.emit("progress", {
      projectName,
      serviceName: resolvedServiceName,
      phase: "restarted",
      process: { ...result },
    });

    return result;
  }

  /**
   * Get a specific process, or the first process for a project if no serviceName given.
   * Backward-compatible: getProcess(projectName) finds the first running service.
   */
  getProcess(
    projectName: string,
    serviceName?: string,
  ): RunningProcess | undefined {
    if (serviceName) {
      const managed = this.processes.get(
        this.processKey(projectName, serviceName),
      );
      return managed ? { ...managed.info } : undefined;
    }
    const key = this.firstKeyForProject(projectName);
    const managed = key ? this.processes.get(key) : undefined;
    return managed ? { ...managed.info } : undefined;
  }

  /** Get all running processes for a specific project. */
  getProcessesForProject(projectName: string): RunningProcess[] {
    return this.allKeysForProject(projectName)
      .map((k) => this.processes.get(k))
      .filter((m): m is ManagedProcess => m !== undefined)
      .map((m) => ({ ...m.info }));
  }

  getAllProcesses(): RunningProcess[] {
    return Array.from(this.processes.values()).map((m) => ({ ...m.info }));
  }

  /**
   * Get logs for the first (or only) service of a project.
   * Backward-compatible with server route: getLogs(projectName, lines).
   */
  getLogs(projectName: string, lines?: number): ProcessLogEntry[] {
    const key = this.firstKeyForProject(projectName);
    const managed = key ? this.processes.get(key) : undefined;
    if (!managed) return [];
    return lines !== undefined
      ? managed.logs.getLast(lines)
      : managed.logs.getAll();
  }

  /** Get logs for a specific named service. */
  getServiceLogs(
    projectName: string,
    serviceName: string,
    lines?: number,
  ): ProcessLogEntry[] {
    const managed = this.processes.get(
      this.processKey(projectName, serviceName),
    );
    if (!managed) return [];
    return lines !== undefined
      ? managed.logs.getLast(lines)
      : managed.logs.getAll();
  }

  async stopAll(): Promise<void> {
    const keys = Array.from(this.processes.keys());
    await Promise.allSettled(keys.map((key) => this._stopByKey(key)));
  }
}

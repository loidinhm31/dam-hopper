import { execa } from "execa";
import EventEmitter from "eventemitter3";
import { getEffectiveCommand } from "../config/index.js";
import type { ProjectConfig } from "../config/index.js";
import { resolveEnv } from "./env-loader.js";
import { LogBuffer } from "./log-buffer.js";
import type { RunningProcess, ProcessLogEntry, RunProgressEvent } from "./types.js";

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

  async start(project: ProjectConfig, workspaceRoot: string): Promise<RunningProcess> {
    const existing = this.processes.get(project.name);
    if (existing && existing.info.status === "running") {
      throw new Error(`Process for "${project.name}" is already running. Stop it first.`);
    }

    const command = getEffectiveCommand(project, "run");
    if (!command) {
      throw new Error(`No run command configured for "${project.name}"`);
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
      throw new Error(`Failed to spawn process for "${project.name}" — no PID assigned`);
    }

    const prevRestartCount = this.processes.get(project.name)?.info.restartCount ?? 0;

    const info: RunningProcess = {
      projectName: project.name,
      command,
      pid,
      startedAt: new Date(),
      status: "running",
      restartCount: prevRestartCount,
    };

    const logs = new LogBuffer();

    const streamLines = (
      stream: NodeJS.ReadableStream | null,
      streamName: "stdout" | "stderr",
    ) => {
      if (!stream) return;
      let partial = "";
      stream.on("data", (chunk: Buffer) => {
        partial += chunk.toString();
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          const entry: ProcessLogEntry = { timestamp: new Date(), stream: streamName, line };
          logs.push(entry);
          this.emitter.emit("progress", {
            projectName: project.name,
            phase: "output",
            stream: streamName,
            line,
            process: { ...info },
          });
        }
      });
    };

    streamLines(subprocess.stdout, "stdout");
    streamLines(subprocess.stderr, "stderr");

    const done = subprocess.then(
      () => {
        info.status = "stopped";
        info.exitCode = 0;
        this.emitter.emit("progress", {
          projectName: project.name,
          phase: "stopped",
          process: { ...info },
        });
      },
      (err: { exitCode?: number }) => {
        // A process is "crashed" only when it exits with a non-zero, non-null code
        // AND was not intentionally stopped by us via stop()/stopAll().
        // We track this ourselves because err.killed is unreliable with shell:true.
        const managed = this.processes.get(project.name);
        const intentional = managed?.intentionallyStopped ?? false;
        const crashed = !intentional && err.exitCode !== 0 && err.exitCode !== null;
        info.status = crashed ? "crashed" : "stopped";
        info.exitCode = err.exitCode ?? undefined;
        this.emitter.emit("progress", {
          projectName: project.name,
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

    this.processes.set(project.name, managed);

    this.emitter.emit("progress", {
      projectName: project.name,
      phase: "started",
      process: { ...info },
    });

    return { ...info };
  }

  async stop(projectName: string): Promise<void> {
    const managed = this.processes.get(projectName);
    if (!managed) return;

    managed.intentionallyStopped = true;
    managed.kill("SIGTERM");

    const exited = await Promise.race([
      managed.done.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), SIGTERM_TIMEOUT_MS)),
    ]);

    if (!exited) {
      managed.kill("SIGKILL");
      await managed.done;
    }

    // The done promise already emitted "stopped"/"crashed" — no duplicate emit here.
    managed.info.status = "stopped";
    this.processes.delete(projectName);
  }

  async restart(projectName: string): Promise<RunningProcess> {
    const managed = this.processes.get(projectName);
    if (!managed) {
      throw new Error(`No process found for "${projectName}"`);
    }

    const { project, workspaceRoot } = managed;
    const prevRestartCount = managed.info.restartCount;

    await this.stop(projectName);

    await this.start(project, workspaceRoot);

    // Apply restartCount to the live info object (not the returned snapshot).
    const newManaged = this.processes.get(projectName);
    if (newManaged) {
      newManaged.info.restartCount = prevRestartCount + 1;
    }

    const result = newManaged ? { ...newManaged.info } : ({ projectName } as RunningProcess);

    this.emitter.emit("progress", {
      projectName,
      phase: "restarted",
      process: { ...result },
    });

    return result;
  }

  getProcess(projectName: string): RunningProcess | undefined {
    const managed = this.processes.get(projectName);
    return managed ? { ...managed.info } : undefined;
  }

  getAllProcesses(): RunningProcess[] {
    return Array.from(this.processes.values()).map((m) => ({ ...m.info }));
  }

  getLogs(projectName: string, lines?: number): ProcessLogEntry[] {
    const managed = this.processes.get(projectName);
    if (!managed) return [];
    return lines !== undefined ? managed.logs.getLast(lines) : managed.logs.getAll();
  }

  async stopAll(): Promise<void> {
    const names = Array.from(this.processes.keys());
    // Use allSettled so all processes are stopped even if one throws.
    await Promise.allSettled(names.map((name) => this.stop(name)));
  }
}

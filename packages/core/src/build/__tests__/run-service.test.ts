import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { RunService } from "../run-service.js";
import { CommandService } from "../command-service.js";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-proc",
    path: process.cwd(),
    type: "custom",
    services: [
      { name: "default", runCommand: 'node -e "setInterval(() => {}, 100)"' },
    ],
    envFile: undefined,
    tags: undefined,
    ...overrides,
  };
}

/** Wait for a specific event phase, with a timeout. */
function waitForPhase(
  service: RunService,
  phase: string,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for phase: ${phase}`)),
      timeoutMs,
    );
    service.emitter.on("progress", function handler(e) {
      if (e.phase === phase) {
        clearTimeout(timer);
        service.emitter.off("progress", handler);
        resolve();
      }
    });
  });
}

describe("RunService", () => {
  let service: RunService;

  beforeEach(() => {
    service = new RunService();
  });

  afterEach(async () => {
    await service.stopAll();
  });

  it("starts a long-running process and tracks it by name", async () => {
    const project = makeProject();
    const proc = await service.start(project, process.cwd());

    expect(proc.projectName).toBe("test-proc");
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.status).toBe("running");
    expect(proc.serviceName).toBe("default");

    await service.stop("test-proc");
  });

  it("getProcess returns running process info", async () => {
    const project = makeProject();
    await service.start(project, process.cwd());

    const info = service.getProcess("test-proc");
    expect(info).toBeDefined();
    expect(info!.status).toBe("running");

    await service.stop("test-proc");
  });

  it("getAllProcesses returns all tracked processes", async () => {
    await service.start(
      makeProject({
        name: "a",
        services: [
          { name: "default", runCommand: 'node -e "setInterval(()=>{},100)"' },
        ],
      }),
      process.cwd(),
    );
    await service.start(
      makeProject({
        name: "b",
        services: [
          { name: "default", runCommand: 'node -e "setInterval(()=>{},100)"' },
        ],
      }),
      process.cwd(),
    );

    expect(service.getAllProcesses()).toHaveLength(2);

    await service.stop("a");
    await service.stop("b");
  });

  it("throws if process already running", async () => {
    const project = makeProject();
    await service.start(project, process.cwd());

    await expect(service.start(project, process.cwd())).rejects.toThrow(
      "already running",
    );

    await service.stop("test-proc");
  });

  it("throws when no run command configured", async () => {
    const project = makeProject({ type: "custom", services: [] });
    await expect(service.start(project, process.cwd())).rejects.toThrow(
      "No run command",
    );
  });

  it("stop gracefully terminates process", async () => {
    const project = makeProject();
    await service.start(project, process.cwd());
    await service.stop("test-proc");

    expect(service.getProcess("test-proc")).toBeUndefined();
  });

  it("emits started event on start", async () => {
    const project = makeProject();
    const phases: string[] = [];
    service.emitter.on("progress", (e) => phases.push(e.phase));

    await service.start(project, process.cwd());
    expect(phases).toContain("started");

    await service.stop("test-proc");
  });

  it("emits stopped event on stop", async () => {
    const project = makeProject();
    const phases: string[] = [];

    service.emitter.on("progress", (e) => phases.push(e.phase));

    await service.start(project, process.cwd());
    await service.stop("test-proc");

    expect(phases).toContain("stopped");
  });

  it("restart increments restartCount", async () => {
    const project = makeProject();
    await service.start(project, process.cwd());

    const restarted = await service.restart("test-proc");
    expect(restarted.restartCount).toBe(1);

    await service.stop("test-proc");
  });

  it("getLogs returns captured log lines", async () => {
    const project = makeProject({
      services: [
        {
          name: "default",
          runCommand:
            "node -e \"console.log('log1'); console.log('log2'); setInterval(()=>{},100)\"",
        },
      ],
    });

    const outputPromise = waitForPhase(service, "output");
    await service.start(project, process.cwd());
    await outputPromise;

    const logs = service.getLogs("test-proc");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((e) => e.line.includes("log"))).toBe(true);

    await service.stop("test-proc");
  });

  it("stopAll stops all managed processes", async () => {
    await service.start(
      makeProject({
        name: "x",
        services: [
          { name: "default", runCommand: 'node -e "setInterval(()=>{},100)"' },
        ],
      }),
      process.cwd(),
    );
    await service.start(
      makeProject({
        name: "y",
        services: [
          { name: "default", runCommand: 'node -e "setInterval(()=>{},100)"' },
        ],
      }),
      process.cwd(),
    );

    await service.stopAll();

    expect(service.getAllProcesses()).toHaveLength(0);
  });

  it("detects crashed process", async () => {
    const project = makeProject({
      name: "crasher",
      services: [{ name: "default", runCommand: 'node -e "process.exit(1)"' }],
    });

    const crashedPromise = waitForPhase(service, "crashed");
    await service.start(project, process.cwd());
    await crashedPromise;

    const proc = service.getProcess("crasher");
    expect(proc?.status).toBe("crashed");
  });

  // --- Multi-service tests ---

  it("startAll starts all services concurrently", async () => {
    const project = makeProject({
      name: "multi",
      services: [
        { name: "frontend", runCommand: 'node -e "setInterval(()=>{},100)"' },
        { name: "backend", runCommand: 'node -e "setInterval(()=>{},100)"' },
      ],
    });

    const procs = await service.startAll(project, process.cwd());

    expect(procs).toHaveLength(2);
    expect(procs.every((p) => p.status === "running")).toBe(true);
    expect(procs.find((p) => p.serviceName === "frontend")).toBeDefined();
    expect(procs.find((p) => p.serviceName === "backend")).toBeDefined();

    await service.stop("multi");
  });

  it("stop with serviceName stops only that service", async () => {
    const project = makeProject({
      name: "multi2",
      services: [
        { name: "svc1", runCommand: 'node -e "setInterval(()=>{},100)"' },
        { name: "svc2", runCommand: 'node -e "setInterval(()=>{},100)"' },
      ],
    });

    await service.startAll(project, process.cwd());
    await service.stop("multi2", "svc1");

    const remaining = service.getProcessesForProject("multi2");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].serviceName).toBe("svc2");

    await service.stop("multi2");
  });

  it("getProcessesForProject returns all services for a project", async () => {
    const project = makeProject({
      name: "multi3",
      services: [
        { name: "a", runCommand: 'node -e "setInterval(()=>{},100)"' },
        { name: "b", runCommand: 'node -e "setInterval(()=>{},100)"' },
      ],
    });

    await service.startAll(project, process.cwd());
    const procs = service.getProcessesForProject("multi3");

    expect(procs).toHaveLength(2);
    await service.stop("multi3");
  });

  it("start with serviceName starts specific service", async () => {
    const project = makeProject({
      name: "multi4",
      services: [
        { name: "alpha", runCommand: 'node -e "setInterval(()=>{},100)"' },
        { name: "beta", runCommand: 'node -e "setInterval(()=>{},100)"' },
      ],
    });

    const proc = await service.start(project, process.cwd(), "beta");
    expect(proc.serviceName).toBe("beta");

    await service.stop("multi4");
  });

  it("start throws when named service not found", async () => {
    const project = makeProject({
      services: [
        { name: "default", runCommand: 'node -e "setInterval(()=>{},100)"' },
      ],
    });
    await expect(
      service.start(project, process.cwd(), "nonexistent"),
    ).rejects.toThrow('Service "nonexistent" not found');
  });

  it("getServiceLogs returns logs for a specific service", async () => {
    const project = makeProject({
      name: "log-test",
      services: [
        {
          name: "svc",
          runCommand:
            "node -e \"console.log('svclog'); setInterval(()=>{},100)\"",
        },
      ],
    });

    const outputPromise = waitForPhase(service, "output");
    await service.start(project, process.cwd(), "svc");
    await outputPromise;

    const logs = service.getServiceLogs("log-test", "svc");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((e) => e.line.includes("svclog"))).toBe(true);

    await service.stop("log-test");
  });
});

describe("CommandService", () => {
  it("executes a named custom command successfully", async () => {
    const svc = new CommandService();
    const project: ProjectConfig = {
      name: "test-proj",
      path: process.cwd(),
      type: "custom",
      commands: { greet: 'echo "hello"' },
      envFile: undefined,
      tags: undefined,
    };

    const result = await svc.execute(project, "greet", process.cwd());

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.serviceName).toBe("greet");
  });

  it("returns failure for unknown command", async () => {
    const svc = new CommandService();
    const project: ProjectConfig = {
      name: "test-proj",
      path: process.cwd(),
      type: "custom",
      commands: {},
      envFile: undefined,
      tags: undefined,
    };

    const result = await svc.execute(project, "missing", process.cwd());

    expect(result.success).toBe(false);
    expect(result.error).toContain("No command");
  });

  it("emits started, output, and completed events", async () => {
    const svc = new CommandService();
    const project: ProjectConfig = {
      name: "test-proj",
      path: process.cwd(),
      type: "custom",
      commands: { greet: 'echo "hi"' },
      envFile: undefined,
      tags: undefined,
    };

    const phases: string[] = [];
    svc.emitter.on("progress", (e) => phases.push(e.phase));

    await svc.execute(project, "greet", process.cwd());

    expect(phases[0]).toBe("started");
    expect(phases).toContain("output");
    expect(phases[phases.length - 1]).toBe("completed");
  });

  it("returns failure for non-zero exit code", async () => {
    const svc = new CommandService();
    const project: ProjectConfig = {
      name: "test-proj",
      path: process.cwd(),
      type: "custom",
      commands: { fail: "exit 1" },
      envFile: undefined,
      tags: undefined,
    };

    const result = await svc.execute(project, "fail", process.cwd());

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

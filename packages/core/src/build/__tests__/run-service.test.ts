import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { RunService } from "../run-service.js";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-proc",
    path: process.cwd(),
    type: "custom",
    buildCommand: undefined,
    runCommand: "node -e \"setInterval(() => {}, 100)\"",
    envFile: undefined,
    tags: undefined,
    ...overrides,
  };
}

/** Wait for a specific event phase, with a timeout. */
function waitForPhase(service: RunService, phase: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for phase: ${phase}`)), timeoutMs);
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
    await service.start(makeProject({ name: "a", runCommand: "node -e \"setInterval(()=>{},100)\"" }), process.cwd());
    await service.start(makeProject({ name: "b", runCommand: "node -e \"setInterval(()=>{},100)\"" }), process.cwd());

    expect(service.getAllProcesses()).toHaveLength(2);

    await service.stop("a");
    await service.stop("b");
  });

  it("throws if process already running", async () => {
    const project = makeProject();
    await service.start(project, process.cwd());

    await expect(service.start(project, process.cwd())).rejects.toThrow("already running");

    await service.stop("test-proc");
  });

  it("throws when no run command configured", async () => {
    const project = makeProject({ runCommand: undefined, type: "custom" });
    await expect(service.start(project, process.cwd())).rejects.toThrow("No run command");
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

    // Register listener before start so we capture all events
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
      runCommand: "node -e \"console.log('log1'); console.log('log2'); setInterval(()=>{},100)\"",
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
    await service.start(makeProject({ name: "x", runCommand: "node -e \"setInterval(()=>{},100)\"" }), process.cwd());
    await service.start(makeProject({ name: "y", runCommand: "node -e \"setInterval(()=>{},100)\"" }), process.cwd());

    await service.stopAll();

    expect(service.getAllProcesses()).toHaveLength(0);
  });

  it("detects crashed process", async () => {
    const project = makeProject({ name: "crasher", runCommand: "node -e \"process.exit(1)\"" });

    const crashedPromise = waitForPhase(service, "crashed");
    await service.start(project, process.cwd());
    await crashedPromise;

    const proc = service.getProcess("crasher");
    // process is still tracked (not removed from map on crash — only on explicit stop)
    expect(proc?.status).toBe("crashed");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { BuildService } from "../build-service.js";
import type { BuildProgressEvent } from "../types.js";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-project",
    path: process.cwd(),
    type: "custom",
    envFile: undefined,
    tags: undefined,
    ...overrides,
  };
}

describe("BuildService", () => {
  let service: BuildService;

  beforeEach(() => {
    service = new BuildService();
  });

  it("runs a simple build command successfully", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: 'echo "hello build"' }],
    });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.projectName).toBe("test-project");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.stdout).toContain("hello build");
  });

  it("returns failure for non-zero exit code", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: "exit 1" }],
    });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("returns error result when no command configured", async () => {
    const project = makeProject({ type: "custom" });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("emits started, output, and completed events in order", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: 'echo "line1"' }],
    });
    const events: BuildProgressEvent["phase"][] = [];

    service.emitter.on("progress", (e) => events.push(e.phase));

    await service.build(project, process.cwd());

    expect(events[0]).toBe("started");
    expect(events).toContain("output");
    expect(events[events.length - 1]).toBe("completed");
  });

  it("emits failed event for failing command", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: "exit 2" }],
    });
    const phases: BuildProgressEvent["phase"][] = [];

    service.emitter.on("progress", (e) => phases.push(e.phase));
    await service.build(project, process.cwd());

    expect(phases[0]).toBe("started");
    expect(phases[phases.length - 1]).toBe("failed");
  });

  it("buildMultiple runs all projects", async () => {
    const projects = [
      makeProject({
        name: "p1",
        services: [{ name: "default", buildCommand: 'echo "p1"' }],
      }),
      makeProject({
        name: "p2",
        services: [{ name: "default", buildCommand: 'echo "p2"' }],
      }),
    ];
    const results = await service.buildMultiple(projects, process.cwd());

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("build with specific serviceName builds only that service", async () => {
    const project = makeProject({
      services: [
        { name: "frontend", buildCommand: 'echo "frontend"' },
        { name: "backend", buildCommand: 'echo "backend"' },
      ],
    });

    const result = await service.build(project, process.cwd(), "backend");

    expect(result.success).toBe(true);
    expect(result.serviceName).toBe("backend");
    expect(result.stdout).toContain("backend");
  });

  it("buildAll builds all services and returns results array", async () => {
    const project = makeProject({
      services: [
        { name: "frontend", buildCommand: 'echo "frontend"' },
        { name: "backend", buildCommand: 'echo "backend"' },
      ],
    });

    const results = await service.buildAll(project, process.cwd());

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.find((r) => r.serviceName === "frontend")).toBeDefined();
    expect(results.find((r) => r.serviceName === "backend")).toBeDefined();
  });

  it("events include serviceName", async () => {
    const project = makeProject({
      services: [{ name: "frontend", buildCommand: 'echo "ok"' }],
    });
    const events: BuildProgressEvent[] = [];
    service.emitter.on("progress", (e) => events.push(e));

    await service.build(project, process.cwd());

    expect(events.every((e) => e.serviceName === "frontend")).toBe(true);
  });

  it("buildMultiple flattens results across all projects and services", async () => {
    const projects = [
      makeProject({
        name: "multi",
        services: [
          { name: "svc1", buildCommand: 'echo "svc1"' },
          { name: "svc2", buildCommand: 'echo "svc2"' },
        ],
      }),
      makeProject({
        name: "single",
        services: [{ name: "default", buildCommand: 'echo "single"' }],
      }),
    ];

    const results = await service.buildMultiple(projects, process.cwd());

    expect(results).toHaveLength(3);
  });

  it("buildAll partial failure: returns both success and failure results", async () => {
    const project = makeProject({
      services: [
        { name: "ok", buildCommand: 'echo "ok"' },
        { name: "fail", buildCommand: "exit 1" },
      ],
    });

    const results = await service.buildAll(project, process.cwd());

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.serviceName === "ok")?.success).toBe(true);
    expect(results.find((r) => r.serviceName === "fail")?.success).toBe(false);
  });

  it("build throws when named service not found", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: 'echo "ok"' }],
    });
    await expect(
      service.build(project, process.cwd(), "nonexistent"),
    ).rejects.toThrow('Service "nonexistent" not found');
  });
});

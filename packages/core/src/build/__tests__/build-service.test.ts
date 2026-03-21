import { describe, it, expect, beforeEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { BuildService } from "../build-service.js";
import type { BuildProgressEvent } from "../types.js";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-project",
    path: process.cwd(),
    type: "custom",
    buildCommand: undefined,
    runCommand: undefined,
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
    const project = makeProject({ buildCommand: 'echo "hello build"' });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.projectName).toBe("test-project");
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.stdout).toContain("hello build");
  });

  it("returns failure for non-zero exit code", async () => {
    const project = makeProject({ buildCommand: "exit 1" });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("returns error result when no command configured", async () => {
    const project = makeProject({ type: "custom", buildCommand: undefined });
    const result = await service.build(project, process.cwd());

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("emits started, output, and completed events in order", async () => {
    const project = makeProject({ buildCommand: 'echo "line1"' });
    const events: BuildProgressEvent["phase"][] = [];

    service.emitter.on("progress", (e) => events.push(e.phase));

    await service.build(project, process.cwd());

    expect(events[0]).toBe("started");
    expect(events).toContain("output");
    expect(events[events.length - 1]).toBe("completed");
  });

  it("emits failed event for failing command", async () => {
    const project = makeProject({ buildCommand: "exit 2" });
    const phases: BuildProgressEvent["phase"][] = [];

    service.emitter.on("progress", (e) => phases.push(e.phase));
    await service.build(project, process.cwd());

    expect(phases[0]).toBe("started");
    expect(phases[phases.length - 1]).toBe("failed");
  });

  it("buildMultiple runs all projects", async () => {
    const projects = [
      makeProject({ name: "p1", buildCommand: 'echo "p1"' }),
      makeProject({ name: "p2", buildCommand: 'echo "p2"' }),
    ];
    const results = await service.buildMultiple(projects, process.cwd());

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });
});

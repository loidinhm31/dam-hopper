import { describe, it, expect, beforeEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { BuildService } from "../build-service.js";

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

describe("BuildService (PTY delegation mode)", () => {
  let service: BuildService;

  beforeEach(() => {
    service = new BuildService();
  });

  it("getServices returns services list", () => {
    const project = makeProject({
      services: [
        { name: "frontend", buildCommand: "pnpm build" },
        { name: "backend", buildCommand: "mvn package" },
      ],
    });
    const services = service.getServices(project);
    expect(services).toHaveLength(2);
    expect(services[0].name).toBe("frontend");
    expect(services[1].name).toBe("backend");
  });

  it("getServices returns synthetic default service when none defined", () => {
    const project = makeProject({ type: "npm" });
    const services = service.getServices(project);
    expect(services).toHaveLength(1);
    // synthetic default inherits project type preset build command
    expect(services[0].name).toBe("default");
  });

  it("getServiceContext resolves env and cwd", async () => {
    const project = makeProject({
      services: [{ name: "default", buildCommand: "make build" }],
    });
    const ctx = await service.getServiceContext(
      project,
      project.services![0],
      process.cwd(),
    );
    expect(ctx.command).toBe("make build");
    expect(ctx.cwd).toBe(project.path);
    expect(ctx.env).toBeTypeOf("object");
  });

  it("emitNoCommand emits failed event and returns failed BuildResult", () => {
    const project = makeProject({ services: [{ name: "default" }] });
    const phases: string[] = [];
    service.emitter.on("progress", (e) => phases.push(e.phase));

    const result = service.emitNoCommand(project, project.services![0]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(phases).toContain("failed");
  });

  it("has emitter for event forwarding", () => {
    expect(service.emitter).toBeDefined();
    expect(typeof service.emitter.on).toBe("function");
  });
});

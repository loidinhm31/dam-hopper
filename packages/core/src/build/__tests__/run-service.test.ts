import { describe, it, expect, beforeEach } from "vitest";
import type { ProjectConfig } from "../../config/index.js";
import { RunService } from "../run-service.js";
import { CommandService } from "../command-service.js";

function makeProject(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "test-proc",
    path: process.cwd(),
    type: "custom",
    services: [{ name: "default", runCommand: "node server.js" }],
    envFile: undefined,
    tags: undefined,
    ...overrides,
  };
}

describe("RunService (PTY delegation mode)", () => {
  let service: RunService;

  beforeEach(() => {
    service = new RunService();
  });

  it("getServices returns services list", () => {
    const project = makeProject({
      services: [
        { name: "api", runCommand: "node api.js" },
        { name: "worker", runCommand: "node worker.js" },
      ],
    });
    const services = service.getServices(project);
    expect(services).toHaveLength(2);
  });

  it("getFirstService returns first service when no name given", () => {
    const project = makeProject();
    const svc = service.getFirstService(project);
    expect(svc?.name).toBe("default");
  });

  it("getFirstService returns named service", () => {
    const project = makeProject({
      services: [
        { name: "api", runCommand: "node api.js" },
        { name: "worker", runCommand: "node worker.js" },
      ],
    });
    const svc = service.getFirstService(project, "worker");
    expect(svc?.name).toBe("worker");
  });

  it("getFirstService returns undefined for unknown name", () => {
    const project = makeProject();
    const svc = service.getFirstService(project, "nonexistent");
    expect(svc).toBeUndefined();
  });

  it("getServiceContext resolves env and cwd", async () => {
    const project = makeProject();
    const ctx = await service.getServiceContext(
      project,
      project.services![0],
      process.cwd(),
    );
    expect(ctx.command).toBe("node server.js");
    expect(ctx.cwd).toBe(project.path);
    expect(ctx.env).toBeTypeOf("object");
  });

  it("has emitter for event forwarding", () => {
    expect(service.emitter).toBeDefined();
  });
});

describe("CommandService (PTY delegation mode)", () => {
  let service: CommandService;

  beforeEach(() => {
    service = new CommandService();
  });

  it("resolve returns command string for known command", () => {
    const project = makeProject({
      commands: { lint: "eslint .", format: "prettier --write ." },
    });
    expect(service.resolve(project, "lint")).toBe("eslint .");
    expect(service.resolve(project, "format")).toBe("prettier --write .");
  });

  it("resolve returns undefined for unknown command", () => {
    const project = makeProject({ commands: { lint: "eslint ." } });
    expect(service.resolve(project, "nonexistent")).toBeUndefined();
  });

  it("getCommandContext returns null for unknown command", async () => {
    const project = makeProject({ commands: { lint: "eslint ." } });
    const ctx = await service.getCommandContext(
      project,
      "nonexistent",
      process.cwd(),
    );
    expect(ctx).toBeNull();
  });

  it("getCommandContext returns resolved context for known command", async () => {
    const project = makeProject({ commands: { lint: "eslint ." } });
    const ctx = await service.getCommandContext(project, "lint", process.cwd());
    expect(ctx).not.toBeNull();
    expect(ctx!.command).toBe("eslint .");
    expect(ctx!.cwd).toBe(project.path);
    expect(ctx!.env).toBeTypeOf("object");
  });

  it("has emitter for event forwarding", () => {
    expect(service.emitter).toBeDefined();
  });
});

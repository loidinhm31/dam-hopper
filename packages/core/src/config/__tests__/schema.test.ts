import { describe, it, expect } from "vitest";
import {
  DevHubConfigSchema,
  ProjectConfigSchema,
  ServiceConfigSchema,
} from "../schema.js";

describe("ServiceConfigSchema", () => {
  it("parses a valid service config", () => {
    const result = ServiceConfigSchema.safeParse({
      name: "frontend",
      build_command: "pnpm build:frontend",
      run_command: "pnpm dev:frontend",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("frontend");
      expect(result.data.buildCommand).toBe("pnpm build:frontend");
      expect(result.data.runCommand).toBe("pnpm dev:frontend");
    }
  });

  it("parses service with only name (commands optional)", () => {
    const result = ServiceConfigSchema.safeParse({ name: "backend" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buildCommand).toBeUndefined();
      expect(result.data.runCommand).toBeUndefined();
    }
  });

  it("rejects empty service name", () => {
    const result = ServiceConfigSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("ProjectConfigSchema", () => {
  it("parses a valid project config", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "api",
      path: "./api",
      type: "maven",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("api");
      expect(result.data.services).toBeUndefined();
      expect(result.data.commands).toBeUndefined();
    }
  });

  it("parses project with services", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "app",
      path: "./app",
      type: "pnpm",
      services: [
        { name: "frontend", run_command: "pnpm dev:frontend" },
        { name: "backend", run_command: "pnpm dev:backend" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toHaveLength(2);
      expect(result.data.services![0].name).toBe("frontend");
      expect(result.data.services![1].runCommand).toBe("pnpm dev:backend");
    }
  });

  it("parses project with commands", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "api",
      path: "./api",
      type: "maven",
      commands: { test: "mvn test", lint: "mvn checkstyle:check" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.commands).toEqual({
        test: "mvn test",
        lint: "mvn checkstyle:check",
      });
    }
  });

  it("transforms env_file to envFile", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "api",
      path: "./api",
      type: "maven",
      env_file: ".env",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.envFile).toBe(".env");
    }
  });

  it("rejects unknown project type", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "api",
      path: "./api",
      type: "maven2",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty project name", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "",
      path: "./api",
      type: "maven",
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate service names within a project", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "app",
      path: "./app",
      type: "pnpm",
      services: [
        { name: "frontend", run_command: "pnpm dev:frontend" },
        { name: "frontend", run_command: "pnpm dev:frontend2" },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("DevHubConfigSchema", () => {
  const validConfig = {
    workspace: { name: "my-ws" },
    projects: [
      { name: "api", path: "./api", type: "maven" },
      { name: "web", path: "./web", type: "pnpm" },
    ],
  };

  it("parses a valid config", () => {
    const result = DevHubConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("defaults workspace root to '.'", () => {
    const result = DevHubConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workspace.root).toBe(".");
    }
  });

  it("defaults projects to empty array", () => {
    const result = DevHubConfigSchema.safeParse({
      workspace: { name: "ws" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projects).toEqual([]);
    }
  });

  it("rejects duplicate project names", () => {
    const result = DevHubConfigSchema.safeParse({
      workspace: { name: "ws" },
      projects: [
        { name: "api", path: "./api", type: "maven" },
        { name: "api", path: "./api2", type: "gradle" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing workspace name", () => {
    const result = DevHubConfigSchema.safeParse({
      workspace: {},
      projects: [],
    });
    expect(result.success).toBe(false);
  });
});

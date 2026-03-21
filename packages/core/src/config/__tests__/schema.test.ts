import { describe, it, expect } from "vitest";
import { DevHubConfigSchema, ProjectConfigSchema } from "../schema.js";

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
      expect(result.data.buildCommand).toBeUndefined();
    }
  });

  it("transforms snake_case to camelCase", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "api",
      path: "./api",
      type: "maven",
      build_command: "mvn package",
      run_command: "java -jar app.jar",
      env_file: ".env",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.buildCommand).toBe("mvn package");
      expect(result.data.runCommand).toBe("java -jar app.jar");
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

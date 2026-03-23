import { describe, it, expect } from "vitest";
import {
  getPreset,
  getEffectiveCommand,
  getProjectServices,
} from "../presets.js";
import type { ProjectConfig } from "../schema.js";

describe("getPreset", () => {
  it("returns maven preset", () => {
    const preset = getPreset("maven");
    expect(preset.buildCommand).toBe("mvn clean install -DskipTests");
    expect(preset.markerFiles).toContain("pom.xml");
  });

  it("returns pnpm preset", () => {
    const preset = getPreset("pnpm");
    expect(preset.buildCommand).toBe("pnpm build");
    expect(preset.devCommand).toBe("pnpm dev");
  });
});

describe("getProjectServices", () => {
  const baseProject: ProjectConfig = {
    name: "api",
    path: "./api",
    type: "maven",
  };

  it("returns preset-based default service for project without services", () => {
    const services = getProjectServices(baseProject);
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("default");
    expect(services[0].buildCommand).toBe("mvn clean install -DskipTests");
    expect(services[0].runCommand).toBe("mvn spring-boot:run");
  });

  it("returns explicit services when defined", () => {
    const project: ProjectConfig = {
      ...baseProject,
      type: "pnpm",
      services: [
        {
          name: "frontend",
          runCommand: "pnpm dev:frontend",
          buildCommand: "pnpm build:frontend",
        },
        { name: "backend", runCommand: "pnpm dev:backend" },
      ],
    };
    const services = getProjectServices(project);
    expect(services).toHaveLength(2);
    expect(services[0].name).toBe("frontend");
    expect(services[1].name).toBe("backend");
  });

  it("falls back to preset when services array is empty", () => {
    const project: ProjectConfig = { ...baseProject, services: [] };
    const services = getProjectServices(project);
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("default");
  });

  it("returns pnpm preset service for pnpm project without services", () => {
    const project: ProjectConfig = { ...baseProject, type: "pnpm" };
    const services = getProjectServices(project);
    expect(services[0].buildCommand).toBe("pnpm build");
    expect(services[0].runCommand).toBe("pnpm start");
  });

  it("returns undefined commands for custom preset (empty string converted)", () => {
    const project: ProjectConfig = { ...baseProject, type: "custom" };
    const services = getProjectServices(project);
    expect(services[0].buildCommand).toBeUndefined();
    expect(services[0].runCommand).toBeUndefined();
  });
});

describe("getEffectiveCommand", () => {
  const baseProject: ProjectConfig = {
    name: "api",
    path: "./api",
    type: "maven",
  };

  it("returns preset default when no services defined", () => {
    expect(getEffectiveCommand(baseProject, "build")).toBe(
      "mvn clean install -DskipTests",
    );
    expect(getEffectiveCommand(baseProject, "run")).toBe("mvn spring-boot:run");
  });

  it("returns first service command when services defined", () => {
    const project: ProjectConfig = {
      ...baseProject,
      services: [
        {
          name: "main",
          buildCommand: "mvn package",
          runCommand: "java -jar app.jar",
        },
      ],
    };
    expect(getEffectiveCommand(project, "build")).toBe("mvn package");
    expect(getEffectiveCommand(project, "run")).toBe("java -jar app.jar");
  });

  it("returns empty string for dev if preset has no devCommand", () => {
    expect(getEffectiveCommand(baseProject, "dev")).toBe("");
  });

  it("returns dev command for pnpm preset", () => {
    const pnpmProject: ProjectConfig = { ...baseProject, type: "pnpm" };
    expect(getEffectiveCommand(pnpmProject, "dev")).toBe("pnpm dev");
  });
});

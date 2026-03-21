import { describe, it, expect } from "vitest";
import { getPreset, getEffectiveCommand } from "../presets.js";
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

describe("getEffectiveCommand", () => {
  const baseProject: ProjectConfig = {
    name: "api",
    path: "./api",
    type: "maven",
  };

  it("returns preset default when no override", () => {
    expect(getEffectiveCommand(baseProject, "build")).toBe(
      "mvn clean install -DskipTests",
    );
    expect(getEffectiveCommand(baseProject, "run")).toBe(
      "mvn spring-boot:run",
    );
  });

  it("returns project override when set", () => {
    const project: ProjectConfig = {
      ...baseProject,
      buildCommand: "mvn package",
      runCommand: "java -jar target/app.jar",
    };
    expect(getEffectiveCommand(project, "build")).toBe("mvn package");
    expect(getEffectiveCommand(project, "run")).toBe("java -jar target/app.jar");
  });

  it("returns empty string for dev if preset has no devCommand", () => {
    expect(getEffectiveCommand(baseProject, "dev")).toBe("");
  });

  it("returns dev command for pnpm preset", () => {
    const pnpmProject: ProjectConfig = { ...baseProject, type: "pnpm" };
    expect(getEffectiveCommand(pnpmProject, "dev")).toBe("pnpm dev");
  });
});

import type { ProjectType, ProjectConfig, ServiceConfig } from "./schema.js";

export interface BuildPreset {
  type: ProjectType;
  buildCommand: string;
  runCommand: string;
  devCommand?: string;
  markerFiles: string[];
}

export const PRESETS: Record<ProjectType, BuildPreset> = {
  maven: {
    type: "maven",
    buildCommand: "mvn clean install -DskipTests",
    runCommand: "mvn spring-boot:run",
    markerFiles: ["pom.xml"],
  },
  gradle: {
    type: "gradle",
    buildCommand: "./gradlew build",
    runCommand: "./gradlew bootRun",
    markerFiles: ["build.gradle", "build.gradle.kts"],
  },
  npm: {
    type: "npm",
    buildCommand: "npm run build",
    runCommand: "npm start",
    devCommand: "npm run dev",
    markerFiles: ["package-lock.json"],
  },
  pnpm: {
    type: "pnpm",
    buildCommand: "pnpm build",
    runCommand: "pnpm start",
    devCommand: "pnpm dev",
    markerFiles: ["pnpm-lock.yaml"],
  },
  cargo: {
    type: "cargo",
    buildCommand: "cargo build",
    runCommand: "cargo run",
    markerFiles: ["Cargo.toml"],
  },
  custom: {
    type: "custom",
    buildCommand: "",
    runCommand: "",
    markerFiles: [],
  },
};

export function getPreset(type: ProjectType): BuildPreset {
  return PRESETS[type];
}

export function getProjectServices(project: ProjectConfig): ServiceConfig[] {
  if (project.services && project.services.length > 0) {
    return project.services;
  }
  const preset = getPreset(project.type);
  return [
    {
      name: "default",
      // Convert empty preset strings to undefined so callers can reliably check "!command"
      buildCommand: preset.buildCommand || undefined,
      runCommand: preset.runCommand || undefined,
    },
  ];
}

/**
 * Returns the effective command for a project.
 * - build/run: resolved from the first service (user-defined or preset fallback)
 * - dev: always from the preset — services do not define dev commands in this version
 */
export function getEffectiveCommand(
  project: ProjectConfig,
  command: "build" | "run" | "dev",
): string {
  const preset = getPreset(project.type);
  if (command === "dev") {
    return preset.devCommand ?? "";
  }
  const services = getProjectServices(project);
  const defaultService = services[0];
  if (command === "build") {
    return defaultService?.buildCommand ?? preset.buildCommand;
  }
  return defaultService?.runCommand ?? preset.runCommand;
}

import type { ProjectType } from "./schema.js";
import type { ProjectConfig } from "./schema.js";

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

export function getEffectiveCommand(
  project: ProjectConfig,
  command: "build" | "run" | "dev",
): string {
  const preset = getPreset(project.type);
  if (command === "build") {
    return project.buildCommand ?? preset.buildCommand;
  }
  if (command === "run") {
    return project.runCommand ?? preset.runCommand;
  }
  // dev
  return preset.devCommand ?? "";
}

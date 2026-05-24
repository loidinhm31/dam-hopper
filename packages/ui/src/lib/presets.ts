import type {
  ProjectType,
  ProjectConfig,
  ServiceConfig,
} from "@/api/client.js";

interface BuildPreset {
  buildCommand: string;
  runCommand: string;
}

const PRESETS: Record<ProjectType, BuildPreset> = {
  maven: {
    buildCommand: "mvn clean install -DskipTests",
    runCommand: "mvn spring-boot:run",
  },
  gradle: { buildCommand: "./gradlew build", runCommand: "./gradlew bootRun" },
  npm: { buildCommand: "npm run build", runCommand: "npm start" },
  pnpm: { buildCommand: "pnpm build", runCommand: "pnpm start" },
  cargo: { buildCommand: "cargo build", runCommand: "cargo run" },
  custom: { buildCommand: "", runCommand: "" },
};

function getFirstService(project: ProjectConfig): ServiceConfig | undefined {
  return project.services?.[0];
}

export function getEffectiveCommand(
  project: ProjectConfig,
  type: "build" | "run",
): { command: string; source: "service" | "preset" } {
  const preset = PRESETS[project.type];
  const service = getFirstService(project);
  const serviceCmd =
    type === "build" ? service?.buildCommand : service?.runCommand;
  if (serviceCmd) {
    return { command: serviceCmd, source: "service" };
  }
  const presetCmd = type === "build" ? preset.buildCommand : preset.runCommand;
  return { command: presetCmd, source: "preset" };
}

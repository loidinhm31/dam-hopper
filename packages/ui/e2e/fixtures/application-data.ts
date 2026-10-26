import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export {
  createBrowserStorageState,
  type StorageStateOptions,
  type PlaywrightStorageState,
} from "./application-storage-state.js";
export { seedPlanFixtures } from "./plan-fixtures.js";
import { seedPlanFixtures } from "./plan-fixtures.js";


export interface SeedTreeConfig {
  serverToken?: string;
  workspaceName?: string;
  projectName?: string;
  secondaryProjectName?: string;
  mfaKeyHex?: string;
  seedPlans?: boolean;
  idleSuspendPolicy?: "agent-free";
  seedSemanticFixtures?: boolean;
}

export interface SeedTreeResult {
  hostStagingDir: string;
  serverToken: string;
  mfaKeyHex: string;
  workspaceName: string;
  projectName: string;
  secondaryProjectName: string;
  seedDigest: string;
  dispose: () => Promise<void>;
}

const DEFAULT_POLICY = JSON.stringify(
  {
    version: 2,
    wait: {
      mode: "until_terminal",
      warn_after_ms: 10000,
      warn_every_ms: 30000,
    },
    history: { retention_days: 30, max_bytes: 104857600 },
  },
  null,
  2,
);

/**
 * Creates an isolated deterministic seed tree on the host in a temporary directory.
 */
export async function createSeedTree(
  config: SeedTreeConfig = {},
): Promise<SeedTreeResult> {
  const hostStagingDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "dam-hopper-e2e-seed-"),
  );

  const serverToken = config.serverToken ?? randomUUID().replace(/-/g, "");
  const mfaKeyHex = config.mfaKeyHex ?? randomBytes(32).toString("hex");
  const workspaceName = config.workspaceName ?? "e2e-workspace";
  const projectName = config.projectName ?? "fixture-project";
  const secondaryProjectName =
    config.secondaryProjectName ?? "fixture-worktree-project";
  const seedPlans = config.seedPlans ?? true;

  const homeDir = path.join(hostStagingDir, "home");
  const configDir = path.join(homeDir, ".config", "dam-hopper");
  const workspaceDir = path.join(hostStagingDir, "workspace");
  const projectDir = path.join(workspaceDir, projectName);
  const secondaryProjectDir = path.join(workspaceDir, secondaryProjectName);

  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(secondaryProjectDir, { recursive: true });
  await fs.mkdir(path.join(hostStagingDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(hostStagingDir, "tmp"), { recursive: true });
  // 1. Server token file in ~/.config/dam-hopper/server-token
  await fs.writeFile(path.join(configDir, "server-token"), serverToken + "\n", {
    mode: 0o600,
  });

  // 2. MFA key file (64 hex characters, mode 0o600)
  await fs.writeFile(path.join(homeDir, "mfa.key"), mfaKeyHex + "\n", {
    mode: 0o600,
  });

  const initialPolicyJson = DEFAULT_POLICY;

  // 5. Fixture workspace project files
  await fs.writeFile(
    path.join(projectDir, "README.md"),
    `# ${projectName}\nDeterministic E2E project workspace.\n`,
  );
  await fs.writeFile(
    path.join(projectDir, "sample.txt"),
    "Hello from E2E isolated environment.\n",
  );
  await fs.writeFile(
    path.join(secondaryProjectDir, "README.md"),
    `# ${secondaryProjectName}\nSecondary target workspace.\n`,
  );

  if (seedPlans) {
    await seedPlanFixtures(projectDir, secondaryProjectDir);
  }
  if (config.seedSemanticFixtures) {

    await fs.writeFile(
      path.join(projectDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            jsx: "react-jsx",
            strict: true,
          },
          include: ["*"],
        },
        null,
        2,
      ) + "\n",
    );

    await fs.writeFile(
      path.join(projectDir, "types.ts"),
      `export interface SemanticItem {\n  id: string;\n  name: string;\n  getValue(): number;\n}\n\nexport function computeItemValue(item: SemanticItem): number {\n  return item.getValue() * 2;\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "impl.ts"),
      `import type { SemanticItem } from "./types.js";\n\nexport class StandardSemanticItem implements SemanticItem {\n  constructor(\n    public id: string,\n    public name: string,\n    private value: number,\n  ) {}\n\n  getValue(): number {\n    return this.value;\n  }\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "widget.tsx"),
      `import React from "react";\nimport { StandardSemanticItem } from "./impl.js";\n\nexport function SemanticWidget({ title }: { title: string }) {\n  const item = new StandardSemanticItem("w1", title, 42);\n  return <div className="semantic-widget">{item.name}</div>;\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "helper.js"),
      `export function formatSemanticName(prefix, name) {\n  return \`\${prefix}: \${name}\`;\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "card.jsx"),
      `import React from "react";\nimport { formatSemanticName } from "./helper.js";\n\nexport function SemanticCard({ label }) {\n  const formatted = formatSemanticName("Card", label);\n  return <span>{formatted}</span>;\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "unicode.ts"),
      `// Non-BMP UTF-16 surrogate pairs (🌍 = U+1F30E, 🚀 = U+1F680)\nexport const BANNER = "Welcome 🌍 to DamHopper 🚀!";\n\nexport const PREFIXED_BANNER = "Prefix 🌍🚀 " + BANNER;\n\nexport function getUnicodeBanner(): string {\n  return PREFIXED_BANNER;\n}\n`,
    );

    await fs.writeFile(
      path.join(projectDir, "multi_def.ts"),
      `export interface MultiTargetConfig {\n  core: boolean;\n}\n\nexport interface MultiTargetConfig {\n  extended: boolean;\n}\n\nexport const activeConfig: MultiTargetConfig = {\n  core: true,\n  extended: true,\n};\n`,
    );

    // Generate adaptive sync file sized ~61,700 bytes (under 64 KiB threshold)
    const paddingLine = "// Padding line ensuring stable byte size for adaptive sync qualification tests\n";
    const padRepeat = 760; // 760 * 81 chars = 61,560 bytes
    const adaptiveSyncContent = `export function adaptiveThresholdBase(): string {\n  return "baseline-value";\n}\n\n` +
      paddingLine.repeat(padRepeat) +
      `\nexport function adaptiveThresholdTail(): string {\n  return adaptiveThresholdBase();\n}\n`;
    await fs.writeFile(path.join(projectDir, "adaptive_sync.ts"), adaptiveSyncContent);

    await fs.writeFile(
      path.join(projectDir, "unsupported.rs"),
      `pub fn unsupported_semantic() -> bool {\n    true\n}\n`,
    );

    await fs.writeFile(
      path.join(secondaryProjectDir, "secondary.ts"),
      `export const SECONDARY_ROOT_CONST = "isolated-target";\n`,
    );
  }

  // 6. Root dam-hopper.toml for the container
  const idleSuspendSection =
    config.idleSuspendPolicy === "agent-free"
      ? `\n[server.idle_suspend]\nenabled = true\nautomatic_policy = "agent-free"\nquiet_period_seconds = 10800\nwake_after_seconds = 600\n`
      : "";
  const tomlContent = `[workspace]\nname = "${workspaceName}"\n\n[server]\nsession_db_path = "/e2e/session.db"\n${idleSuspendSection}\n[[projects]]\nname = "${projectName}"\npath = "/e2e/workspace/${projectName}"\ntype = "custom"\n\n[[projects]]\nname = "${secondaryProjectName}"\npath = "/e2e/workspace/${secondaryProjectName}"\ntype = "custom"\n`;
  await fs.writeFile(path.join(hostStagingDir, "dam-hopper.toml"), tomlContent);
  const seedDigest = createHash("sha256")
    .update(serverToken)
    .update(":")
    .update(mfaKeyHex)
    .update(":")
    .update(initialPolicyJson)
    .update(":")
    .update(tomlContent)
    .digest("hex");

  const dispose = async () => {
    try {
      if (existsSync(hostStagingDir)) {
        await fs.rm(hostStagingDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error on process termination
    }
  };

  return {
    hostStagingDir,
    serverToken,
    mfaKeyHex,
    workspaceName,
    projectName,
    secondaryProjectName,
    seedDigest,
    dispose,
  };
}

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

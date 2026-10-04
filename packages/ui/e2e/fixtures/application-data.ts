import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export {
  createBrowserStorageState,
  type StorageStateOptions,
  type PlaywrightStorageState,
} from "./application-storage-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");

export interface SeedTreeConfig {
  serverToken?: string;
  workspaceName?: string;
  projectName?: string;
  mfaKeyHex?: string;
}

export interface SeedTreeResult {
  hostStagingDir: string;
  serverToken: string;
  mfaKeyHex: string;
  workspaceName: string;
  projectName: string;
  seedDigest: string;
  dispose: () => Promise<void>;
}

const DEFAULT_POLICY = JSON.stringify(
  {
    version: 2,
    advisor: {
      primary: { backend: "codex", model: "gpt-5.6-sol", effort: "high" },
      backup: { backend: "omp", model: "openai/gpt-5.6-sol", effort: "medium" },
    },
    wait: { mode: "until_terminal", warn_after_ms: 10000, warn_every_ms: 30000 },
    history: { retention_days: 30, max_bytes: 104857600 },
  },
  null,
  2,
);


/**
 * Creates an isolated deterministic seed tree on the host in a temporary directory.
 */
export async function createSeedTree(config: SeedTreeConfig = {}): Promise<SeedTreeResult> {
  const hostStagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "dam-hopper-e2e-seed-"));

  const serverToken = config.serverToken ?? randomUUID().replace(/-/g, "");
  const mfaKeyHex = config.mfaKeyHex ?? randomBytes(32).toString("hex");
  const workspaceName = config.workspaceName ?? "e2e-workspace";
  const projectName = config.projectName ?? "fixture-project";

  const homeDir = path.join(hostStagingDir, "home");
  const configDir = path.join(homeDir, ".config", "dam-hopper");
  const evcrateDir = path.join(homeDir, ".evcrate");
  const advisorHistoryDir = path.join(evcrateDir, "advisor-history");
  const advisorEvaluationsDir = path.join(evcrateDir, "advisor-evaluations");
  const workspaceDir = path.join(hostStagingDir, "workspace");
  const projectDir = path.join(workspaceDir, projectName);

  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(advisorHistoryDir, { recursive: true });
  await fs.mkdir(advisorEvaluationsDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(hostStagingDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(hostStagingDir, "tmp"), { recursive: true });

  // 1. Server token file in ~/.config/dam-hopper/server-token
  await fs.writeFile(path.join(configDir, "server-token"), serverToken + "\n", { mode: 0o600 });

  // 2. MFA key file (64 hex characters, mode 0o600)
  await fs.writeFile(path.join(homeDir, "mfa.key"), mfaKeyHex + "\n", { mode: 0o600 });

  // 3. Advisor routing policy in ~/.evcrate/advisor-routing.json
  const canonicalRoutingPath = path.resolve(REPO_ROOT, "__fixtures__/native-advisor/advisor-routing.json");
  const initialPolicyJson = existsSync(canonicalRoutingPath)
    ? await fs.readFile(canonicalRoutingPath, "utf-8")
    : DEFAULT_POLICY;
  await fs.writeFile(path.join(evcrateDir, "advisor-routing.json"), initialPolicyJson, { mode: 0o600 });

  // 4. Copy canonical evaluation documents into ~/.evcrate/advisor-evaluations/
  const canonicalEvalsDir = path.resolve(REPO_ROOT, "__fixtures__/native-advisor/advisor-evaluations");
  if (existsSync(canonicalEvalsDir)) {
    const evalFiles = await fs.readdir(canonicalEvalsDir);
    for (const file of evalFiles) {
      if (file.endsWith(".json")) {
        const content = await fs.readFile(path.join(canonicalEvalsDir, file), "utf-8");
        await fs.writeFile(path.join(advisorEvaluationsDir, file), content, { mode: 0o600 });
      }
    }
  }

  // 5. Fixture workspace project files
  await fs.writeFile(path.join(projectDir, "README.md"), `# ${projectName}\nDeterministic E2E project workspace.\n`);
  await fs.writeFile(path.join(projectDir, "sample.txt"), "Hello from E2E isolated environment.\n");

  // 6. Root dam-hopper.toml for the container
  const tomlContent = `[workspace]\nname = "${workspaceName}"\n\n[server]\nsession_db_path = "/e2e/session.db"\n\n[server.advisor]\nenabled = false\n\n[[projects]]\nname = "${projectName}"\npath = "/e2e/workspace/${projectName}"\ntype = "custom"\n`;
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

  return { hostStagingDir, serverToken, mfaKeyHex, workspaceName, projectName, seedDigest, dispose };
}

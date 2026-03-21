import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BulkGitService, BuildService, RunService } from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

const MINIMAL_TOML = `
[workspace]
name = "test-ws"

[[projects]]
name = "proj-a"
path = "."
type = "custom"
`;

export async function createTestContext(
  overrides: Partial<ServerContext> = {},
): Promise<{ ctx: ServerContext; cleanup: () => Promise<void> }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-srv-test-"));
  const configPath = join(tmpDir, "dev-hub.toml");
  await writeFile(configPath, MINIMAL_TOML, "utf-8");

  // Use the real parser but with a temp directory
  const { readConfig } = await import("@dev-hub/core");
  const config = await readConfig(configPath);

  const bulkGitService = new BulkGitService();
  const buildService = new BuildService();
  const runService = new RunService();
  const sseClients = new Set<import("../services/context.js").SSEClient>();

  function broadcast(event: import("../services/context.js").SSEEvent) {
    for (const client of sseClients) {
      try {
        client.send(event);
      } catch {
        // ignore
      }
    }
  }

  const ctx: ServerContext = {
    config,
    configPath,
    workspaceRoot: tmpDir,
    bulkGitService,
    buildService,
    runService,
    sseClients,
    broadcast,
    ...overrides,
  };

  return {
    ctx,
    cleanup: () => rm(tmpDir, { recursive: true }),
  };
}

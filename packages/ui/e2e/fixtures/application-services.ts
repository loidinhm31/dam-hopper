import { randomUUID } from "node:crypto";
import {
  copyToContainer,
  execInContainer,
  getMappedPort,
  runEngine,
  stopAndRemoveContainer,
  removeNetwork,
} from "./container-client.js";
import { createSeedTree, type SeedTreeResult } from "./application-data.js";
import { waitForHealth, verifyServiceSafety } from "./application-readiness.js";
import { ensureApplicationImagesBuilt, APP_IMAGE_NAME } from "./image-builder.js";

export interface ApplicationServicesConfig {
  databaseName?: string;
  username?: string;
  mongoImage?: string;
  appImage?: string;
  port?: number;
}

export interface ApplicationServices {
  readonly networkId: string;
  readonly mongoContainerId: string;
  readonly appContainerId: string;
  readonly hostPort: number;
  readonly appOrigin: string;
  readonly token: string;
  readonly username: string;
  readonly sessionId: string;
  readonly databaseName: string;
  readonly serverToken: string;
  readonly seedDigest: string;
  readContainerFile(filePath: string): Promise<string>;
  readPolicyFile(): Promise<unknown>;
  fetchApi(endpoint: string, init?: RequestInit): Promise<Response>;
  dispose(): Promise<void>;
}

interface SeedOutput {
  token: string;
  username: string;
  sessionId: string;
  database: string;
  expiresAt: number;
}

/**
 * Starts isolated production application services (network, MongoDB, and app container).
 * Ensures deterministic seeding and verifies safety readiness before returning.
 */
export async function startApplicationServices(
  config: ApplicationServicesConfig = {},
): Promise<ApplicationServices> {
  const testId = randomUUID().slice(0, 8);
  const networkId = `dam-hopper-net-${testId}`;
  const mongoContainerId = `dam-hopper-mongo-${testId}`;
  const appContainerId = `dam-hopper-app-${testId}`;
  const databaseName = config.databaseName ?? `dam_hopper_e2e_${testId}`;
  const username = config.username ?? "admin";
  const mongoImage = config.mongoImage ?? process.env.E2E_MONGO_IMAGE ?? "docker.io/library/mongo:8.2";
  const appImage = config.appImage ?? APP_IMAGE_NAME;
  if (!config.appImage) {
    await ensureApplicationImagesBuilt();
  }

  let seedTree: SeedTreeResult | null = null;
  const ownedContainers: string[] = [];
  let ownedNetwork: string | null = null;
  let isDisposed = false;

  const cleanup = async () => {
    if (isDisposed) return;
    isDisposed = true;

    for (const cid of [...ownedContainers].reverse()) {
      await stopAndRemoveContainer(cid, 2);
    }
    if (ownedNetwork) {
      await removeNetwork(ownedNetwork);
    }
    if (seedTree) {
      await seedTree.dispose();
    }
  };

  const signalHandler = () => {
    cleanup().catch(() => {});
  };
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  try {
    seedTree = await createSeedTree();

    await runEngine(["network", "create", networkId]);
    ownedNetwork = networkId;

    await runEngine([
      "run",
      "-d",
      "--name",
      mongoContainerId,
      "--network",
      networkId,
      "--network-alias",
      "mongo",
      mongoImage,
    ]);
    ownedContainers.push(mongoContainerId);
    const { promise: mongoDelay, resolve: resolveMongo } = Promise.withResolvers<void>();
    setTimeout(resolveMongo, 1500);
    await mongoDelay;

    const portArg = config.port ? `127.0.0.1:${config.port}:4800` : "127.0.0.1::4800";
    await runEngine([
      "run",
      "-d",
      "--name",
      appContainerId,
      "--network",
      networkId,
      "-p",
      portArg,
      "--entrypoint",
      "/bin/sh",
      appImage,
      "-c",
      "sleep 3600",
    ]);
    ownedContainers.push(appContainerId);

    await execInContainer(appContainerId, ["mkdir", "-p", "/e2e"]);
    await copyToContainer(seedTree.hostStagingDir, appContainerId, "/e2e");
    await execInContainer(appContainerId, [
      "chmod",
      "0600",
      "/e2e/home/mfa.key",
      "/e2e/home/.config/dam-hopper/server-token",
    ]);

    const seedRaw = await execInContainer(appContainerId, [
      "/usr/local/bin/application_e2e_seed",
      "--mongodb-uri",
      "mongodb://mongo:27017",
      "--database",
      databaseName,
      "--server-token",
      seedTree.serverToken,
      "--username",
      username,
    ]);
    const seedOutput = JSON.parse(seedRaw) as SeedOutput;

    await runEngine([
      "exec",
      "-d",
      "-e",
      "HOME=/e2e/home",
      "-e",
      "XDG_CONFIG_HOME=/e2e/home/.config",
      "-e",
      "XDG_DATA_HOME=/e2e/home/.local/share",
      "-e",
      "XDG_STATE_HOME=/e2e/home/.local/state",
      "-e",
      "TMPDIR=/e2e/tmp",
      "-e",
      "MONGODB_URI=mongodb://mongo:27017",
      "-e",
      `MONGODB_DATABASE=${databaseName}`,
      "-e",
      "DAM_HOPPER_MFA_KEY_FILE=/e2e/home/mfa.key",
      appContainerId,
      "/bin/sh",
      "-c",
      "nohup dam-hopper-server --config /e2e/dam-hopper.toml --workspace /e2e/workspace --host 0.0.0.0 --port 4800 --web-dir /opt/dam-hopper/web > /e2e/logs/server.log 2>&1 &",
    ]);

    const hostPort = await getMappedPort(appContainerId, 4800);
    const appOrigin = `http://127.0.0.1:${hostPort}`;

    try {
      await waitForHealth(appOrigin);
    } catch (healthErr) {
      const serverLog = await execInContainer(appContainerId, ["cat", "/e2e/logs/server.log"]).catch(() => "failed to read server log");
      throw new Error(`${(healthErr as Error).message}\nServer log:\n${serverLog}`);
    }

    await verifyServiceSafety(appOrigin, seedOutput.token);

    return {
      networkId,
      mongoContainerId,
      appContainerId,
      hostPort,
      appOrigin,
      token: seedOutput.token,
      username: seedOutput.username,
      sessionId: seedOutput.sessionId,
      databaseName,
      serverToken: seedTree.serverToken,
      seedDigest: seedTree.seedDigest,
      readContainerFile(filePath: string): Promise<string> {
        return execInContainer(appContainerId, ["cat", filePath]);
      },
      async readPolicyFile(): Promise<unknown> {
        const raw = await execInContainer(appContainerId, [
          "cat",
          "/e2e/home/.evcrate/advisor-routing.json",
        ]);
        return JSON.parse(raw);
      },
      fetchApi(endpoint: string, init?: RequestInit): Promise<Response> {
        const headers = new Headers(init?.headers);
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${seedOutput.token}`);
        }
        return fetch(`${appOrigin}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`, {
          ...init,
          headers,
        });
      },
      async dispose(): Promise<void> {
        process.off("SIGINT", signalHandler);
        process.off("SIGTERM", signalHandler);
        await cleanup();
      },
    };
  } catch (err) {
    process.off("SIGINT", signalHandler);
    process.off("SIGTERM", signalHandler);
    await cleanup();
    throw err;
  }
}

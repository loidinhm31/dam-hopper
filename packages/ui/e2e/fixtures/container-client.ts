import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ENGINE_ENV = {
  ...process.env,
  HOME: process.env.HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
};

let resolvedEngine: string | null = null;

/**
 * Detects the available container engine: honors CONTAINER_ENGINE env var,
 * then checks `podman`, falling back to `docker`.
 */
export async function getContainerEngine(): Promise<string> {
  if (resolvedEngine) {
    return resolvedEngine;
  }
  if (process.env.CONTAINER_ENGINE?.trim()) {
    resolvedEngine = process.env.CONTAINER_ENGINE.trim();
    return resolvedEngine;
  }
  try {
    await execFileAsync("podman", ["--version"], { env: { ...process.env, ...ENGINE_ENV } });
    resolvedEngine = "podman";
    return resolvedEngine;
  } catch {
    resolvedEngine = "docker";
    return resolvedEngine;
  }
}

/**
 * Executes a container engine command with standard arguments and returns trimmed stdout.
 */
export async function runEngine(args: string[]): Promise<string> {
  const engine = await getContainerEngine();
  const { stdout } = await execFileAsync(engine, args, {
    env: { ...process.env, ...ENGINE_ENV },
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Executes a command inside a running container and returns stdout.
 */
export async function execInContainer(
  containerId: string,
  command: string[],
  env?: Record<string, string>,
): Promise<string> {
  const engine = await getContainerEngine();
  const args = ["exec"];
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      args.push("-e", `${k}=${v}`);
    }
  }
  args.push(containerId, ...command);
  const { stdout } = await execFileAsync(engine, args, {
    env: { ...process.env, ...ENGINE_ENV },
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Copies a local path into a container target directory.
 */
export async function copyToContainer(
  localPath: string,
  containerId: string,
  containerTarget: string,
): Promise<void> {
  const engine = await getContainerEngine();
  await execFileAsync(engine, ["cp", `${localPath}/.`, `${containerId}:${containerTarget}`], {
    env: { ...process.env, ...ENGINE_ENV },
  });
}

/**
 * Queries the dynamic loopback host port mapped to an exposed container port.
 */
export async function getMappedPort(containerId: string, internalPort: number): Promise<number> {
  const output = await runEngine(["port", containerId, `${internalPort}/tcp`]);
  // Output format example: "127.0.0.1:45678" or "0.0.0.0:45678"
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/:(\d+)$/);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }
  throw new Error(`Failed to find mapped port for ${containerId}:${internalPort}. Output: ${output}`);
}

/**
 * Gracefully stops and forcefully removes a container.
 */
export async function stopAndRemoveContainer(containerId: string, timeoutSec = 2): Promise<void> {
  try {
    await runEngine(["stop", "-t", String(timeoutSec), containerId]);
  } catch {
    // Continue to forceful rm if stop fails
  }
  try {
    await runEngine(["rm", "-f", containerId]);
  } catch {
    // Ignore error if container already removed
  }
}

/**
 * Removes an owned container network.
 */
export async function removeNetwork(networkId: string): Promise<void> {
  try {
    await runEngine(["network", "rm", networkId]);
  } catch {
    // Ignore error if network already removed
  }
}

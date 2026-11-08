import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

export interface QualificationServerInfo {
  readonly qualificationReady: boolean;
  readonly port: number;
  readonly httpUrl: string;
  readonly wsUrl: string;
  readonly expectedToken: string;
  readonly browserPid: number;
  readonly cleanup: () => Promise<void>;
}

/**
 * Prebuilds the Rust qualification example executable using cargo compiler-artifact stream.
 * Deadline: 600,000ms (10 minutes) independent from test run.
 */
export async function prebuildQualificationExample(): Promise<string> {
  const manifestPath = path.resolve(REPO_ROOT, "server/Cargo.toml");
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  const cargoProc = spawn(
    "cargo",
    ["build", "--manifest-path", manifestPath, "--example", "browser_host_qualification", "--message-format=json"],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "inherit"],
    }
  );

  let executablePath: string | null = null;
  let totalRawBytes = 0;
  const MAX_CARGO_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB limit

  // Enforce raw buffer byte cap before readline accumulation
  cargoProc.stdout.on("data", (chunk: Buffer) => {
    totalRawBytes += chunk.byteLength;
    if (totalRawBytes > MAX_CARGO_OUTPUT_BYTES) {
      clearTimeout(timer);
      cargoProc.stdout.destroy();
      cargoProc.kill("SIGKILL");
      reject(new Error(`prebuild raw output exceeded ${MAX_CARGO_OUTPUT_BYTES} bytes cap`));
    }
  });

  const rl = readline.createInterface({ input: cargoProc.stdout });

  rl.on("line", (line) => {
    try {
      const record = JSON.parse(line);
      if (
        record.reason === "compiler-artifact" &&
        record.target?.name === "browser_host_qualification"
      ) {
        executablePath = record.executable ?? (Array.isArray(record.filenames) ? record.filenames[0] : null);
      }
    } catch {
      // Ignore non-json or unparseable lines
    }
  });
  const timer = setTimeout(() => {
    cargoProc.kill("SIGKILL");
    reject(new Error("prebuildQualificationExample timed out after 600,000ms"));
  }, 600_000);

  cargoProc.on("exit", (code) => {
    clearTimeout(timer);
    if (code === 0 && executablePath) {
      resolve(executablePath);
    } else {
      reject(new Error(`cargo build failed with exit code ${code}, executable resolved: ${executablePath}`));
    }
  });

  cargoProc.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });

  return promise;
}

/**
 * Launches the qualification binary and waits for the qualificationReady JSON contract within 20s.
 */
export async function launchQualificationServer(
  executablePath: string,
  token = "test-qualification-token-secret"
): Promise<QualificationServerInfo> {
  const { promise, resolve, reject } = Promise.withResolvers<QualificationServerInfo>();

  const child: ChildProcess = spawn(executablePath, [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DAM_HOPPER_QUALIFICATION_TOKEN: token,
    },
    stdio: ["pipe", "pipe", "inherit"],
  });

  let buffer = "";
  let resolved = false;

  const timer = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      child.kill("SIGKILL");
      reject(new Error("launchQualificationServer timed out waiting for readiness (20s limit)"));
    }
  }, 20_000);

  child.stdout?.on("data", (chunk: Buffer) => {
    if (resolved) return;

    buffer += chunk.toString("utf8");
    if (buffer.length > 4096) {
      // Max 4KiB readiness contract
      resolved = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error("readiness output exceeded 4KiB without valid JSON contract"));
      return;
    }

    const lines = buffer.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{") && trimmed.includes('"qualificationReady"')) {
        try {
          const data = JSON.parse(trimmed);
          if (data.qualificationReady === true) {
            resolved = true;
            clearTimeout(timer);

            const cleanup = async () => {
              const cleanupResolvers = Promise.withResolvers<void>();

              // Gracefully close stdin to trigger the Rust supervisor's process-group termination
              if (child.stdin) {
                try {
                  child.stdin.end();
                } catch {}
              }

              const forceTimer = setTimeout(() => {
                try {
                  child.kill("SIGTERM");
                  setTimeout(() => {
                    try {
                      child.kill("SIGKILL");
                    } catch {}
                  }, 1000);
                } catch {}
              }, 4000);

              child.on("exit", () => {
                clearTimeout(forceTimer);
                cleanupResolvers.resolve();
              });
              return cleanupResolvers.promise;
            };

            resolve({
              qualificationReady: true,
              port: data.port,
              httpUrl: data.httpUrl,
              wsUrl: data.wsUrl,
              expectedToken: data.expectedToken,
              browserPid: data.browserPid,
              cleanup,
            });
            return;
          }
        } catch {
          // keep waiting
        }
      }
    }
  });

  child.on("exit", (code) => {
    if (!resolved) {
      clearTimeout(timer);
      reject(new Error(`qualification server exited prematurely with code ${code}`));
    }
  });

  child.on("error", (err) => {
    if (!resolved) {
      clearTimeout(timer);
      reject(err);
    }
  });

  return promise;
}

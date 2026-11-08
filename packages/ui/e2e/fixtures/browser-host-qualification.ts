import { spawn, execFile, execSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
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
  readonly childPid?: number;
  readonly cleanup: () => Promise<void>;
  readonly assertHealthy: () => void;
  readonly failurePromise: Promise<Error>;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const err = e as { code?: string };
    return err.code === "EPERM";
  }
}

function scanProcForPgid(pgid: number): number[] {
  if (!fs.existsSync("/proc")) {
    throw new Error("procfs is unavailable on this system");
  }
  const entries = fs.readdirSync("/proc");
  const pids: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${entry}/stat`, "utf8");
      const idx = stat.lastIndexOf(")");
      if (idx !== -1 && idx + 2 < stat.length) {
        const rest = stat.slice(idx + 2).split(" ");
        if (rest.length > 2 && Number.parseInt(rest[2], 10) === pgid) {
          pids.push(Number.parseInt(entry, 10));
        }
      }
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e.code === "ENOENT" || e.code === "ESRCH")) {
        continue;
      }
      throw e;
    }
  }
  return pids;
}

export function checkPgidProcesses(pgid: number): Promise<number[]> {
  const { promise, resolve, reject } = Promise.withResolvers<number[]>();
  execFile("pgrep", ["-g", String(pgid)], (err, stdout) => {
    if (err) {
      let exitCode: number | string | undefined;
      let isEnoent = false;
      if (err && typeof err === "object") {
        if ("status" in err && typeof err.status === "number") {
          exitCode = err.status;
        } else if ("code" in err && (typeof err.code === "number" || typeof err.code === "string")) {
          exitCode = err.code;
        }
        if ("code" in err && err.code === "ENOENT") {
          isEnoent = true;
        }
      }
      if (exitCode === 1) {
        // pgrep exit code 1 indicates no matching processes found
        resolve([]);
        return;
      }
      if (isEnoent) {
        // pgrep missing, fallback to /proc scan
        try {
          resolve(scanProcForPgid(pgid));
        } catch (procErr: unknown) {
          reject(procErr instanceof Error ? procErr : new Error(String(procErr)));
        }
        return;
      }
      // Any other error/exit code (>1, spawn failure) fails verification closed
      reject(new Error(`pgrep failed with code ${String(exitCode)}: ${err.message}`));
      return;
    }
    const pids = stdout
      .trim()
      .split("\n")
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((p) => Number.isFinite(p) && p > 0);
    resolve(pids);
  });
  return promise;
}

function checkWindowsPidAlive(pid: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  execFile("tasklist", ["/fi", `PID eq ${pid}`], (err, stdout) => {
    if (err || !stdout) {
      resolve(false);
    } else {
      resolve(stdout.includes(String(pid)));
    }
  });
  return promise;
}

function killGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code !== "ESRCH") {
      // Ignore ESRCH (process group does not exist)
    }
  }
}

/**
 * Terminates the whole process tree and verifies that no descendants survive.
 */
async function terminateProcessTree(child: ChildProcess, browserPid?: number): Promise<void> {
  const childPid = child.pid;
  if (!childPid) return;

  // Positive control check: record if verifier fails to see live child, but proceed with cleanup
  let positiveControlError: Error | null = null;
  if (process.platform !== "win32" && isProcessAlive(childPid)) {
    try {
      const liveGroup = await checkPgidProcesses(childPid);
      if (!liveGroup.includes(childPid)) {
        positiveControlError = new Error(
          `positive control failed: verifier could not observe live child ${childPid} in group ${childPid}`
        );
      }
    } catch (verifErr: unknown) {
      positiveControlError = verifErr instanceof Error ? verifErr : new Error(String(verifErr));
    }
  }
  // 1. Try graceful stdin close
  if (child.stdin && !child.stdin.destroyed) {
    try {
      child.stdin.end();
    } catch {}
  }

  // 2. Allow up to 2 seconds for graceful exit
  const gracefulDeadline = Date.now() + 2000;
  while (Date.now() < gracefulDeadline) {
    if (child.exitCode !== null || !isProcessAlive(childPid)) {
      break;
    }
    await sleep(50);
  }

  // 3. Force termination of process tree if still active
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${childPid} /T /F`);
    } catch {}
    if (browserPid) {
      try {
        execSync(`taskkill /pid ${browserPid} /T /F`);
      } catch {}
    }
  } else {
    // Unix: send SIGTERM then SIGKILL to recorded process groups and PIDs
    killGroup(childPid, "SIGTERM");
    if (browserPid) {
      killGroup(browserPid, "SIGTERM");
      try {
        process.kill(browserPid, "SIGTERM");
      } catch {}
    }
    await sleep(200);

    killGroup(childPid, "SIGKILL");
    if (browserPid) {
      killGroup(browserPid, "SIGKILL");
      try {
        process.kill(browserPid, "SIGKILL");
      } catch {}
    }
  }

  // 4. Prove no descendant survives
  let survivorProofError: Error | null = null;
  try {
    await proveNoDescendantsSurvive(childPid, browserPid);
  } catch (err: unknown) {
    survivorProofError = err instanceof Error ? err : new Error(String(err));
  }

  if (positiveControlError) {
    throw new Error(`${positiveControlError.message}; cleanup unproven`);
  }
  if (survivorProofError) {
    throw new Error(`${survivorProofError.message}; cleanup unproven`);
  }
}

async function proveNoDescendantsSurvive(childPid: number, browserPid?: number): Promise<void> {
  const timeoutMs = 5000;
  const deadline = Date.now() + timeoutMs;

  if (process.platform === "win32") {
    while (Date.now() < deadline) {
      const childAlive = await checkWindowsPidAlive(childPid);
      const browserAlive = browserPid ? await checkWindowsPidAlive(browserPid) : false;
      if (!childAlive && !browserAlive) {
        return;
      }
      await sleep(100);
    }
    throw new Error(`descendants still alive on Windows: child ${childPid}, browser ${browserPid}`);
  }

  // Unix procfs and pgrep verification
  while (Date.now() < deadline) {
    const childGroupPids = await checkPgidProcesses(childPid);
    const browserGroupPids = browserPid ? await checkPgidProcesses(browserPid) : [];
    const childProcExists = fs.existsSync(`/proc/${childPid}`);
    const browserProcExists = browserPid ? fs.existsSync(`/proc/${browserPid}`) : false;

    const remaining = Array.from(new Set([...childGroupPids, ...browserGroupPids]));
    if (remaining.length === 0 && !childProcExists && !browserProcExists) {
      return;
    }

    // Force SIGKILL to any detected survivors
    killGroup(childPid, "SIGKILL");
    if (browserPid) {
      killGroup(browserPid, "SIGKILL");
      try {
        process.kill(browserPid, "SIGKILL");
      } catch {}
    }
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }

    await sleep(50);
  }

  const finalChildPids = await checkPgidProcesses(childPid);
  const finalBrowserPids = browserPid ? await checkPgidProcesses(browserPid) : [];
  if (finalChildPids.length > 0 || finalBrowserPids.length > 0) {
    throw new Error(
      `failed to prove all descendants terminated: child group ${childPid} has [${finalChildPids.join(
        ","
      )}]; browser group ${browserPid} has [${finalBrowserPids.join(",")}]`
    );
  }
}

/**
 * Prebuilds the Rust qualification example executable using cargo compiler-artifact stream.
 * Deadline: 600,000ms (10 minutes) independent from test run.
 * Output bounded across stdout and stderr; stderr piped not inherited unbounded.
 */
export async function prebuildQualificationExample(): Promise<string> {
  const manifestPath = path.resolve(REPO_ROOT, "server/Cargo.toml");
  const { promise, resolve, reject } = Promise.withResolvers<string>();

  const isUnix = process.platform !== "win32";
  const cargoProc = spawn(
    "cargo",
    ["build", "--manifest-path", manifestPath, "--example", "browser_host_qualification", "--message-format=json"],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: isUnix,
    }
  );

  let executablePath: string | null = null;
  let totalRawBytes = 0;
  const MAX_CARGO_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MiB limit

  const onChunk = (chunk: Buffer) => {
    totalRawBytes += chunk.byteLength;
    if (totalRawBytes > MAX_CARGO_OUTPUT_BYTES) {
      clearTimeout(timer);
      cargoProc.stdout?.destroy();
      cargoProc.stderr?.destroy();
      if (cargoProc.pid) {
        killGroup(cargoProc.pid, "SIGKILL");
        try {
          cargoProc.kill("SIGKILL");
        } catch {}
      }
      reject(new Error(`prebuild raw output exceeded ${MAX_CARGO_OUTPUT_BYTES} bytes cap`));
    }
  };

  cargoProc.stdout?.on("data", onChunk);
  cargoProc.stderr?.on("data", onChunk);

  if (cargoProc.stdout) {
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
        // Ignore non-json lines
      }
    });
  }

  const timer = setTimeout(() => {
    if (cargoProc.pid) {
      killGroup(cargoProc.pid, "SIGKILL");
      try {
        cargoProc.kill("SIGKILL");
      } catch {}
    }
    reject(new Error("prebuildQualificationExample timed out after 600,000ms"));
  }, 600_000);

  // Wait on close (all stdio streams closed) rather than merely exit
  cargoProc.on("close", (code) => {
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
 * Both stdout and stderr are piped and bounded (continued post-readiness accounting).
 * Readiness line bounded to 4 KiB measured in raw bytes.
 * Process group is detached and descendant termination is proven on cleanup/failure.
 */
export async function launchQualificationServer(
  executablePath: string,
  token = "test-qualification-token-secret"
): Promise<QualificationServerInfo> {
  const { promise, resolve, reject } = Promise.withResolvers<QualificationServerInfo>();

  const isUnix = process.platform !== "win32";
  const child: ChildProcess = spawn(executablePath, [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DAM_HOPPER_QUALIFICATION_TOKEN: token,
    },
    stdio: ["pipe", "pipe", "pipe"],
    detached: isUnix,
  });

  let lineBuffer = Buffer.alloc(0);
  let settled = false;
  let terminated = false;
  let lifecycleError: Error | null = null;
  const failureDeferred = Promise.withResolvers<Error>();
  let resolvedBrowserPid: number | undefined;

  let stderrText = "";
  let totalStdoutBytes = 0;
  let totalStderrBytes = 0;
  const MAX_STREAM_BYTES = 10 * 1024 * 1024; // 10 MiB limit
  const MAX_READY_LINE_BYTES = 4096; // 4 KiB limit

  const handleFatalFailure = async (cause: Error) => {
    if (terminated) return;
    terminated = true;
    lifecycleError = cause;
    clearTimeout(timer);
    try {
      await terminateProcessTree(child, resolvedBrowserPid);
    } catch (cleanupErr: unknown) {
      const cleanupMsg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      lifecycleError = new Error(`${cause.message}; cleanup failure: ${cleanupMsg}`);
    }
    failureDeferred.resolve(lifecycleError);
    if (!settled) {
      settled = true;
      reject(lifecycleError);
    }
  };

  const timer = setTimeout(async () => {
    await handleFatalFailure(new Error("launchQualificationServer timed out waiting for readiness (20s limit)"));
  }, 20_000);
  child.stdout?.on("data", async (chunk: Buffer) => {
    totalStdoutBytes += chunk.byteLength;
    if (totalStdoutBytes > MAX_STREAM_BYTES) {
      await handleFatalFailure(new Error(`qualification server stdout exceeded ${MAX_STREAM_BYTES} bytes`));
      return;
    }

    if (settled) {
      return;
    }

    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x0a) {
        // newline
        const lineSlice = chunk.subarray(start, i);
        const completeLine = Buffer.concat([lineBuffer, lineSlice]);
        lineBuffer = Buffer.alloc(0);
        start = i + 1;

        if (completeLine.byteLength > MAX_READY_LINE_BYTES) {
          await handleFatalFailure(new Error(`readiness line exceeded ${MAX_READY_LINE_BYTES} bytes cap`));
          return;
        }

        const lineStr = completeLine.toString("utf8").trim();
        if (lineStr.startsWith("{") && lineStr.includes('"qualificationReady"')) {
          try {
            const data = JSON.parse(lineStr);
            if (data.qualificationReady === true) {
              settled = true;
              clearTimeout(timer);
              resolvedBrowserPid = typeof data.browserPid === "number" ? data.browserPid : undefined;

              const cleanup = async () => {
                if (!terminated) {
                  terminated = true;
                  await terminateProcessTree(child, resolvedBrowserPid);
                }
              };

              const assertHealthy = () => {
                if (lifecycleError) {
                  throw lifecycleError;
                }
              };

              resolve({
                qualificationReady: true,
                port: data.port,
                httpUrl: data.httpUrl,
                wsUrl: data.wsUrl,
                expectedToken: data.expectedToken,
                browserPid: data.browserPid,
                childPid: child.pid,
                cleanup,
                assertHealthy,
                failurePromise: failureDeferred.promise,
              });
              return;
            }
          } catch {
            // keep waiting
          }
        }
      }
    }

    if (start < chunk.length) {
      const remaining = chunk.subarray(start);
      lineBuffer = Buffer.concat([lineBuffer, remaining]);
      if (lineBuffer.byteLength > MAX_READY_LINE_BYTES) {
        await handleFatalFailure(new Error(`readiness line buffer exceeded ${MAX_READY_LINE_BYTES} bytes cap`));
        return;
      }
    }
  });

  child.stderr?.on("data", async (chunk: Buffer) => {
    stderrText += chunk.toString("utf8");
    totalStderrBytes += chunk.byteLength;
    if (totalStderrBytes > MAX_STREAM_BYTES) {
      await handleFatalFailure(new Error(`qualification server stderr exceeded ${MAX_STREAM_BYTES} bytes`));
    }
  });

  child.on("exit", async (code) => {
    if (!terminated) {
      await handleFatalFailure(
        new Error(`qualification server exited prematurely with code ${code}. Stderr: ${stderrText.slice(-2000)}`)
      );
    }
  });

  child.on("error", async (err) => {
    if (!terminated) {
      await handleFatalFailure(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return promise;
}

import { test as base, expect, chromium, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { createBrowserStorageState } from "./application-storage-state.js";
import { serveBrowserJourney } from "./host-browser-journey-target.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

export interface HostBrowserAppServer {
  readonly appOrigin: string;
  readonly appPort: number;
  readonly targetPageUrl: string;
  readonly targetPort: number;
  readonly adminToken: string;
  readonly adminUsername: string;
  readonly ordinaryToken: string;
  readonly ordinaryUsername: string;
  readonly foreignToken: string;
  readonly foreignUsername: string;
  readonly cleanup: () => Promise<void>;
  readonly browserExec: string;
  readonly tempRoot: string;
  readonly deniedRequestCount: () => number;
  readonly serverLog: () => string;
  readonly restartApi: () => Promise<void>;
}

export interface HostBrowserAppOptions {
  allowedOrigins?: string[];
  maxTargets?: number;
  allowAppOrigin?: boolean;
}

export function getFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const srv = net.createServer();
  srv.unref();
  srv.on("error", reject);
  srv.listen(0, "127.0.0.1", () => {
    const addr = srv.address();
    if (!addr || typeof addr === "string") {
      srv.close();
      reject(new Error("failed to allocate free port"));
      return;
    }
    const { port } = addr;
    srv.close(() => resolve(port));
  });
  return promise;
}

function isSafeExecutable(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return false;
    if (process.platform !== "win32" && (st.mode & 0o002) !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

export function findBrowserExecutable(): string | undefined {
  if (process.env.DAM_HOPPER_BROWSER_EXECUTABLE) {
    return process.env.DAM_HOPPER_BROWSER_EXECUTABLE;
  }
  const candidates = [
    "/usr/bin/google-chrome",
    chromium.executablePath(),
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  return candidates.find((p): p is string => Boolean(p && isSafeExecutable(p)));
}

function killGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // ignore ESRCH
  }
}

export async function prebuildBinaries(): Promise<{
  serverBin: string;
  seedBin: string;
}> {
  const manifestPath = path.resolve(REPO_ROOT, "server/Cargo.toml");
  const isUnix = process.platform !== "win32";
  const { promise, resolve, reject } = Promise.withResolvers<{
    serverBin: string;
    seedBin: string;
  }>();

  const proc = spawn(
    "cargo",
    [
      "build",
      "--manifest-path",
      manifestPath,
      "--bin",
      "dam-hopper-server",
      "--example",
      "application_e2e_seed",
      "--message-format=json",
    ],
    {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: isUnix,
    },
  );

  let serverBin: string | null = null;
  let seedBin: string | null = null;
  let totalBytes = 0;
  const MAX_CARGO_OUTPUT_BYTES = 16 * 1024 * 1024;

  const timer = setTimeout(() => {
    if (proc.pid) {
      killGroup(proc.pid, "SIGKILL");
      try {
        proc.kill("SIGKILL");
      } catch {}
    }
    reject(new Error("cargo prebuild timed out after 600,000ms"));
  }, 600_000);

  const trackBytes = (chunk: Buffer) => {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_CARGO_OUTPUT_BYTES) {
      clearTimeout(timer);
      if (proc.pid) killGroup(proc.pid, "SIGKILL");
      reject(new Error("cargo output exceeded 16 MiB cap"));
    }
  };

  proc.stdout?.on("data", trackBytes);
  proc.stderr?.on("data", trackBytes);

  if (proc.stdout) {
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        const rec = JSON.parse(line);
        if (rec.reason === "compiler-artifact") {
          const exe =
            rec.executable ??
            (Array.isArray(rec.filenames) ? rec.filenames[0] : null);
          if (rec.target?.name === "dam-hopper-server" && exe) {
            serverBin = exe;
          } else if (rec.target?.name === "application_e2e_seed" && exe) {
            seedBin = exe;
          }
        }
      } catch {
        // ignore non-json
      }
    });
  }

  proc.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0 && serverBin && seedBin) {
      resolve({ serverBin, seedBin });
    } else {
      reject(
        new Error(
          `cargo prebuild failed (exit=${code}, serverBin=${serverBin}, seedBin=${seedBin})`,
        ),
      );
    }
  });

  proc.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });

  return promise;
}

let webDistBuild: Promise<string> | undefined;

export function ensureWebDistBuilt(): Promise<string> {
  webDistBuild ??= buildWebDist();
  return webDistBuild;
}

async function buildWebDist(): Promise<string> {
  const webDist = path.resolve(REPO_ROOT, "apps/web/dist");
  const indexFile = path.join(webDist, "index.html");
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const proc = spawn("pnpm", ["--filter", "@dam-hopper/web", "build"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timer = setTimeout(() => {
    proc.kill("SIGKILL");
    reject(new Error("web build timed out after 180,000ms"));
  }, 180_000);
  proc.on("close", (code) => {
    clearTimeout(timer);
    if (code === 0 && fs.existsSync(indexFile)) {
      resolve(webDist);
    } else {
      reject(new Error(`web build failed with exit ${code}`));
    }
  });
  proc.on("error", (err) => {
    clearTimeout(timer);
    reject(err);
  });
  return promise;
}

function runCommand(
  bin: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const proc = spawn(bin, args, {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (d) => {
    stdout += d.toString();
  });
  proc.stderr?.on("data", (d) => {
    stderr += d.toString();
  });
  proc.on("close", (code) => {
    if (code === 0) resolve(stdout);
    else reject(new Error(`${bin} failed (${code}): ${stderr}`));
  });
  proc.on("error", reject);
  return promise;
}

export async function startHostBrowserAppServer(
  options: HostBrowserAppOptions = {},
): Promise<HostBrowserAppServer> {
  const browserExec = findBrowserExecutable();
  if (!browserExec) {
    throw new Error("No Chromium executable found for HostBrowserAppServer");
  }

  const [{ serverBin, seedBin }, webDist] = await Promise.all([
    prebuildBinaries(),
    ensureWebDistBuilt(),
  ]);

  // Start mock target HTTP server
  const targetPort = await getFreePort();
  const deniedPort = await getFreePort();
  const deniedOrigin = `http://127.0.0.1:${deniedPort}`;
  let deniedRequests = 0;
  const deniedHttpServer = http.createServer((_request, response) => {
    deniedRequests++;
    response.writeHead(200, {
      "Content-Type": "application/javascript",
      "Access-Control-Allow-Origin": "*",
    });
    response.end("self.forbiddenScriptExecuted = true;");
  });
  const deniedListen = Promise.withResolvers<void>();
  deniedHttpServer.listen(deniedPort, "127.0.0.1", () => deniedListen.resolve());
  await deniedListen.promise;
  const targetHttpServer = http.createServer((_req, res) => {
    if (serveBrowserJourney(_req, res, deniedOrigin)) return;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html>
<html>
  <head><title>Host Browser Target Test Page</title></head>
  <body style="margin:0;padding:40px;background:#ffffff;font-family:sans-serif;">
    <h1 id="target-title">Host Browser Target Test Page</h1>
    <div id="target-counter" data-count="0" style="font-size:24px;margin-bottom:20px;">Counter: 0</div>
    <button
      id="increment-btn"
      data-testid="e2e-increment-btn"
      onclick="const el=document.getElementById('target-counter');const c=parseInt(el.getAttribute('data-count'),10)+1;el.setAttribute('data-count',c);el.textContent='Counter: '+c;"
      style="width:240px;height:80px;font-size:20px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;"
    >Increment</button>
    <div style="margin-top:20px;">
      <input
        id="target-text-input"
        type="text"
        placeholder="Type here..."
        style="width:300px;height:40px;font-size:16px;padding:4px 8px;"
      />
    </div>
  </body>
</html>`);
  });

  const targetListen = Promise.withResolvers<void>();
  targetHttpServer.listen(targetPort, "127.0.0.1", () => targetListen.resolve());
  await targetListen.promise;
  const targetPageUrl = `http://127.0.0.1:${targetPort}/target`;

  const appPort = await getFreePort();
  const appOrigin = `http://127.0.0.1:${appPort}`;

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "dh-host-browser-app-"));
  const homeDir = path.join(tempRoot, "home");
  const configDir = path.join(homeDir, ".config", "dam-hopper");
  const workspaceDir = path.join(tempRoot, "workspace");
  const projectDir = path.join(workspaceDir, "test-project");
  const browserProfileRoot = path.join(tempRoot, "browser-profiles");

  await fsp.mkdir(configDir, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.mkdir(browserProfileRoot, { recursive: true, mode: 0o700 });
  await fsp.chmod(browserProfileRoot, 0o700);

  const serverToken = randomUUID().replace(/-/g, "");
  const mfaKeyHex = randomBytes(32).toString("hex");
  const sqlitePath = path.join(configDir, "auth.db");

  await fsp.writeFile(path.join(configDir, "server-token"), `${serverToken}\n`, {
    mode: 0o600,
  });
  await fsp.writeFile(path.join(homeDir, "mfa.key"), `${mfaKeyHex}\n`, {
    mode: 0o600,
  });
  await fsp.writeFile(path.join(projectDir, "README.md"), "# Host Browser App\n");

  const allowedOrigins = [
    `http://127.0.0.1:${targetPort}`,
    ...(options.allowAppOrigin ? [appOrigin] : []),
    ...(options.allowedOrigins ?? []),
  ];

  const toml = `[workspace]
name = "host-browser-app"
root = "${workspaceDir}"

[server]
session_db_path = "${path.join(tempRoot, "session.db")}"

[server.browser]
enabled = true
executable_path = "${browserExec}"
profile_root = "${browserProfileRoot}"
allowed_target_origins = ${JSON.stringify(allowedOrigins)}

[server.browser.budgets]
max_targets = ${options.maxTargets ?? 2}

[[projects]]
name = "test-project"
path = "${projectDir}"
type = "custom"
`;
  const configPath = path.join(tempRoot, "dam-hopper.toml");
  await fsp.writeFile(configPath, toml);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    XDG_DATA_HOME: path.join(homeDir, ".local", "share"),
    XDG_STATE_HOME: path.join(homeDir, ".local", "state"),
    DAM_HOPPER_LITE_MODE: "true",
    DAM_HOPPER_AUTH_SQLITE_PATH: sqlitePath,
    DAM_HOPPER_MFA_KEY_FILE: path.join(homeDir, "mfa.key"),
    DAM_HOPPER_CORS_ORIGINS: `${appOrigin},http://127.0.0.1:${targetPort}`,
    DAM_HOPPER_WEB_DIR: webDist,
    DAM_HOPPER_PUBLIC_SERVER_ORIGIN: appOrigin,
  };

  // 1. Seed Admin user
  const adminSeedJson = await runCommand(
    seedBin,
    [
      "--sqlite-path",
      sqlitePath,
      "--server-token",
      serverToken,
      "--username",
      "admin",
    ],
    env,
  );
  const adminSeeded = JSON.parse(adminSeedJson) as {
    token: string;
    username: string;
  };

  // 2. Seed Ordinary member user
  const ordinarySeedJson = await runCommand(
    seedBin,
    [
      "--sqlite-path",
      sqlitePath,
      "--server-token",
      serverToken,
      "--username",
      "member",
    ],
    env,
  );
  const ordinarySeeded = JSON.parse(ordinarySeedJson) as {
    token: string;
    username: string;
  };
  // Update role to 'user' in SQLite auth database
  await runCommand(
    "sqlite3",
    [sqlitePath, "UPDATE auth_users SET role = 'user' WHERE username = 'member';"],
    env,
  );

  // 3. Seed Foreign tenant user in separate db if needed or separate account
  const foreignSeedJson = await runCommand(
    seedBin,
    [
      "--sqlite-path",
      sqlitePath,
      "--server-token",
      serverToken,
      "--username",
      "foreign-user",
    ],
    env,
  );
  const foreignSeeded = JSON.parse(foreignSeedJson) as {
    token: string;
    username: string;
  };

  // Launch server process with web-dir enabled
  const isUnix = process.platform !== "win32";
  let serverOutput = "";
  const recordOutput = (data: Buffer) => {
    serverOutput = (serverOutput + data.toString()).slice(-1_048_576);
  };

  let currentServerProc: ChildProcess | null = null;
  const spawnServer = async (): Promise<void> => {
    const proc = spawn(
      serverBin,
      [
        "--config",
        configPath,
        "--host",
        "127.0.0.1",
        "--port",
        String(appPort),
        "--web-dir",
        webDist,
      ],
      {
        cwd: REPO_ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: isUnix,
      },
    );

    proc.stdout?.on("data", recordOutput);
    proc.stderr?.on("data", recordOutput);
    currentServerProc = proc;

    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${appOrigin}/api/auth/status`, {
          headers: { Authorization: `Bearer ${adminSeeded.token}` },
        });
        if (resp.status === 200) {
          ready = true;
          break;
        }
      } catch {
        // waiting
      }
      await sleep(250);
    }

    if (!ready) {
      if (proc.pid) {
        if (isUnix) killGroup(proc.pid, "SIGKILL");
        proc.kill("SIGKILL");
      }
      targetHttpServer.close();
      deniedHttpServer.close();
      throw new Error(`Server failed to boot within 30s. Output: ${serverOutput}`);
    }
  };

  await spawnServer();

  const restartApi = async (): Promise<void> => {
    if (currentServerProc && currentServerProc.pid) {
      if (isUnix) {
        killGroup(currentServerProc.pid, "SIGTERM");
        await sleep(500);
        killGroup(currentServerProc.pid, "SIGKILL");
      } else {
        currentServerProc.kill("SIGKILL");
      }
      currentServerProc = null;
    }
    await sleep(500);
    await spawnServer();
  };
  const cleanup = async () => {
    if (currentServerProc && currentServerProc.pid) {
      if (isUnix) {
        killGroup(currentServerProc.pid, "SIGTERM");
        await sleep(500);
        killGroup(currentServerProc.pid, "SIGKILL");
      } else {
        currentServerProc.kill("SIGKILL");
      }
      currentServerProc = null;
    }
    targetHttpServer.close();
    deniedHttpServer.close();
    try {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return {
    appOrigin,
    appPort,
    targetPageUrl,
    targetPort,
    adminToken: adminSeeded.token,
    adminUsername: adminSeeded.username,
    ordinaryToken: ordinarySeeded.token,
    ordinaryUsername: ordinarySeeded.username,
    foreignToken: foreignSeeded.token,
    foreignUsername: foreignSeeded.username,
    cleanup,
    browserExec,
    tempRoot,
    deniedRequestCount: () => deniedRequests,
    serverLog: () => serverOutput,
    restartApi,
  };
}

export interface HostBrowserAppFixtures {
  hostApp: HostBrowserAppServer;
  adminPage: Page;
  ordinaryPage: Page;
}

export const test = base.extend<HostBrowserAppFixtures>({
  hostApp: async ({}, use) => {
    const server = await startHostBrowserAppServer();
    try {
      await use(server);
    } finally {
      await server.cleanup();
    }
  },

  adminPage: async ({ browser, hostApp }, use) => {
    const profileId = randomUUID();
    const storageState = createBrowserStorageState({
      appOrigin: hostApp.appOrigin,
      profileId,
      token: hostApp.adminToken,
      username: hostApp.adminUsername,
    });
    const context = await browser.newContext({
      storageState,
      baseURL: hostApp.appOrigin,
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await page.close();
      await context.close();
    }
  },

  ordinaryPage: async ({ browser, hostApp }, use) => {
    const profileId = randomUUID();
    const storageState = createBrowserStorageState({
      appOrigin: hostApp.appOrigin,
      profileId,
      token: hostApp.ordinaryToken,
      username: hostApp.ordinaryUsername,
    });
    const context = await browser.newContext({
      storageState,
      baseURL: hostApp.appOrigin,
    });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await page.close();
      await context.close();
    }
  },
});

export { expect };

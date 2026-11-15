import { test, expect } from "@playwright/test";
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
import { createBrowserStorageState } from "../fixtures/application-storage-state.js";
import { findBrowserExecutable } from "../fixtures/host-browser-app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");

function getFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const srv = net.createServer();
  srv.unref();
  srv.on("error", reject);
  srv.listen(0, "127.0.0.1", () => {
    const addr = srv.address();
    if (!addr || typeof addr === "string") {
      srv.close();
      reject(new Error("failed to allocate port"));
      return;
    }
    const { port } = addr;
    srv.close(() => resolve(port));
  });
  return promise;
}


function killGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // ignore ESRCH
  }
}

async function prebuildBinaries(): Promise<{
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

async function ensureWebDistBuilt(): Promise<string> {
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

test.describe("Host Browser Managed CDP Selection & Atomic Terminal Handoff E2E", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.use({ viewport: { width: 1440, height: 900 }, actionTimeout: 10_000 });
  let tempRoot: string;
  let serverProc: ChildProcess | null = null;
  let targetHttpServer: http.Server | null = null;
  let appOrigin = "";
  let targetPageUrl = "";
  let authToken = "";
  let username = "admin";
  let browserExec: string | undefined;
  let btnClickHits = 0;
  test.beforeAll(async () => {
    test.setTimeout(660_000);
    browserExec = findBrowserExecutable();
    if (!browserExec) {
      throw new Error(
        "No Chromium executable found for Host Browser E2E selection spec",
      );
    }

    const [{ serverBin, seedBin }, webDist] = await Promise.all([
      prebuildBinaries(),
      ensureWebDistBuilt(),
    ]);

    // Start local target HTML page with visible button and secret password field
    const targetPort = await getFreePort();
    targetHttpServer = http.createServer((req, res) => {
      const urlPath = req.url ?? "/target";
      if (urlPath.startsWith("/btn-clicked")) {
        btnClickHits += 1;
        res.writeHead(204);
        res.end();
        return;
      }
      if (urlPath.startsWith("/subframe")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><body><script>history.replaceState(null, "", "/subframe?v=1");</script></body></html>`);
        return;
      }
      if (urlPath.startsWith("/interaction-audio")) {
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!doctype html>
<html>
  <head><title>Interaction & Audio Page</title></head>
  <body style="margin:0;padding:40px;background:#ffffff;font-family:monospace;">
    <p id="selectable-copy" style="margin:0 0 24px 0;font-size:28px;line-height:40px;width:560px;user-select:text;">SelectThisExactPhraseWithMouse</p>
    <button
      id="cancel-verify-btn"
      style="display:block;width:300px;height:100px;font-size:24px;background:#16a34a;color:#fff;border:none;border-radius:8px;"
      onclick="window.__clicks=(window.__clicks||0)+1;this.textContent='Clicks: '+window.__clicks;fetch('/btn-clicked');"
    >Clicks: 0</button>
    <video id="auto-video" autoplay playsinline style="width:120px;height:60px;"></video>
    <iframe src="/subframe" style="width:1px;height:1px;border:0;"></iframe>
    <script>
      window.__clicks = 0;
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 440;
      const dst = ac.createMediaStreamDestination();
      osc.connect(dst);
      osc.start();
      const v = document.getElementById("auto-video");
      v.srcObject = dst.stream;
      v.play().catch(() => {});
    </script>
  </body>
</html>`);
        }, 350);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head><title>Selection Target Page</title></head>
  <body style="margin:0;padding:40px;background:#ffffff;font-family:sans-serif;">
    <button
      id="target-action-btn"
      data-testid="e2e-target-btn"
      aria-label="Deploy Action"
      style="display:block;width:360px;height:140px;font-size:28px;background:#2563eb;color:#fff;border:none;border-radius:8px;"
    >Deploy Action</button>
    <input
      id="secret-pwd"
      type="password"
      value="TOP_SECRET_PASSWORD_123"
      style="margin-top:24px;width:300px;height:40px;"
    />
  </body>
</html>`);
    });
    const targetListen = Promise.withResolvers<void>();
    targetHttpServer!.listen(targetPort, "127.0.0.1", () => targetListen.resolve());
    await targetListen.promise;
    targetPageUrl = `http://127.0.0.1:${targetPort}/target`;

    const appPort = await getFreePort();
    appOrigin = `http://127.0.0.1:${appPort}`;

    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "dh-sel-e2e-"));
    const homeDir = path.join(tempRoot, "home");
    const configDir = path.join(homeDir, ".config", "dam-hopper");
    const workspaceDir = path.join(tempRoot, "workspace");
    const projectDir = path.join(workspaceDir, "sel-project");
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
    await fsp.writeFile(path.join(projectDir, "README.md"), "# Selection E2E\n");

    const toml = `[workspace]
name = "sel-e2e"
root = "${workspaceDir}"

[server]
session_db_path = "${path.join(tempRoot, "session.db")}"

[server.browser]
enabled = true
executable_path = "${browserExec}"
profile_root = "${browserProfileRoot}"
allowed_target_origins = ["http://127.0.0.1:${targetPort}"]

[[projects]]
name = "sel-project"
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
    };
    const seedJson = await runCommand(
      seedBin,
      [
        "--sqlite-path",
        sqlitePath,
        "--server-token",
        serverToken,
        "--username",
        username,
      ],
      env,
    );
    const seeded = JSON.parse(seedJson) as {
      token: string;
      username: string;
    };
    authToken = seeded.token;
    username = seeded.username;

    serverProc = spawn(
      serverBin,
      [
        "--config",
        configPath,
        "--workspace",
        workspaceDir,
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
        detached: process.platform !== "win32",
      },
    );
    let serverOutput = "";
    const recordOutput = (chunk: Buffer) => {
      serverOutput = (serverOutput + chunk.toString()).slice(-65_536);
    };
    serverProc.stdout?.on("data", recordOutput);
    serverProc.stderr?.on("data", recordOutput);
    let earlyExit: string | null = null;
    serverProc.once("exit", (code, signal) => {
      earlyExit = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    });

    // Wait for readiness (/api/health within 20s)
    const readyDeadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      if (earlyExit !== null) {
        break;
      }
      try {
        const res = await fetch(`${appOrigin}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // retry
      }
      await sleep(150);
    }
    if (!ready) {
      throw new Error(
        `dam-hopper-server failed readiness check within 20s (${earlyExit ?? "still running"}). Output:\n${serverOutput}`,
      );
    }
  });

  test.afterAll(async () => {
    if (serverProc?.pid) {
      killGroup(serverProc.pid, "SIGTERM");
      await sleep(300);
      killGroup(serverProc.pid, "SIGKILL");
    }
    if (targetHttpServer) {
      const closeWait = Promise.withResolvers<void>();
      targetHttpServer.close(() => closeWait.resolve());
      await closeWait.promise;
    }
    if (tempRoot && fs.existsSync(tempRoot)) {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test.afterEach(async () => {
    if (!appOrigin || !authToken) return;
    try {
      const listRes = await fetch(`${appOrigin}/api/browser/sessions`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!listRes.ok) return;
      const rows = (await listRes.json()) as Array<{ browserSessionId?: string }>;
      for (const row of rows) {
        if (row.browserSessionId) {
          await fetch(`${appOrigin}/api/browser/sessions/${encodeURIComponent(row.browserSessionId)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authToken}` },
          });
        }
      }
    } catch {
      // ignore cleanup failures when server is down
    }
  });

  test("post-cutover SPA selects DOM element via CDP Overlay, creates PNG artifact, blocks replaced terminal, and inserts reference to live terminal", async ({
    browser,
  }) => {
    const profileId = randomUUID();
    const storageState = createBrowserStorageState({
      appOrigin,
      profileId,
      token: authToken,
      username,
    });
    const context = await browser.newContext({
      storageState,
      baseURL: appOrigin,
    });
    const page = await context.newPage();
    try {
      await page.goto(`${appOrigin}/`);
      const osShell = page.locator("[data-os-shell='true']").first();
      await expect(osShell).toBeVisible({ timeout: 20_000 });

      // 1. Open a live Terminal window from Dock
      const dockTerminalBtn = page
        .locator("aside[aria-label='Application Dock'] button[title='Terminals']")
        .first();
      await expect(dockTerminalBtn).toBeVisible({ timeout: 10_000 });
      await dockTerminalBtn.click();

      const initialTermFrame = page
        .locator("[data-os-window-frame]")
        .filter({ has: page.locator("[data-terminal-container], .xterm") })
        .first();
      await expect(initialTermFrame).toBeVisible({ timeout: 15_000 });
      const termWindowId = await initialTermFrame.getAttribute("data-os-window-frame");
      expect(termWindowId).toBeTruthy();
      const termFrame = page.locator(`[data-os-window-frame="${termWindowId}"]`);
      // 2. Open a Browser window from Applications Launcher
      const appsTrigger = page.locator('[data-testid="dock-apps-trigger"]').first();
      await expect(appsTrigger).toBeVisible({ timeout: 10_000 });
      await appsTrigger.click();
      const browserCard = page.locator('[data-testid="app-card-browser"]').first();
      await expect(browserCard).toBeVisible({ timeout: 10_000 });
      await browserCard.click();
      const urlInput = page
        .locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]')
        .first();
      await expect(urlInput).toBeVisible({ timeout: 15_000 });
      await urlInput.fill(targetPageUrl);
      const openBtn = page.locator('[data-testid="browser-new-tab-open-btn"]').first();
      if (await openBtn.isVisible()) {
        await openBtn.click();
      } else {
        await urlInput.press("Enter");
      }
      const browserSlot = page.locator('[data-os-browser-slot]').first();
      await expect(browserSlot).toBeVisible({ timeout: 15_000 });

      // Wait for first decoded frame on the browser canvas (ensures attachment & viewerId ready)
      const canvas = browserSlot.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () =>
            canvas.evaluate((el) => {
              const c = el as HTMLCanvasElement;
              return c.width > 0 && c.height > 0;
            }),
          { timeout: 15_000 },
        )
        .toBe(true);

      // Open Tools & Recovery panel
      const toolsToggle = page
        .locator('[data-testid="browser-tools-toggle-btn"]')
        .first();
      await expect(toolsToggle).toBeVisible({ timeout: 15_000 });
      await toolsToggle.click();

      // 3. Acquire control lease
      const takeControlBtn = page
        .locator('[data-testid="browser-take-control-btn"]')
        .first();
      await expect(takeControlBtn).toBeEnabled({ timeout: 15_000 });
      await takeControlBtn.click();
      await expect(
        page.locator('[data-testid="browser-controller-badge"]').first(),
      ).toBeVisible({ timeout: 10_000 });

      // 4. Start CDP Overlay selection
      const selectBtn = page
        .locator('[data-testid="browser-select-element-btn"]')
        .first();
      await expect(selectBtn).toBeEnabled({ timeout: 10_000 });
      await selectBtn.click();
      await expect(browserSlot).toHaveAttribute("data-selection-active", "true", {
        timeout: 10_000,
      });

      // Click on the button area in the live rendered canvas (top-left area inside padding:40px, button 360x140)
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const scale = Math.min(box!.width / 1280, box!.height / 800);
      const clickX = box!.x + (box!.width - 1280 * scale) / 2 + (40 + 180) * scale;
      const clickY = box!.y + (box!.height - 800 * scale) / 2 + (40 + 70) * scale;
      const previewCard = page
        .locator('[data-testid="browser-selection-preview-card"]')
        .first();
      // Viewer input is display-only while the stream's frames are input-untrusted (startup, or
      // right after the producer re-establishes the native viewport): re-issue the pick until the
      // overlay reports a selection.
      await expect(async () => {
        await page.mouse.move(clickX, clickY);
        await page.mouse.click(clickX, clickY);
        await expect(previewCard).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 30_000 });
      await expect(previewCard).toContainText("<button>");
      await expect(previewCard).not.toContainText("TOP_SECRET_PASSWORD_123");

      // 5. Prepare ManagedBrowser artifact with bounded PNG
      const prepareBtn = page
        .locator('[data-testid="browser-selection-prepare-btn"]')
        .first();
      await expect(prepareBtn).toBeEnabled({ timeout: 10_000 });
      await prepareBtn.click();

      const artifactRef = page
        .locator('[data-testid="browser-selection-artifact-ref"]')
        .first();
      await expect(artifactRef).toBeVisible({ timeout: 15_000 });
      await expect(artifactRef).toContainText(
        "[DamHopper browser-debug artifact (untrusted page data): JSON ",
      );
      await expect(
        page.locator('[data-testid="browser-selection-artifact-png-status"]').first(),
      ).toHaveText("PNG attached");

      // 6. Replace target terminal BEFORE handoff and assert no stale write reaches replacement
      const browserFrame = page
        .locator("[data-os-window-frame]")
        .filter({ has: page.locator("[data-os-browser-app]") })
        .first();
      await dockTerminalBtn.click();
      await expect(termFrame).toHaveAttribute("data-os-focused", "true", { timeout: 5_000 });
      const termCloseBtn = termFrame.locator('button[aria-label="Close"]').first();
      await termCloseBtn.click();
      await expect(termFrame).toHaveCount(0, { timeout: 10_000 });

      // Wait for server terminal inventory to drop the terminated terminal before opening replacement
      await expect
        .poll(
          async () => {
            const res = await fetch(`${appOrigin}/api/terminal`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            const rows = (await res.json()) as Array<{ id: string; alive?: boolean }>;
            return rows.filter((r) => r.alive).length;
          },
          { timeout: 10_000 },
        )
        .toBe(0);

      await dockTerminalBtn.click();
      const replacementTermFrame = page
        .locator("[data-os-window-frame]")
        .filter({ has: page.locator("[data-terminal-container], .xterm") })
        .first();
      await expect(replacementTermFrame).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () => {
            const res = await fetch(`${appOrigin}/api/terminal`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            const rows = (await res.json()) as Array<{ id: string; alive?: boolean }>;
            return rows.filter((r) => r.alive).length;
          },
          { timeout: 10_000 },
        )
        .toBe(1);
      // Re-focus Browser Preview floating frame via Dock before clicking handoff
      await page.locator('[data-testid="dock-item-browser"]').first().click();
      await expect(browserFrame).toHaveAttribute("data-os-focused", "true", { timeout: 5_000 });
      const handoffBtn = page
        .locator('[data-testid="browser-selection-handoff-btn"]')
        .first();
      await handoffBtn.click();
      await expect(
        page.locator('[data-testid="browser-selection-error"]').first(),
      ).toBeVisible({ timeout: 10_000 });
      // Assert NO artifact bytes leaked to any active terminal after stale handoff refusal
      const afterStaleList = await fetch(`${appOrigin}/api/terminal`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const activeAfterStale = (
        (await afterStaleList.json()) as Array<{ id: string; alive?: boolean }>
      ).filter((s) => s.alive);
      for (const s of activeAfterStale) {
        const bufRes = await fetch(
          `${appOrigin}/api/terminal/${encodeURIComponent(s.id)}/buffer`,
          { headers: { Authorization: `Bearer ${authToken}` } },
        );
        if (bufRes.ok) {
          const body = (await bufRes.json()) as { buffer?: string };
          const normalized = (body.buffer ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/[\r\n]/g, "");
          expect(normalized).not.toContain("DamHopper browser-debug artifact");
        }
      }

      // 7. Re-prepare artifact for the live replacement terminal and insert successfully
      await expect(prepareBtn).toBeEnabled({ timeout: 10_000 });
      await prepareBtn.click();
      await expect(artifactRef).toBeVisible({ timeout: 15_000 });
      await expect(
        page.locator('[data-testid="browser-selection-artifact-png-status"]').first(),
      ).toHaveText("PNG attached");

      const liveHandoffBtn = page
        .locator('[data-testid="browser-selection-handoff-btn"]')
        .first();
      await liveHandoffBtn.click();
      await expect(liveHandoffBtn).toHaveText("Inserted", { timeout: 10_000 });

      // Verify live terminal buffer on server contains the artifact reference and NOT untrusted secret text
      let matchedBuffer = "";
      await expect
        .poll(
          async () => {
            const listRes = await fetch(`${appOrigin}/api/terminal`, {
              headers: { Authorization: `Bearer ${authToken}` },
            });
            const sessions = (
              (await listRes.json()) as Array<{ id: string; alive?: boolean }>
            ).filter((s) => s.alive);
            for (const s of sessions) {
              const bufRes = await fetch(
                `${appOrigin}/api/terminal/${encodeURIComponent(s.id)}/buffer`,
                { headers: { Authorization: `Bearer ${authToken}` } },
              );
              if (bufRes.ok) {
                const body = (await bufRes.json()) as { buffer?: string };
                const normalized = (body.buffer ?? "")
                  .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
                  .replace(/[\r\n]/g, "");
                if (
                  normalized.includes(
                    "[DamHopper browser-debug artifact (untrusted page data): JSON ",
                  )
                ) {
                  matchedBuffer = normalized;
                  return normalized;
                }
              }
            }
            return "";
          },
          { timeout: 10_000 },
        )
        .toContain("; PNG ");
      expect(matchedBuffer).not.toContain("TOP_SECRET_PASSWORD_123");
    } finally {
      await context.close();
    }
  });

  test("supports mouse-drag text selection, deactivates Select Element on Cancel Select, and streams audio on first page open", async ({
    browser,
  }) => {
    const profileId = randomUUID();
    const storageState = createBrowserStorageState({
      appOrigin,
      profileId,
      token: authToken,
      username,
    });
    const context = await browser.newContext({
      storageState,
      baseURL: appOrigin,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const audioChunks: Array<{ docEpoch: string; audioSeq: string }> = [];
    page.on("websocket", (ws) => {
      if (new URL(ws.url()).pathname === "/api/browser/media") {
        ws.on("framereceived", ({ payload }) => {
          if (typeof payload !== "string") return;
          try {
            const msg = JSON.parse(payload) as { kind?: string; docEpoch?: string; audioSeq?: string };
            if (msg.kind === "audioChunk") {
              audioChunks.push({ docEpoch: String(msg.docEpoch ?? ""), audioSeq: String(msg.audioSeq ?? "") });
            }
          } catch {
            // ignore non-json
          }
        });
      }
    });

    try {
      const interactionUrl = targetPageUrl.replace(/\/target$/, "/interaction-audio");
      await page.goto(`${appOrigin}/`);
      await expect(page.locator("[data-os-shell='true']").first()).toBeVisible({ timeout: 20_000 });

      // Open Browser window from Applications Launcher
      await page.locator('[data-testid="dock-apps-trigger"]').first().click();
      await page.locator('[data-testid="app-card-browser"]').first().click();
      const urlInput = page
        .locator('[data-testid="browser-new-tab-url-input"], [data-testid="browser-address-input"]')
        .first();
      await expect(urlInput).toBeVisible({ timeout: 15_000 });
      await urlInput.fill(interactionUrl);
      const openBtn = page.locator('[data-testid="browser-new-tab-open-btn"]').first();
      if (await openBtn.isVisible()) {
        await openBtn.click();
      } else {
        await urlInput.press("Enter");
      }

      const browserSlot = page.locator("[data-os-browser-slot]").first();
      await expect(browserSlot).toBeVisible({ timeout: 15_000 });
      const canvas = browserSlot.locator("canvas").first();
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(
          async () =>
            canvas.evaluate((el) => {
              const c = el as HTMLCanvasElement;
              return c.width > 0 && c.height > 0;
            }),
          { timeout: 15_000 },
        )
        .toBe(true);

      // 3) Verify audio chunks arrive on first page open (with docEpoch "1", slow initial response, and iframe history.replaceState)
      await expect
        .poll(() => audioChunks.some((c) => c.docEpoch === "1"), { timeout: 15_000 })
        .toBe(true);

      // Open Tools & acquire control
      await page.locator('[data-testid="browser-tools-toggle-btn"]').first().click();
      const takeControlBtn = page.locator('[data-testid="browser-take-control-btn"]').first();
      await expect(takeControlBtn).toBeEnabled({ timeout: 15_000 });
      await takeControlBtn.click();
      await expect(page.locator('[data-testid="browser-controller-badge"]').first()).toBeVisible({
        timeout: 10_000,
      });

      // 1) Drag mouse across #selectable-copy text on streamed canvas and verify selected text via Copy Selection
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const scale = Math.min(box!.width / 1280, box!.height / 800);
      const imgLeft = box!.x + (box!.width - 1280 * scale) / 2;
      const imgTop = box!.y + (box!.height - 800 * scale) / 2;

      const dragStartX = imgLeft + 38 * scale;
      const dragEndX = imgLeft + 560 * scale;
      const dragY = imgTop + 60 * scale;
      await page.mouse.move(dragStartX, dragY);
      await page.mouse.down();
      await page.mouse.move(dragEndX, dragY, { steps: 10 });
      await page.mouse.up();

      const copyBtn = page.locator('[data-testid="browser-copy-selection-btn"]').first();
      await expect(copyBtn).toBeEnabled({ timeout: 10_000 });
      await copyBtn.click();
      const copyStatus = page.locator('[data-testid="browser-copy-selection-status"]').first();
      await expect(copyStatus).toContainText("Copied", { timeout: 10_000 });
      const copiedText = await page.evaluate(() => navigator.clipboard.readText());
      expect(copiedText.length).toBeGreaterThan(0);
      expect("SelectThisExactPhraseWithMouse").toContain(copiedText.trim());
      const selectBtn = page.locator('[data-testid="browser-select-element-btn"]').first();
      const startResPromise = page.waitForResponse(
        (r) => r.url().includes("/selection/start") && r.request().method() === "POST",
      );
      await selectBtn.click();
      const startRes = await startResPromise;
      expect(startRes.status()).toBe(200);
      await expect(browserSlot).toHaveAttribute("data-selection-active", "true", { timeout: 10_000 });
      await expect(selectBtn).toHaveText("Cancel Select");

      const cancelResPromise = page.waitForResponse(
        (r) => r.url().includes("/selection/cancel") && r.request().method() === "POST",
      );
      await selectBtn.click();
      const cancelRes = await cancelResPromise;
      expect(cancelRes.status()).toBe(200);
      await expect(browserSlot).toHaveAttribute("data-selection-active", "false", { timeout: 10_000 });
      await expect(selectBtn).toHaveText("Select Element");

      // Click #cancel-verify-btn (x=40..340, y=104..204) -> must hit /btn-clicked on remote page and NOT open selection preview
      btnClickHits = 0;
      const btnX = imgLeft + (40 + 150) * scale;
      const btnY = imgTop + (104 + 50) * scale;
      await page.mouse.click(btnX, btnY);
      await expect.poll(() => btnClickHits, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      await expect(page.locator('[data-testid="browser-selection-preview-card"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

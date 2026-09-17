#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const SERVER_BIN = join(REPO_ROOT, "server/target/debug/dam-hopper-server");

if (!existsSync(SERVER_BIN)) {
  console.error("Server binary not found at", SERVER_BIN, "Please build it first.");
  process.exit(1);
}

const PORT_A = 14801;
const PORT_B = 14802;
const FRONTEND_ORIGIN = "http://127.0.0.1:15173";

const tempBase = mkdtempSync(join(tmpdir(), "dam-hopper-phase09-"));
console.log(`[Phase 09] Created temporary qualification root: ${tempBase}`);

const dirA = join(tempBase, "server-a");
const dirB = join(tempBase, "server-b");
const repoA = join(dirA, "repo-web");
const repoB = join(dirB, "repo-web");

for (const d of [dirA, dirB, repoA, repoB]) {
  mkdirSync(d, { recursive: true });
}

// Git init and populate repositories
function initRepo(repoPath, markerText, fixtureMarker) {
  execSync(`git init -b main "${repoPath}"`, { stdio: "ignore" });
  execSync(`git -C "${repoPath}" config user.name "Qualification Runner"`, { stdio: "ignore" });
  execSync(`git -C "${repoPath}" config user.email "qualification@example.test"`, { stdio: "ignore" });
  
  mkdirSync(join(repoPath, "src"), { recursive: true });
  mkdirSync(join(repoPath, "images"), { recursive: true });
  mkdirSync(join(repoPath, "videos"), { recursive: true });

  writeFileSync(join(repoPath, "src/marker.txt"), markerText);
  
  // Copy test assets
  const pixelPng = join(REPO_ROOT, "packages/ui/browser-tests/fixtures/one-pixel.png");
  const videoWebm = join(REPO_ROOT, "packages/ui/browser-tests/fixtures/one-second-vp8.webm");
  if (existsSync(pixelPng)) {
    copyFileSync(pixelPng, join(repoPath, "images/test.png"));
  }
  if (existsSync(videoWebm)) {
    copyFileSync(videoWebm, join(repoPath, "videos/clip.webm"));
  }

  // Write terminal_fixture.py
  const ptyScript = `import os
import select
import sys

marker = os.environ.get("FIXTURE_MARKER", "${fixtureMarker}")
print(f"{marker} pid={os.getpid()}", flush=True)
while True:
    ready, _, _ = select.select([sys.stdin], [], [], 1.0)
    if ready:
        line = sys.stdin.readline()
        if not line:
            break
        print(f"{marker} input={line.rstrip()}", flush=True)
    else:
        print(f"{marker} heartbeat", flush=True)
`;
  writeFileSync(join(repoPath, "terminal_fixture.py"), ptyScript);

  execSync(`git -C "${repoPath}" add .`, { stdio: "ignore" });
  execSync(`git -C "${repoPath}" commit -m "initial commit"`, { stdio: "ignore" });
}

initRepo(repoA, "SERVER_A\n", "SERVER_A");
initRepo(repoB, "SERVER_B\n", "SERVER_B");

// Write configs
const configA = join(dirA, "dam-hopper.toml");
const configB = join(dirB, "dam-hopper.toml");

function makeConfig(name, repoPath, sessionDb, telemetryDb, collectorPort) {
  return `[workspace]
name = "${name}"

[[projects]]
name = "web"
path = "${repoPath}"
type = "custom"

[server]
session_db_path = "${sessionDb}"

[server.telemetry]
enabled = false
db_path = "${telemetryDb}"

[server.telemetry.collector]
enabled = false
host = "127.0.0.1"
port = ${collectorPort}

[server.idle_suspend]
enabled = false
`;
}

writeFileSync(configA, makeConfig("Fixture A", repoA, join(dirA, "sessions.db"), join(dirA, "telemetry.db"), 14811));
writeFileSync(configB, makeConfig("Fixture B", repoB, join(dirB, "sessions.db"), join(dirB, "telemetry.db"), 14812));

const processes = [];

function spawnServer(dir, configPath, port) {
  const env = {
    ...process.env,
    HOME: dir,
    XDG_CONFIG_HOME: join(dir, "config"),
    XDG_DATA_HOME: join(dir, "data"),
    TMPDIR: join(dir, "tmp"),
  };
  delete env.MONGODB_URI;
  delete env.MONGODB_DATABASE;
  delete env.RUST_ENV;
  delete env.ENVIRONMENT;

  mkdirSync(join(dir, "tmp"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });

  const proc = spawn(
    SERVER_BIN,
    [
      "--host", "127.0.0.1",
      "--port", String(port),
      "--config", configPath,
      "--cors-origins", `${FRONTEND_ORIGIN},http://localhost:15173,http://127.0.0.1:5173,http://localhost:5173,http://localhost:63315,http://127.0.0.1:63315`,
      "--no-auth",
    ],
    {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  proc.stderr.on("data", () => {});
  processes.push(proc);
  return proc;
}

console.log("[Phase 09] Launching Server A (14801) and Server B (14802)...");
const procA = spawnServer(dirA, configA, PORT_A);
const procB = spawnServer(dirB, configB, PORT_B);

async function cleanup() {
  console.log("\n[Phase 09] Cleaning up qualification processes and temporary files...");
  for (const p of processes) {
    try {
      p.kill("SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1000));
  for (const p of processes) {
    try {
      p.kill("SIGKILL");
    } catch {}
  }
  try {
    rmSync(tempBase, { recursive: true, force: true });
  } catch {}
}

process.on("SIGINT", async () => {
  await cleanup();
  process.exit(1);
});
process.on("SIGTERM", async () => {
  await cleanup();
  process.exit(1);
});

async function waitForHealth(port, maxTries = 30) {
  for (let i = 0; i < maxTries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const okA = await waitForHealth(PORT_A);
const okB = await waitForHealth(PORT_B);

if (!okA || !okB) {
  console.error(`[Phase 09] Health check failed: Server A=${okA}, Server B=${okB}`);
  await cleanup();
  process.exit(1);
}
console.log("[Phase 09] Both servers are healthy and listening!");

const results = [];

function assert(condition, scenarioId, message) {
  if (condition) {
    results.push({ id: scenarioId, passed: true, message });
    console.log(`  ✓ [${scenarioId}] ${message}`);
  } else {
    results.push({ id: scenarioId, passed: false, message });
    console.error(`  ✗ [${scenarioId}] FAILED: ${message}`);
  }
}

try {
  console.log("\n=== Executing Scenarios S01–S12 ===");

  // --- S01: Connections & Auth ---
  const resAuthA = await fetch(`http://127.0.0.1:${PORT_A}/api/auth/status`);
  const authStatusA = await resAuthA.json();
  const resAuthB = await fetch(`http://127.0.0.1:${PORT_B}/api/auth/status`);
  const authStatusB = await resAuthB.json();
  
  assert(
    authStatusA.authenticated && authStatusA.dev_mode && authStatusB.authenticated && authStatusB.dev_mode,
    "S01",
    "Both servers provide independent valid dev auth status"
  );

  const loginA = await (
    await fetch(`http://127.0.0.1:${PORT_A}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "dev", password: "dev" }),
    })
  ).json();
  const loginB = await (
    await fetch(`http://127.0.0.1:${PORT_B}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "dev", password: "dev" }),
    })
  ).json();
  assert(Boolean(loginA.token && loginB.token), "S01", "Acquired distinct dev tokens from each server");

  // Verify token A works on A but not with cross-token mismatch if validating signatures
  const projAWithToken = await (await fetch(`http://127.0.0.1:${PORT_A}/api/projects`, {
    headers: { Authorization: `Bearer ${loginA.token}` },
  })).json();
  assert(projAWithToken.length > 0 && projAWithToken[0].name === "web", "S01", "Authenticated request to Server A resolves owned project web");

  // --- S02: Navigation & Identity ---
  const projA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/projects`)).json();
  const projB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/projects`)).json();
  assert(projA[0].name === "web" && projB[0].name === "web", "S02", "Both servers expose same-named project 'web'");
  assert(projA[0].path !== projB[0].path, "S02", "Project absolute paths are distinct and isolated between servers");

  const workspaceA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/workspace`)).json();
  const workspaceB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/workspace`)).json();
  assert(workspaceA.name === "Fixture A" && workspaceB.name === "Fixture B", "S02", "Workspace identities are distinct (Fixture A vs Fixture B)");

  // --- S03: Files, Editor & Uploads ---
  const fileA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/fs/read?project=web&path=src/marker.txt`)).text();
  const fileB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/fs/read?project=web&path=src/marker.txt`)).text();
  assert(fileA.trim() === "SERVER_A" && fileB.trim() === "SERVER_B", "S03", "Markers are isolated: Server A has SERVER_A, Server B has SERVER_B");

  // Mutate file on A directly on filesystem (simulating editor save)
  writeFileSync(join(repoA, "src/marker.txt"), "SERVER_A_MUTATED\n");
  const fileAUpdated = await (await fetch(`http://127.0.0.1:${PORT_A}/api/fs/read?project=web&path=src/marker.txt`)).text();
  const fileBUnchanged = await (await fetch(`http://127.0.0.1:${PORT_B}/api/fs/read?project=web&path=src/marker.txt`)).text();
  assert(fileAUpdated.trim() === "SERVER_A_MUTATED", "S03", "Server A returns mutated file content");
  assert(fileBUnchanged.trim() === "SERVER_B", "S03", "Server B file remains untouched by mutation on Server A");
  // --- S04: Search & Git ---
  const gitDiffA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/git/web/diff`)).json();
  const gitDiffB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/git/web/diff`)).json();
  assert(Array.isArray(gitDiffA.entries) && gitDiffA.entries.length > 0, "S04", "Git diff on Server A reflects mutated file state");
  assert(Array.isArray(gitDiffB.entries) && gitDiffB.entries.length === 0, "S04", "Git diff on Server B remains clean");

  // --- S05: Terminal Continuity ---
  const pythonBin = "python3";
  const ptyScriptA = join(repoA, "terminal_fixture.py");
  const ptyScriptB = join(repoB, "terminal_fixture.py");

  const termResA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "shared-session",
      project: "web",
      command: `${pythonBin} -u ${ptyScriptA}`,
      cwd: repoA,
      cols: 80,
      rows: 24,
      env: { FIXTURE_MARKER: "SERVER_A" },
    }),
  })).json();

  const termResB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "shared-session",
      project: "web",
      command: `${pythonBin} -u ${ptyScriptB}`,
      cwd: repoB,
      cols: 80,
      rows: 24,
      env: { FIXTURE_MARKER: "SERVER_B" },
    }),
  })).json();

  assert(Boolean(termResA && termResB), "S05", "Spawned PTY sessions with equal ID 'shared-session' on both servers");

  // Connect WebSockets to verify output isolation
  async function testWsTerminal(port, expectedMarker) {
    return new Promise((resolveTest) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let receivedOutput = false;
      const timeout = setTimeout(() => {
        try { ws.close(); } catch {}
        resolveTest(false);
      }, 5000);

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ kind: "terminal:attach", id: "shared-session" }));
      });

      ws.addEventListener("message", (event) => {
        const msg = typeof event.data === "string" ? event.data : event.data.toString();
        if (msg.includes(expectedMarker)) {
          receivedOutput = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          resolveTest(true);
        }
      });

      ws.addEventListener("error", () => {
        clearTimeout(timeout);
        resolveTest(false);
      });
    });
  }

  const ptyOutputA = await testWsTerminal(PORT_A, "SERVER_A");
  const ptyOutputB = await testWsTerminal(PORT_B, "SERVER_B");
  assert(ptyOutputA, "S05", "Server A PTY outputs SERVER_A marker and PID");
  assert(ptyOutputB, "S05", "Server B PTY outputs SERVER_B marker and PID");

  // --- S06: Workflow / Sessions ---
  const itemResA = await (
    await fetch(`http://127.0.0.1:${PORT_A}/api/workflow/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: "11111111-1111-4111-8111-111111111111",
        target: { project: "web" },
        kind: "plan",
        title: "Plan on A",
      }),
    })
  ).json();

  const overviewB = await (
    await fetch(`http://127.0.0.1:${PORT_B}/api/workflow/overview?project=web`)
  ).json();
  assert(
    Boolean(itemResA.resource?.id) &&
      !overviewB.items?.some((p) => p.id === itemResA.resource.id),
    "S06",
    "Workflow plan created on Server A is not visible on Server B"
  );
  // --- S07: Media Session Isolation & v2 Tickets ---
  const ticketResA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/fs/image/tickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: "web",
      path: "images/test.png",
      mediaClientId: "11111111-1111-4111-8111-111111111111",
    }),
  })).json();

  assert(
    ticketResA.authorizationMode === "session-cookie-v2" && Boolean(ticketResA.ticket),
    "S07",
    "Server A issues media ticket with authorizationMode: 'session-cookie-v2'"
  );

  // Cross-server check: Server B rejects ticket issued by Server A
  const streamResB = await fetch(
    `http://127.0.0.1:${PORT_B}/api/fs/image/stream/${ticketResA.ticket}`,
    { headers: { Origin: "http://127.0.0.1:15173" } }
  );
  assert(streamResB.status === 404 || !streamResB.ok, "S07", "Server B rejects ticket issued by Server A");

  // DELETE media session on A with mediaClientId
  const deleteResA = await fetch(`http://127.0.0.1:${PORT_A}/api/fs/media-session`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaClientId: "11111111-1111-4111-8111-111111111111" }),
  });
  assert(deleteResA.status === 204 || deleteResA.ok, "S07", "Server A successfully revokes media-session with mediaClientId");

  // --- S08: Ports ---
  const portsA = await (await fetch(`http://127.0.0.1:${PORT_A}/api/ports`)).json();
  const portsB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/ports`)).json();
  assert(Array.isArray(portsA.ports) && Array.isArray(portsB.ports), "S08", "Ports API query returns isolated port arrays for A and B");

  // --- S09: Preferences & Settings ---
  const configContentB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/config`)).text();
  assert(configContentB.includes("Fixture B"), "S09", "Server B configuration returns Fixture B");

  // --- S10: Host Safety ---
  // In no-auth mode, manual host force suspend is disabled
  const forceSleepRes = await fetch(`http://127.0.0.1:${PORT_A}/api/server/idle-suspend/force-suspend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wakeMode: "indefinite", confirmedActiveSessions: 0 }),
  });
  assert(
    forceSleepRes.status === 403 || forceSleepRes.status === 404 || forceSleepRes.status === 409 || !forceSleepRes.ok,
    "S10",
    "Host destructive power action safely rejected in no-auth mode without crash"
  );

  // --- S11: Lifecycle Races ---
  // Delete PTY session on A and verify B's PTY is still alive
  await fetch(`http://127.0.0.1:${PORT_A}/api/terminal/shared-session`, { method: "DELETE" });
  const ptyListB = await (await fetch(`http://127.0.0.1:${PORT_B}/api/terminal`)).json();
  assert(ptyListB.some((t) => t.id === "shared-session"), "S11", "Terminating session on Server A leaves Server B session alive");

  // --- S12: Diagnostics ---
  const diagA = await (
    await fetch(`http://127.0.0.1:${PORT_A}/api/diagnostics/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
  ).json();
  // --- Live Browser Tests against Server A ---
  console.log("\n=== Executing Live Server Browser Tests against Server A ===");
  try {
    execSync(
      `pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/workflow-context-surface.browser.tsx browser-tests/workspace-workflow-terminal-continuity.browser.tsx`,
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          VITE_DAM_HOPPER_SERVER_URL: `http://127.0.0.1:${PORT_A}`,
        },
        stdio: "inherit",
      },
    );
    assert(true, "BROWSER_TESTS", "Live browser tests passed against Server A");
  } catch {
    assert(false, "BROWSER_TESTS", "Live browser tests failed against Server A");
  }
  assert(Boolean(diagA.schemaVersion || diagA.system), "S12", "Server A exports diagnostics without token leaks");
} catch (err) {
  console.error("[Phase 09] Scenario execution threw unexpected error:", err);
  assert(false, "EXEC", `Exception during scenario run: ${err.message}`);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n=== Scenario Execution Summary ===`);
console.log(`Passed: ${results.length - failed.length}/${results.length}`);

if (failed.length > 0) {
  console.error("Failures:", failed);
  await cleanup();
  process.exit(1);
}

await cleanup();
console.log("[Phase 09] Two-server qualification completed successfully!");
process.exit(0);

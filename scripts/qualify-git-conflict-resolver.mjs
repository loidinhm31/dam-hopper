#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const SERVER_BIN = join(REPO_ROOT, "server/target/debug/dam-hopper-server");

if (!existsSync(SERVER_BIN)) {
  console.error("Server binary not found at", SERVER_BIN);
  process.exit(1);
}

const PORT = 14820;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const tempBase = mkdtempSync(join(tmpdir(), "dam-hopper-conflict-qual-"));
console.log(`[Phase 09 Step 12] Qualification harness root: ${tempBase}`);

const primaryDir = join(tempBase, "primary-repo");
const nestedDir = join(primaryDir, "nested-repo");
mkdirSync(primaryDir, { recursive: true });

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function initGitRepo(dir) {
  git("init -b main", dir);
  git('config user.name "Qualification Test"', dir);
  git('config user.email "test@example.com"', dir);
  git("config commit.gpgsign false", dir);
  git("config core.autocrlf false", dir);
}

// 1. Setup primary repo with two conflicts, unrelated staged, unrelated unstaged
console.log("Setting up primary repository...");
initGitRepo(primaryDir);

writeFileSync(join(primaryDir, "base.txt"), "base file\n");
writeFileSync(join(primaryDir, "conflict-a.txt"), "common line 1\ncommon line 2\n");
writeFileSync(join(primaryDir, "conflict-b.txt"), "line A\nline B\n");
writeFileSync(join(primaryDir, "del-mod.txt"), "delete modify target\n");
git("add .", primaryDir);
git('commit -m "initial commit"', primaryDir);

// Branch feature
git("checkout -b feature", primaryDir);
writeFileSync(join(primaryDir, "conflict-a.txt"), "feature line 1\ncommon line 2\n");
writeFileSync(join(primaryDir, "conflict-b.txt"), "line A\nfeature line B\n");
writeFileSync(join(primaryDir, "del-mod.txt"), "feature modified content\n");
git("add .", primaryDir);
git('commit -m "feature commit"', primaryDir);

// Back to main and create conflicting changes
git("checkout main", primaryDir);
writeFileSync(join(primaryDir, "conflict-a.txt"), "main line 1\ncommon line 2\n");
writeFileSync(join(primaryDir, "conflict-b.txt"), "main line A\nline B\n");
git("rm del-mod.txt", primaryDir);
git("add .", primaryDir);
git('commit -m "main commit"', primaryDir);

// Merge feature into main to create real Git conflicts
try {
  git("merge feature", primaryDir);
} catch {
  // Expected conflict
}

// Add an unrelated staged file and an unrelated unstaged file
writeFileSync(join(primaryDir, "staged-unrelated.txt"), "staged clean content\n");
git("add staged-unrelated.txt", primaryDir);
writeFileSync(join(primaryDir, "unstaged-unrelated.txt"), "unstaged clean content\n");

// Setup nested repository
mkdirSync(nestedDir, { recursive: true });
initGitRepo(nestedDir);
writeFileSync(join(nestedDir, "nested-base.txt"), "nested content\n");
git("add .", nestedDir);
git('commit -m "nested initial"', nestedDir);

// Server TOML configuration
const configFile = join(tempBase, "dam-hopper.toml");
const sessionDb = join(tempBase, "session.db");
const tomlContent = `[workspace]
name = "ConflictQualification"

[[projects]]
name = "primary"
path = "${primaryDir}"
type = "custom"

[server]
session_db_path = "${sessionDb}"
`;
writeFileSync(configFile, tomlContent);

let serverProcess = null;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, options);
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: resp.status, ok: resp.ok, text, json };
}

let passedChecks = 0;
let totalChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(message);
  }
  passedChecks++;
  console.log(`  PASS: ${message}`);
}

async function run() {
  try {
    console.log("Starting server process...");
    serverProcess = spawn(
      SERVER_BIN,
      [
        "--host", "127.0.0.1",
        "--port", String(PORT),
        "--no-auth",
        "--config", configFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    serverProcess.stderr.on("data", (d) => {
      const s = d.toString();
      if (s.includes("ERROR") || s.includes("WARN")) {
        process.stderr.write(`[server log] ${s}`);
      }
    });

    // Wait for server readiness
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const check = await fetch(`${BASE_URL}/api/system/metrics`);
        if (check.ok) {
          ready = true;
          break;
        }
      } catch {
        await sleep(200);
      }
    }
    assert(ready, "Server booted and responds on loopback");

    console.log("\n--- Checking Authoritative Operation API ---");
    const opResp = await request("/api/git/primary/operation");
    assert(opResp.ok, "GET /api/git/primary/operation returns 200");
    assert(opResp.json.operation === "merge", "Detects active operation as 'merge'");
    assert(opResp.json.stoppedReason === "conflicts", "Stopped reason is 'conflicts'");
    assert(opResp.json.canContinue === false, "canContinue is false while conflicts exist");
    assert(opResp.json.canAbort === true, "canAbort is true");
    assert(typeof opResp.json.operationFingerprint === "string", "Returns operation fingerprint");
    assert(typeof opResp.json.fullIndexFingerprint === "string", "Returns full index fingerprint");
    assert(opResp.json.stageRoleLabels?.ours.includes("HEAD"), "Role labels truthfulness");

    const savedOpPrecondition = opResp.json.operationFingerprint;
    const savedIndexPrecondition = opResp.json.fullIndexFingerprint;

    console.log("\n--- Checking Conflict Discovery & Snapshots API ---");
    const confResp = await request("/api/git/primary/conflicts");
    assert(confResp.ok, "GET /api/git/primary/conflicts returns 200");
    assert(confResp.json.entries.length >= 2, "Lists conflicted files");
    const paths = confResp.json.entries.map((e) => e.path);
    assert(paths.includes("conflict-a.txt"), "Inventory includes conflict-a.txt");
    assert(paths.includes("conflict-b.txt"), "Inventory includes conflict-b.txt");
    const entryA = confResp.json.entries.find((e) => e.path === "conflict-a.txt");
    assert(entryA !== undefined, "Entry A found in conflict inventory");
    const fileResp = await request(`/api/git/primary/conflicts/file?conflictId=${encodeURIComponent(entryA.conflictId)}`);
    assert(fileResp.ok, "GET /api/git/primary/conflicts/file returns 200 for conflict-a.txt");
    const snapshotA = fileResp.json;
    assert(snapshotA.stages.ours !== null, "Stage 2 (ours) present");
    assert(snapshotA.stages.theirs !== null, "Stage 3 (theirs) present");
    assert(snapshotA.stages.base !== null, "Stage 1 (base) present");
    assert(snapshotA.worktree.hasConflictMarkers === true, "Detects conflict markers");

    console.log("\n--- Checking CUT1 Generic Staging Bypass Closure ---");
    const badStageResp = await request("/api/git/primary/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: ["staged-unrelated.txt", "conflict-a.txt"] }),
    });
    assert(
      badStageResp.status === 400,
      `Direct staging batch with conflict path rejected (HTTP ${badStageResp.status})`
    );
    assert(
      badStageResp.text.toLowerCase().includes("cannot stage conflicted path"),
      "Rejection message clearly identifies conflicted path"
    );

    console.log("\n--- Checking CUT2 Legacy Payload Rejection ---");
    const legacyResp = await request("/api/git/primary/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "conflict-a.txt", content: "legacy content" }),
    });
    assert(
      legacyResp.status === 400,
      `Legacy { path, content } payload rejected (HTTP ${legacyResp.status})`
    );
    assert(
      legacyResp.text.includes("LEGACY_PAYLOAD_REJECTED"),
      "Error code is LEGACY_PAYLOAD_REJECTED"
    );

    console.log("\n--- Checking Stale Precondition Detection ---");
    const staleResolveResp = await request("/api/git/primary/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conflictId: snapshotA.conflictId,
        snapshotVersion: "stale-version-9999",
        fullIndexFingerprint: snapshotA.fullIndexFingerprint,
        action: { type: "reviewedText", tokens: ["resolved a text\n"], eol: "preserve" },
      }),
    });
    if (!staleResolveResp.ok) {
      console.log("staleResolveResp debug:", staleResolveResp.status, staleResolveResp.text);
    }
    assert(staleResolveResp.ok, "POST /api/git/primary/resolve returns 200");
    assert(staleResolveResp.json.outcome === "stale", "Outcome is 'stale' for mismatched snapshot version");
    assert(staleResolveResp.json.requiredRefresh === true, "requiredRefresh is true on stale outcome");

    console.log("\n--- Checking Safe Preconditioned File Resolution (File A) ---");
    const resolveAResp = await request("/api/git/primary/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conflictId: snapshotA.conflictId,
        snapshotVersion: snapshotA.snapshotVersion,
        fullIndexFingerprint: snapshotA.fullIndexFingerprint,
        action: { type: "reviewedText", tokens: ["resolved content for a\n"], eol: "preserve" },
      }),
    });
    assert(resolveAResp.ok, "Resolve File A returns 200");
    assert(resolveAResp.json.outcome === "applied", "Outcome is 'applied'");
    assert(resolveAResp.json.newOid !== undefined, "Stage 0 OID returned");

    // Verify on disk and index: conflict-a.txt is staged at stage 0, conflict-b.txt still conflicted
    const lsStage = git("ls-files -u", primaryDir);
    assert(!lsStage.includes("conflict-a.txt"), "conflict-a.txt cleared from unmerged index");
    assert(lsStage.includes("conflict-b.txt"), "conflict-b.txt still unmerged");
    const diskContentA = readFileSync(join(primaryDir, "conflict-a.txt"), "utf8");
    assert(diskContentA === "resolved content for a\n", "File content on disk updated accurately");

    console.log("\n--- Checking Operation Continue Guarded Block on Remaining Conflicts ---");
    const earlyContinueResp = await request("/api/git/primary/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "primary",
        operationPrecondition: savedOpPrecondition,
        fullIndexFingerprint: savedIndexPrecondition,
        action: "continue",
      }),
    });
    assert(
      earlyContinueResp.json.outcome === "stale",
      "Rejected as stale because index changed after resolving File A"
    );

    // Refresh status to get fresh fingerprints
    const freshStatusResp = await request("/api/git/primary/operation");
    const freshStatus = freshStatusResp.json;
    assert(freshStatus.canContinue === false, "canContinue remains false with conflict-b unresolved");

    console.log("\n--- Resolving Remaining Conflicts ---");
    const entryB = confResp.json.entries.find((e) => e.path === "conflict-b.txt");
    const fileBResp = await request(`/api/git/primary/conflicts/file?conflictId=${encodeURIComponent(entryB.conflictId)}`);
    const snapshotB = fileBResp.json;
    const resolveBResp = await request("/api/git/primary/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conflictId: snapshotB.conflictId,
        snapshotVersion: snapshotB.snapshotVersion,
        fullIndexFingerprint: snapshotB.fullIndexFingerprint,
        action: { type: "reviewedText", tokens: ["resolved content for b\n"], eol: "preserve" },
      }),
    });
    assert(resolveBResp.json.outcome === "applied", "Resolved conflict-b.txt successfully");

    // Resolve del-mod if still unmerged
    const entryDel = confResp.json.entries.find((e) => e.path === "del-mod.txt");
    assert(entryDel !== undefined, "del-mod.txt entry found in conflict list");
    const delModFileResp = await request(`/api/git/primary/conflicts/file?conflictId=${encodeURIComponent(entryDel.conflictId)}`);
    const snapDel = delModFileResp.json;
    const delModResolveResp = await request("/api/git/primary/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conflictId: snapDel.conflictId,
        snapshotVersion: snapDel.snapshotVersion,
        fullIndexFingerprint: snapDel.fullIndexFingerprint,
        action: { type: "delete" },
      }),
    });
    assert(delModResolveResp.ok && delModResolveResp.json.outcome === "applied", "del-mod.txt resolved via delete action");
    assert(!existsSync(join(primaryDir, "del-mod.txt")), "del-mod.txt is absent on disk after delete action");

    const allResolvedStatus = (await request("/api/git/primary/operation")).json;
    assert(allResolvedStatus.canContinue === true, "canContinue is true once all conflicts resolved");
    assert(
      allResolvedStatus.stoppedReason === "messageEditRequired",
      "Stopped reason is messageEditRequired in merge awaiting commit message"
    );
    assert(
      allResolvedStatus.terminalHandoffRequired?.reason === "commitMessageEditor",
      "Terminal handoff directs user to commit message editor"
    );

    console.log("\n--- Checking Continue with Live Sentinel Detection ---");
    const continueResp = await request("/api/git/primary/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "primary",
        operationPrecondition: allResolvedStatus.operationFingerprint,
        fullIndexFingerprint: allResolvedStatus.fullIndexFingerprint,
        action: "continue",
      }),
    });
    assert(continueResp.ok, "POST continue returns 200");
    assert(continueResp.json.outcome === "blocked", "Continue blocked by editor sentinel");
    assert(continueResp.json.reason === "messageEditRequired", "Blocked reason is messageEditRequired");
    assert(continueResp.json.terminalHandoffRequired === true, "terminalHandoffRequired flag is true");

    console.log("\n--- Checking Nested Repository Target Isolation ---");
    const nestedResp = await request("/api/git/primary/operation?root=nested-repo");
    if (!nestedResp.ok) console.log("nestedResp error:", nestedResp.status, nestedResp.text);
    assert(nestedResp.ok, "GET nested repo operation returns 200");
    assert(nestedResp.json.operation === "none", "Nested repo has operation 'none'");
    console.log("\n--- Checking Operation Abort Lifecycle ---");
    // Test unconfirmed abort fails
    const unconfirmedAbort = await request("/api/git/primary/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "primary",
        operationPrecondition: allResolvedStatus.operationFingerprint,
        fullIndexFingerprint: allResolvedStatus.fullIndexFingerprint,
        action: "abort",
        abortConfirmed: false,
      }),
    });
    assert(unconfirmedAbort.json.outcome === "failed", "Unconfirmed abort rejected");

    // Confirmed abort
    const abortResp = await request("/api/git/primary/operation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project: "primary",
        operationPrecondition: allResolvedStatus.operationFingerprint,
        fullIndexFingerprint: allResolvedStatus.fullIndexFingerprint,
        action: "abort",
        abortConfirmed: true,
      }),
    });
    if (abortResp.json?.outcome !== "aborted") {
      console.log("abortResp debug:", abortResp.status, abortResp.text);
    }
    assert(abortResp.ok, "POST abort returns 200");
    assert(abortResp.json.outcome === "aborted", "Outcome is 'aborted'");
    assert(abortResp.json.worktreeCleaned === true, "worktreeCleaned is true");

    // Post-abort authoritative status check
    const postAbortStatus = (await request("/api/git/primary/operation")).json;
    assert(postAbortStatus.operation === "none", "Operation is 'none' after abort");
    assert(postAbortStatus.canContinue === false, "canContinue is false after abort");
    assert(postAbortStatus.canAbort === false, "canAbort is false after abort");

    console.log("\n=======================================================");
    console.log(`Phase 09 Step 12 Smoke Qualification: ${passedChecks}/${totalChecks} assertions passed.`);
    console.log("=======================================================\n");
  } finally {
    if (serverProcess) {
      console.log("Stopping server...");
      serverProcess.kill("SIGTERM");
    }
    try {
      rmSync(tempBase, { recursive: true, force: true });
      console.log("Cleaned up temporary directories.");
    } catch {
      // Ignore
    }
  }
}

run().catch((err) => {
  console.error("Qualification failed:", err);
  process.exit(1);
});

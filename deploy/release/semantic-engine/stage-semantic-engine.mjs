#!/usr/bin/env node
/**
 * Deterministic build-time staging and cryptographic verification tool for
 * DamHopper's bundled Linux x64 semantic engine (Node 24.16.0, TS 5.9.3, TSLS 6.0.2).
 */

import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync,
  mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_KNOWN_NODE_PATHS = [
  "/home/loidinh/.nvm/versions/node/v24.16.0/bin/node",
  "/opt/dam-hopper/lib/semantic-engine/node",
];

const DEFAULT_KNOWN_NODE_MODULES_PATHS = [
  "/tmp/dam-hopper-spike-tuple/node_modules",
  "/opt/dam-hopper/lib/semantic-engine/tsls/node_modules",
];

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function loadProvenance(engineSourceDir = __dirname) {
  return JSON.parse(readFileSync(join(engineSourceDir, "provenance.json"), "utf8"));
}

function copyDirDereferenced(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  chmodSync(dstDir, 0o755);
  for (const name of readdirSync(srcDir).sort()) {
    if (name === ".bin" || name.endsWith(".tsbuildinfo")) continue;
    const realSrc = realpathSync(join(srcDir, name));
    const dstPath = join(dstDir, name);
    const st = statSync(realSrc);
    if (st.isDirectory()) {
      copyDirDereferenced(realSrc, dstPath);
    } else if (st.isFile()) {
      copyFileSync(realSrc, dstPath);
      chmodSync(dstPath, 0o644);
    }
  }
}

export function locateVerifiedNodeBinary(expectedSha256, explicitPath = null) {
  const candidates = explicitPath ? [resolve(explicitPath)] : DEFAULT_KNOWN_NODE_PATHS;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      if (sha256File(candidate).toLowerCase() === expectedSha256.toLowerCase()) {
        return candidate;
      }
    } catch {}
  }
  throw new Error(
    `Could not locate pinned Node.js v24.16.0 matching SHA-256 ${expectedSha256}`,
  );
}

export function locateVerifiedNodeModules(provenance, explicitDir = null) {
  const candidates = explicitDir ? [resolve(explicitDir)] : DEFAULT_KNOWN_NODE_MODULES_PATHS;
  const cliSha = provenance.transitivePayloadDigests["tsls/node_modules/typescript-language-server/lib/cli.mjs"];
  const tsSha = provenance.transitivePayloadDigests["tsls/node_modules/typescript/lib/tsserver.js"];
  for (const candidate of candidates) {
    const cliPath = join(candidate, "typescript-language-server/lib/cli.mjs");
    const tsPath = join(candidate, "typescript/lib/tsserver.js");
    if (!existsSync(cliPath) || !existsSync(tsPath)) continue;
    try {
      if (
        sha256File(cliPath).toLowerCase() === cliSha.toLowerCase() &&
        sha256File(tsPath).toLowerCase() === tsSha.toLowerCase()
      ) {
        return candidate;
      }
    } catch {}
  }
  throw new Error("Could not locate pinned node_modules (TS 5.9.3 + TSLS 6.0.2) matching provenance digests");
}

export function verifyStagedSemanticEngine(engineDir, provenance = loadProvenance()) {
  const inspect = (path) => {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      throw new Error(`Invalid semantic engine payload type: ${path}`);
    }
    if ((metadata.mode & 0o022) !== 0) {
      throw new Error(`Unsafe writable semantic engine payload: ${path}`);
    }
    if (metadata.isDirectory()) {
      for (const name of readdirSync(path)) inspect(join(path, name));
    }
  };
  inspect(engineDir);
  for (const [relPath, expectedSha] of Object.entries(provenance.transitivePayloadDigests)) {
    const fullPath = join(engineDir, relPath);
    if (!existsSync(fullPath)) throw new Error(`Missing semantic engine file: ${relPath}`);
    const lst = lstatSync(fullPath);
    if (lst.isSymbolicLink() || !lst.isFile()) {
      throw new Error(`Invalid file type (symlink or non-file) at: ${relPath}`);
    }
    const mode = lst.mode & 0o777;
    if ((mode & 0o022) !== 0) throw new Error(`Unsafe writable permissions (${mode.toString(8)}) on: ${relPath}`);
    if (relPath === "node" && (mode & 0o111) === 0) throw new Error(`Node binary lacks executable permission: ${relPath}`);
    const actualSha = sha256File(fullPath);
    if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new Error(`Digest mismatch for ${relPath}: expected ${expectedSha}, got ${actualSha}`);
    }
  }
  return true;
}

export function stageSemanticEngine({
  outputDir, asReleaseRoot = false, nodeBin = null, nodeModulesDir = null, retrievePinned = false,
}) {
  const provenance = loadProvenance(__dirname);
  const targetEngineDir = asReleaseRoot ? join(resolve(outputDir), "lib/semantic-engine") : resolve(outputDir);
  let tempDir = null;
  try {
    let resolvedNode;
    try {
      resolvedNode = locateVerifiedNodeBinary(provenance.components.node.sha256, nodeBin);
    } catch (err) {
      if (!retrievePinned) throw err;
      tempDir = mkdtempSync(join(tmpdir(), "dam-hopper-sem-fetch-"));
      const tarPath = join(tempDir, "node.tar.gz");
      execFileSync("curl", ["-fsSL", provenance.components.node.source, "-o", tarPath]);
      const nodeMember = `node-${provenance.components.node.version}-linux-x64/bin/node`;
      execFileSync("tar", ["-xzf", tarPath, "-C", tempDir,
        "--no-same-owner", "--no-same-permissions", "--", nodeMember]);
      resolvedNode = locateVerifiedNodeBinary(
        provenance.components.node.sha256,
        join(tempDir, `node-${provenance.components.node.version}-linux-x64/bin/node`),
      );
    }

    let resolvedModules;
    try {
      resolvedModules = locateVerifiedNodeModules(provenance, nodeModulesDir);
    } catch (err) {
      if (!retrievePinned) throw err;
      if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), "dam-hopper-sem-fetch-"));
      copyFileSync(join(__dirname, "package.json"), join(tempDir, "package.json"));
      copyFileSync(join(__dirname, "pnpm-lock.yaml"), join(tempDir, "pnpm-lock.yaml"));
      execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--prod"], { cwd: tempDir, stdio: "inherit" });
      resolvedModules = locateVerifiedNodeModules(provenance, join(tempDir, "node_modules"));
    }

    const tslsDir = join(targetEngineDir, "tsls");
    const targetNodeModules = join(tslsDir, "node_modules");
    mkdirSync(targetNodeModules, { recursive: true });
    for (const d of [targetEngineDir, tslsDir, targetNodeModules]) chmodSync(d, 0o755);

    const stagedNode = join(targetEngineDir, "node");
    copyFileSync(resolvedNode, stagedNode);
    chmodSync(stagedNode, 0o755);

    for (const metaFile of ["package.json", "pnpm-lock.yaml", "LICENSES.txt", "provenance.json"]) {
      const dst = join(tslsDir, metaFile);
      copyFileSync(join(__dirname, metaFile), dst);
      chmodSync(dst, 0o644);
    }
    for (const pkg of ["typescript", "typescript-language-server"]) {
      copyDirDereferenced(join(resolvedModules, pkg), join(targetNodeModules, pkg));
    }
    verifyStagedSemanticEngine(targetEngineDir, provenance);
    return { engineDir: targetEngineDir, tupleId: provenance.tupleId };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  let outputDir = null, asReleaseRoot = false, nodeBin = null, nodeModulesDir = null, retrievePinned = false, verifyOnlyDir = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--output-dir") outputDir = args[++i];
    else if (a === "--release-root") { outputDir = args[++i]; asReleaseRoot = true; }
    else if (a === "--node-bin") nodeBin = args[++i];
    else if (a === "--node-modules-dir") nodeModulesDir = args[++i];
    else if (a === "--retrieve-pinned") retrievePinned = true;
    else if (a === "--verify-only") verifyOnlyDir = args[++i];
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  if (verifyOnlyDir) {
    verifyStagedSemanticEngine(resolve(verifyOnlyDir));
    console.log(`✓ Verified staged semantic engine at ${resolve(verifyOnlyDir)}`);
    process.exit(0);
  }
  if (!outputDir) {
    console.error("Usage: node stage-semantic-engine.mjs --output-dir <dir> | --release-root <dir> | --verify-only <dir>");
    process.exit(1);
  }
  const res = stageSemanticEngine({ outputDir, asReleaseRoot, nodeBin, nodeModulesDir, retrievePinned });
  console.log(`✓ Staged and verified ${res.tupleId} at ${res.engineDir}`);
}

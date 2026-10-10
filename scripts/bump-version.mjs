#!/usr/bin/env node
/**
 * Repository-wide Version Bump, Release Tag, and Push Script for DamHopper.
 * Synchronizes all 13 release locations, refreshes Cargo locks,
 * validates alignment, and manages Git staging, commits, tags, and pushes.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs, calculateNextVersion } from "./release-version-semver.mjs";
import {
  getCanonicalCurrentVersion,
  updateAllSynchronizedLocations,
} from "./release-version-manifest.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function runCommand(bin, args, options = {}) {
  return execFileSync(bin, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

export async function main() {
  const options = parseArgs();
  const currentVersion = getCanonicalCurrentVersion(REPO_ROOT);
  const nextVersion = calculateNextVersion(currentVersion, options.bumpTarget);
  const canonicalTag = `v${nextVersion}`;

  console.log(`\n========================================`);
  console.log(`DamHopper Release Version Bump`);
  console.log(`Current: ${currentVersion} -> Target: ${nextVersion} (${canonicalTag})`);
  console.log(`Mode:    ${options.dryRun ? "DRY-RUN (preview only)" : "LIVE"}`);
  console.log(`========================================\n`);

  if (!options.allowDirty) {
    try {
      const gitStatus = runCommand("git", ["status", "--porcelain"]);
      const trackedChanges = gitStatus
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("??"));
      if (trackedChanges.length > 0) {
        console.error(
          `Error: Git working tree contains tracked uncommitted changes:\n${trackedChanges.map((l) => `  ${l}`).join("\n")}\n\nCommit/stash changes or pass --allow-dirty.`,
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: Failed to verify clean git status: ${err.stderr || err.message}`);
      process.exit(1);
    }
  }

  // [1/5] Update synchronized version locations
  console.log(`[1/5] Updating synchronized version locations...`);
  const filesToStage = updateAllSynchronizedLocations(
    REPO_ROOT,
    currentVersion,
    nextVersion,
    options.dryRun,
  );
  for (const rel of filesToStage) console.log(`  ✓ ${rel}`);

  // [2/5] Refresh Cargo Lockfiles
  console.log(`\n[2/5] Refreshing Cargo lockfiles (server & apps/native)...`);
  filesToStage.push("server/Cargo.lock", "apps/native/src-tauri/Cargo.lock");

  if (!options.dryRun) {
    const bridgeAsset = resolve(REPO_ROOT, "packages/browser-bridge/dist/index.iife.js");
    if (!existsSync(bridgeAsset)) {
      try {
        runCommand("pnpm", ["--filter", "@dam-hopper/browser-bridge", "build"]);
      } catch {}
    }
    try {
      runCommand("cargo", ["metadata", "--format-version", "1", "--manifest-path", "server/Cargo.toml"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      console.log(`  ✓ server/Cargo.lock updated`);
      runCommand("cargo", ["metadata", "--format-version", "1", "--manifest-path", "apps/native/src-tauri/Cargo.toml"], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      console.log(`  ✓ apps/native/src-tauri/Cargo.lock updated`);
    } catch (err) {
      console.error(`Failed to refresh Cargo locks: ${err.stderr || err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`  [dry-run] cargo metadata --format-version 1 --manifest-path server/Cargo.toml`);
    console.log(`  [dry-run] cargo metadata --format-version 1 --manifest-path apps/native/src-tauri/Cargo.toml`);
  }

  // [3/5] Verify release version alignment
  console.log(`\n[3/5] Validating version alignment with check-version-alignment.mjs...`);
  if (!options.dryRun) {
    try {
      const out = runCommand("node", ["deploy/release/check-version-alignment.mjs", canonicalTag]);
      console.log(`  ${out.trim()}`);
    } catch (err) {
      console.error(`Version alignment check failed: ${err.stderr || err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`  [dry-run] node deploy/release/check-version-alignment.mjs ${canonicalTag}`);
  }

  if (options.noCommit) {
    console.log(`\n--no-commit set: Skipping git commit and tagging.`);
    return;
  }

  // [4/5] Git staging and commit
  const commitMsg = `chore(release): bump version to ${nextVersion}`;
  const tagMsg = `Release ${canonicalTag}`;
  console.log(`\n[4/5] Git staging and committing...`);
  if (!options.dryRun) {
    runCommand("git", ["add", ...filesToStage]);
    console.log(`  ✓ Staged ${filesToStage.length} files`);
    runCommand("git", ["commit", "-m", commitMsg, "--", ...filesToStage]);
    console.log(`  ✓ Created commit: "${commitMsg}"`);
  } else {
    console.log(`  [dry-run] git add ${filesToStage.join(" ")}`);
    console.log(`  [dry-run] git commit -m "${commitMsg}" -- ${filesToStage.join(" ")}`);
  }

  // [5/5] Git tag & push
  console.log(`\n[5/5] Git release tagging...`);
  if (!options.noTag) {
    if (!options.dryRun) {
      runCommand("git", ["tag", "-a", canonicalTag, "-m", tagMsg]);
      console.log(`  ✓ Created annotated tag: ${canonicalTag}`);
    } else {
      console.log(`  [dry-run] git tag -a ${canonicalTag} -m "${tagMsg}"`);
    }
  }

  let currentBranch = "main";
  try {
    currentBranch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  } catch {}

  if (options.push) {
    console.log(`\nPushing branch '${currentBranch}' and tag '${canonicalTag}' to origin...`);
    if (!options.dryRun) {
      runCommand("git", ["push", "origin", currentBranch]);
      console.log(`  ✓ Pushed branch ${currentBranch}`);
      if (!options.noTag) {
        runCommand("git", ["push", "origin", canonicalTag]);
        console.log(`  ✓ Pushed tag ${canonicalTag}`);
      }
    } else {
      console.log(`  [dry-run] git push origin ${currentBranch}`);
      if (!options.noTag) console.log(`  [dry-run] git push origin ${canonicalTag}`);
    }
    console.log(`\n✓ Release ${canonicalTag} pushed successfully!`);
  } else {
    console.log(`\n========================================`);
    console.log(`Release ${canonicalTag} prepared locally!`);
    if (!options.dryRun && !options.noCommit && !options.noTag) {
      console.log(`To push to remote origin, run:`);
      console.log(`  git push origin ${currentBranch} && git push origin ${canonicalTag}`);
    }
    console.log(`========================================\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  });
}

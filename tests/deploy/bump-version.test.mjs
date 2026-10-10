#!/usr/bin/env node
/**
 * Test suite for scripts/bump-version.mjs, release-version-semver.mjs,
 * and release-version-manifest.mjs.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseSemver,
  calculateNextVersion,
  parseArgs,
} from "../../scripts/release-version-semver.mjs";
import {
  getCanonicalCurrentVersion,
  updateJsonVersion,
  updateCargoTomlVersion,
  updateUatScriptVersion,
  updateSmokeScriptVersion,
  updateAllSynchronizedLocations,
} from "../../scripts/release-version-manifest.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

console.log("==> Testing SemVer parsing and validation");
assert.deepEqual(parseSemver("0.11.0"), [0, 11, 0]);
assert.deepEqual(parseSemver("v0.11.0"), [0, 11, 0]);
assert.deepEqual(parseSemver("1.2.3"), [1, 2, 3]);
assert.deepEqual(parseSemver("v10.20.30"), [10, 20, 30]);

assert.throws(() => parseSemver("01.0.0"), /strict SemVer/);
assert.throws(() => parseSemver("1.0"), /strict SemVer/);
assert.throws(() => parseSemver("1.0.0-alpha"), /strict SemVer/);
assert.throws(() => parseSemver("invalid"), /strict SemVer/);
assert.throws(() => parseSemver(""), /Invalid version input/);

console.log("==> Testing Next Version calculation");
assert.equal(calculateNextVersion("0.11.0", "patch"), "0.11.1");
assert.equal(calculateNextVersion("0.11.0", "minor"), "0.12.0");
assert.equal(calculateNextVersion("0.11.0", "major"), "1.0.0");
assert.equal(calculateNextVersion("0.11.0", "0.15.2"), "0.15.2");
assert.equal(calculateNextVersion("0.11.0", "v1.2.3"), "1.2.3");
assert.equal(calculateNextVersion("0.11.9", "patch"), "0.11.10");

console.log("==> Testing CLI Arguments parsing");
assert.deepEqual(parseArgs([]), {
  bumpTarget: "patch",
  dryRun: false,
  push: false,
  noCommit: false,
  noTag: false,
  allowDirty: false,
});
assert.deepEqual(parseArgs(["minor", "--dry-run", "--allow-dirty"]), {
  bumpTarget: "minor",
  dryRun: true,
  push: false,
  noCommit: false,
  noTag: false,
  allowDirty: true,
});
assert.deepEqual(parseArgs(["--push", "v1.0.0", "--no-tag"]), {
  bumpTarget: "v1.0.0",
  dryRun: false,
  push: true,
  noCommit: false,
  noTag: true,
  allowDirty: false,
});

console.log("==> Testing File Updates in Temp Fixture");
const tempDir = mkdtempSync(join(tmpdir(), "dam-hopper-bump-test-"));

try {
  // Setup mock files
  const mockJson = join(tempDir, "pkg.json");
  writeFileSync(mockJson, JSON.stringify({ name: "mock", version: "0.11.0" }, null, 2) + "\n");
  updateJsonVersion(mockJson, "0.12.0", false);
  const updatedJson = JSON.parse(readFileSync(mockJson, "utf8"));
  assert.equal(updatedJson.version, "0.12.0");

  const mockCargo = join(tempDir, "Cargo.toml");
  writeFileSync(mockCargo, '[package]\nname = "test"\nversion = "0.11.0"\nedition = "2021"\n');
  updateCargoTomlVersion(mockCargo, "0.12.0", false);
  const updatedCargo = readFileSync(mockCargo, "utf8");
  assert.match(updatedCargo, /^version = "0\.12\.0"$/m);

  const mockUat = join(tempDir, "run-uat.sh");
  writeFileSync(mockUat, 'echo "test"\n"releaseVersion": "0.11.0",\n--release-version "0.11.0" \\\n');
  updateUatScriptVersion(mockUat, "0.11.0", "0.12.0", false);
  const updatedUat = readFileSync(mockUat, "utf8");
  assert.match(updatedUat, /"releaseVersion": "0\.12\.0"/);
  assert.match(updatedUat, /--release-version "0\.12\.0"/);

  const mockSmoke = join(tempDir, "smoke.sh");
  writeFileSync(mockSmoke, 'RELEASE_VERSION="${DAM_HOPPER_RELEASE_VERSION:-0.11.0}"\n');
  updateSmokeScriptVersion(mockSmoke, "0.11.0", "0.12.0", false);
  const updatedSmoke = readFileSync(mockSmoke, "utf8");
  assert.match(updatedSmoke, /RELEASE_VERSION="\${DAM_HOPPER_RELEASE_VERSION:-0\.12\.0}"/);

  // Test full synchronized locations in mock workspace
  const mockWorkspace = join(tempDir, "workspace");
  mkdirSync(join(mockWorkspace, "apps/browser-extension"), { recursive: true });
  mkdirSync(join(mockWorkspace, "apps/native/src-tauri"), { recursive: true });
  mkdirSync(join(mockWorkspace, "apps/web"), { recursive: true });
  mkdirSync(join(mockWorkspace, "packages/browser-bridge"), { recursive: true });
  mkdirSync(join(mockWorkspace, "packages/shared"), { recursive: true });
  mkdirSync(join(mockWorkspace, "packages/ui"), { recursive: true });
  mkdirSync(join(mockWorkspace, "server"), { recursive: true });
  mkdirSync(join(mockWorkspace, "scripts"), { recursive: true });
  mkdirSync(join(mockWorkspace, "tests/deploy"), { recursive: true });

  const pkgPaths = [
    "apps/browser-extension/package.json",
    "apps/native/package.json",
    "apps/web/package.json",
    "packages/browser-bridge/package.json",
    "packages/shared/package.json",
    "packages/ui/package.json",
  ];
  for (const rel of pkgPaths) {
    writeFileSync(join(mockWorkspace, rel), JSON.stringify({ version: "0.11.0" }, null, 2) + "\n");
  }
  writeFileSync(join(mockWorkspace, "apps/native/src-tauri/tauri.conf.json"), JSON.stringify({ version: "0.11.0" }, null, 2) + "\n");
  writeFileSync(join(mockWorkspace, "apps/native/src-tauri/Cargo.toml"), '[package]\nname = "dam-hopper-native"\nversion = "0.11.0"\n');
  writeFileSync(join(mockWorkspace, "server/Cargo.toml"), '[package]\nname = "dam-hopper-server"\nversion = "0.11.0"\n');
  writeFileSync(join(mockWorkspace, "scripts/run-uat.sh"), '"releaseVersion": "0.11.0"\n--release-version "0.11.0"');
  writeFileSync(join(mockWorkspace, "tests/deploy/linux-release-rootless-smoke.sh"), 'RELEASE_VERSION="${DAM_HOPPER_RELEASE_VERSION:-0.11.0}"');

  const processed = updateAllSynchronizedLocations(mockWorkspace, "0.11.0", "0.12.0", false);
  assert.equal(processed.length, 11);

  // Verify all files were updated
  for (const rel of pkgPaths) {
    const pkg = JSON.parse(readFileSync(join(mockWorkspace, rel), "utf8"));
    assert.equal(pkg.version, "0.12.0", `${rel} version mismatch`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("==> Testing scripts/bump-version.mjs in CLI dry-run mode");
const repoCurrentVer = getCanonicalCurrentVersion(REPO_ROOT);
const expectedMinor = calculateNextVersion(repoCurrentVer, "minor");
const expectedPatch = calculateNextVersion(repoCurrentVer, "patch");

const dryRunOutput = execFileSync("node", ["scripts/bump-version.mjs", "--dry-run", "minor", "--allow-dirty"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
assert.match(dryRunOutput, /DamHopper Release Version Bump/);
assert.match(dryRunOutput, new RegExp(`Current: ${repoCurrentVer.replace(/\\./g, "\\\\.")} -> Target: ${expectedMinor.replace(/\\./g, "\\\\.")} \\(v${expectedMinor.replace(/\\./g, "\\\\.")}\\)`));
assert.match(dryRunOutput, /\[dry-run\] cargo metadata --format-version 1 --manifest-path server\/Cargo\.toml/);
assert.match(dryRunOutput, new RegExp(`\\[dry-run\\] node deploy/release/check-version-alignment\\.mjs v${expectedMinor.replace(/\\./g, "\\\\.")}`));
assert.match(dryRunOutput, new RegExp(`\\[dry-run\\] git commit -m "chore\\(release\\): bump version to ${expectedMinor.replace(/\\./g, "\\\\.")}"`));
assert.match(dryRunOutput, new RegExp(`\\[dry-run\\] git tag -a v${expectedMinor.replace(/\\./g, "\\\\.")} -m "Release v${expectedMinor.replace(/\\./g, "\\\\.")}"`));

console.log("==> Testing scripts/bump-version.sh bash wrapper");
const bashOutput = execFileSync("./scripts/bump-version.sh", ["--dry-run", "patch", "--allow-dirty"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
assert.match(bashOutput, new RegExp(`Current: ${repoCurrentVer.replace(/\\./g, "\\\\.")} -> Target: ${expectedPatch.replace(/\\./g, "\\\\.")} \\(v${expectedPatch.replace(/\\./g, "\\\\.")}\\)`));
console.log("\n✓ All bump-version tests passed successfully!");

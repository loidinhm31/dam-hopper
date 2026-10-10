/**
 * Semantic version parsing, calculation, and CLI options handling
 * for DamHopper release version automation.
 */

export const SEMVER_TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const SEMVER_BARE_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Parse and validate semver string into [major, minor, patch] numbers.
 * Enforces strict SemVer without leading zeros or non-numeric suffixes.
 */
export function parseSemver(versionStr) {
  if (!versionStr || typeof versionStr !== "string") {
    throw new Error(`Invalid version input: '${versionStr}'`);
  }
  const clean = versionStr.startsWith("v") ? versionStr.slice(1) : versionStr;
  const match = clean.match(SEMVER_BARE_REGEX);
  if (!match) {
    throw new Error(
      `Version '${versionStr}' does not conform to strict SemVer (MAJOR.MINOR.PATCH with no leading zeros).`,
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Calculate target version given current version and bump argument.
 *
 * @param {string} currentVersion - Canonical current version (e.g. "0.11.0")
 * @param {string} bumpArg - "patch", "minor", "major", or explicit version like "0.12.0"
 * @returns {string} Calculated next bare SemVer string
 */
export function calculateNextVersion(currentVersion, bumpArg = "patch") {
  const [major, minor, patch] = parseSemver(currentVersion);
  const target = (bumpArg || "patch").trim().toLowerCase();

  if (target === "patch") {
    return `${major}.${minor}.${patch + 1}`;
  }
  if (target === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  if (target === "major") {
    return `${major + 1}.0.0`;
  }

  // Explicit version string supplied
  const rawTarget = bumpArg.trim();
  const [nextMajor, nextMinor, nextPatch] = parseSemver(rawTarget);
  return `${nextMajor}.${nextMinor}.${nextPatch}`;
}

/**
 * Parse CLI arguments into structured configuration.
 */
export function parseArgs(rawArgs = process.argv.slice(2)) {
  let bumpTarget = null;
  let dryRun = false;
  let push = false;
  let noCommit = false;
  let noTag = false;
  let allowDirty = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--push") {
      push = true;
    } else if (arg === "--no-commit") {
      noCommit = true;
    } else if (arg === "--no-tag") {
      noTag = true;
    } else if (arg === "--allow-dirty") {
      allowDirty = true;
    } else if (!arg.startsWith("--") && !bumpTarget) {
      bumpTarget = arg;
    } else {
      throw new Error(`Unknown or unexpected argument: ${arg}`);
    }
  }

  return {
    bumpTarget: bumpTarget || "patch",
    dryRun,
    push,
    noCommit,
    noTag,
    allowDirty,
  };
}

/**
 * Print detailed usage documentation.
 */
export function printHelp() {
  console.log(`
DamHopper Version Bump, Release Tag, and Push Script

Usage:
  node scripts/bump-version.mjs [patch|minor|major|vX.Y.Z|X.Y.Z] [options]
  ./scripts/bump-version.sh [patch|minor|major|vX.Y.Z|X.Y.Z] [options]
  pnpm release:bump [patch|minor|major|vX.Y.Z|X.Y.Z] [options]

Bump Targets:
  patch                  Increment PATCH version (default)
  minor                  Increment MINOR version (resets PATCH to 0)
  major                  Increment MAJOR version (resets MINOR and PATCH to 0)
  X.Y.Z, vX.Y.Z          Set explicit semantic version

Options:
  --dry-run              Preview planned file modifications and git operations
  --push                 Push release commit and tag to remote origin
  --no-commit            Update version files and lockfiles only; skip git commit and tag
  --no-tag               Create git commit but skip creating release tag
  --allow-dirty          Allow running with existing uncommitted working tree changes
  -h, --help             Show this help information

Synchronized Release Locations (13):
  1. apps/browser-extension/package.json
  2. apps/native/package.json
  3. apps/native/src-tauri/Cargo.toml
  4. apps/native/src-tauri/Cargo.lock
  5. apps/native/src-tauri/tauri.conf.json
  6. apps/web/package.json
  7. packages/browser-bridge/package.json
  8. packages/shared/package.json
  9. packages/ui/package.json
 10. server/Cargo.toml
 11. server/Cargo.lock
 12. scripts/run-uat.sh
 13. tests/deploy/linux-release-rootless-smoke.sh
 (optional: apps/native/src-tauri/gen/android/app/tauri.properties)
`);
}

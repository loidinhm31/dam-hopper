#!/usr/bin/env node
/**
 * Strict release version alignment checker for DamHopper Linux releases.
 * Validates that Git tag, server/Cargo.toml, and apps/web/package.json match exactly.
 * Optionally verifies compiled binaries if passed via --bin.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const SEMVER_TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SEMVER_BARE_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseArgs() {
  const args = process.argv.slice(2);
  let expectedTag =
    process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || null;
  const binaries = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--bin" && i + 1 < args.length) {
      binaries.push(args[++i]);
    } else if (!arg.startsWith("--") && !expectedTag) {
      expectedTag = arg;
    } else {
      console.error(`Unknown or unexpected argument: ${arg}`);
      process.exit(1);
    }
  }

  return { expectedTag, binaries };
}

function getCargoVersion(cargoPath) {
  const content = readFileSync(cargoPath, "utf8");
  const packageMatch = content.match(
    /\[package\][^\[]*?version\s*=\s*"([^"]+)"/s,
  );
  if (!packageMatch) {
    throw new Error(`Could not extract [package].version from ${cargoPath}`);
  }
  return packageMatch[1].trim();
}

function getWebVersion(pkgJsonPath) {
  const content = readFileSync(pkgJsonPath, "utf8");
  const parsed = JSON.parse(content);
  if (!parsed.version) {
    throw new Error(`Could not extract version from ${pkgJsonPath}`);
  }
  return parsed.version.trim();
}

function main() {
  const { expectedTag, binaries } = parseArgs();

  const cargoPath = resolve(REPO_ROOT, "server/Cargo.toml");
  const webPkgPath = resolve(REPO_ROOT, "apps/web/package.json");

  if (!existsSync(cargoPath)) {
    console.error(`Cargo.toml not found at: ${cargoPath}`);
    process.exit(1);
  }
  if (!existsSync(webPkgPath)) {
    console.error(`Web package.json not found at: ${webPkgPath}`);
    process.exit(1);
  }

  const cargoVersion = getCargoVersion(cargoPath);
  const webVersion = getWebVersion(webPkgPath);

  if (!SEMVER_BARE_REGEX.test(cargoVersion)) {
    console.error(
      `server/Cargo.toml version '${cargoVersion}' does not match SemVer format MAJOR.MINOR.PATCH`,
    );
    process.exit(1);
  }
  if (!SEMVER_BARE_REGEX.test(webVersion)) {
    console.error(
      `apps/web/package.json version '${webVersion}' does not match SemVer format MAJOR.MINOR.PATCH`,
    );
    process.exit(1);
  }

  if (cargoVersion !== webVersion) {
    console.error(`Version mismatch between components:
  server/Cargo.toml:    ${cargoVersion}
  apps/web/package.json: ${webVersion}`);
    process.exit(1);
  }

  const canonicalVersion = cargoVersion;
  const canonicalTag = `v${canonicalVersion}`;

  if (expectedTag) {
    let normalizedExpectedVersion;
    if (SEMVER_TAG_REGEX.test(expectedTag)) {
      normalizedExpectedVersion = expectedTag.slice(1);
    } else if (SEMVER_BARE_REGEX.test(expectedTag)) {
      normalizedExpectedVersion = expectedTag;
    } else {
      console.error(
        `Invalid tag/version argument '${expectedTag}'. Must be vX.Y.Z or X.Y.Z`,
      );
      process.exit(1);
    }

    if (normalizedExpectedVersion !== canonicalVersion) {
      console.error(`Provided release tag '${expectedTag}' does not match repository version '${canonicalVersion}'
  Expected tag: ${canonicalTag}
  Got:          ${expectedTag}`);
      process.exit(1);
    }
  }

  // Verify any requested binaries
  for (const binPath of binaries) {
    const fullBinPath = resolve(process.cwd(), binPath);
    if (!existsSync(fullBinPath)) {
      console.error(`Binary to verify not found: ${fullBinPath}`);
      process.exit(1);
    }
    try {
      const output = execFileSync(fullBinPath, ["--version"], {
        encoding: "utf8",
      });
      if (!output.includes(canonicalVersion)) {
        console.error(
          `Binary '${binPath}' --version output does not contain '${canonicalVersion}':\n${output}`,
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(`Failed to execute '${binPath} --version': ${err.message}`);
      process.exit(1);
    }
  }

  console.log(
    `✓ Release version alignment verified: ${canonicalTag} (${canonicalVersion})`,
  );
}

main();

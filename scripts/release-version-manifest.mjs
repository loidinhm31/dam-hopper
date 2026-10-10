/**
 * Version synchronization manifest and file modifiers for DamHopper release files.
 * Manages the 13 required repository release files and optional Android config.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseSemver } from "./release-version-semver.mjs";

/**
 * Read current canonical version from server/Cargo.toml and apps/web/package.json.
 */
export function getCanonicalCurrentVersion(repoRoot) {
  const cargoPath = resolve(repoRoot, "server/Cargo.toml");
  const webPkgPath = resolve(repoRoot, "apps/web/package.json");

  if (!existsSync(cargoPath)) {
    throw new Error(`server/Cargo.toml not found at: ${cargoPath}`);
  }
  if (!existsSync(webPkgPath)) {
    throw new Error(`apps/web/package.json not found at: ${webPkgPath}`);
  }

  const cargoContent = readFileSync(cargoPath, "utf8");
  const cargoMatch = cargoContent.match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  );
  if (!cargoMatch) {
    throw new Error(`Could not extract [package].version from ${cargoPath}`);
  }
  const cargoVer = cargoMatch[1].trim();

  const webContent = readFileSync(webPkgPath, "utf8");
  const webPkg = JSON.parse(webContent);
  const webVer = (webPkg.version || "").trim();

  if (cargoVer !== webVer) {
    throw new Error(
      `Repository version is currently misaligned!\n  server/Cargo.toml:    ${cargoVer}\n  apps/web/package.json: ${webVer}`,
    );
  }

  return cargoVer;
}

/**
 * Update JSON file top-level version field.
 */
export function updateJsonVersion(filePath, newVersion, dryRun = false) {
  const content = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content);
  const oldVersion = parsed.version;
  parsed.version = newVersion;
  const newContent = JSON.stringify(parsed, null, 2) + "\n";
  if (!dryRun) {
    writeFileSync(filePath, newContent, "utf8");
  }
  return { oldVersion, newVersion, modified: oldVersion !== newVersion };
}

/**
 * Update Cargo.toml [package].version field cleanly.
 */
export function updateCargoTomlVersion(filePath, newVersion, dryRun = false) {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m);
  if (!match) {
    throw new Error(`Could not find [package].version in ${filePath}`);
  }
  const oldVersion = content.match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )[1];
  const newContent = content.replace(
    /^(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${newVersion}$2`,
  );
  if (!dryRun) {
    writeFileSync(filePath, newContent, "utf8");
  }
  return { oldVersion, newVersion, modified: oldVersion !== newVersion };
}

/**
 * Update scripts/run-uat.sh version occurrences.
 */
export function updateUatScriptVersion(filePath, currentVersion, newVersion, dryRun = false) {
  const content = readFileSync(filePath, "utf8");
  const pattern1 = `"releaseVersion": "${currentVersion}"`;
  const replace1 = `"releaseVersion": "${newVersion}"`;
  const pattern2 = `--release-version "${currentVersion}"`;
  const replace2 = `--release-version "${newVersion}"`;

  if (!content.includes(pattern1)) {
    throw new Error(`Could not find '${pattern1}' in ${filePath}`);
  }
  if (!content.includes(pattern2)) {
    throw new Error(`Could not find '${pattern2}' in ${filePath}`);
  }

  const updated = content.replace(pattern1, replace1).replace(pattern2, replace2);
  if (!dryRun) {
    writeFileSync(filePath, updated, "utf8");
  }
  return { oldVersion: currentVersion, newVersion, modified: true };
}

/**
 * Update tests/deploy/linux-release-rootless-smoke.sh version occurrence.
 */
export function updateSmokeScriptVersion(filePath, currentVersion, newVersion, dryRun = false) {
  const content = readFileSync(filePath, "utf8");
  const pattern = `RELEASE_VERSION="\${DAM_HOPPER_RELEASE_VERSION:-${currentVersion}}"`;
  const replace = `RELEASE_VERSION="\${DAM_HOPPER_RELEASE_VERSION:-${newVersion}}"`;

  if (!content.includes(pattern)) {
    throw new Error(`Could not find '${pattern}' in ${filePath}`);
  }

  const updated = content.replace(pattern, replace);
  if (!dryRun) {
    writeFileSync(filePath, updated, "utf8");
  }
  return { oldVersion: currentVersion, newVersion, modified: true };
}

/**
 * Optionally update Android tauri.properties if present.
 */
export function updateAndroidTauriProperties(filePath, newVersion, dryRun = false) {
  if (!existsSync(filePath)) {
    return null;
  }
  const content = readFileSync(filePath, "utf8");
  const [major, minor, patch] = parseSemver(newVersion);
  const versionCode = major * 10000 + minor * 1000 + patch;

  let updated = content.replace(
    /tauri\.android\.versionName=.*/,
    `tauri.android.versionName=${newVersion}`,
  );
  updated = updated.replace(
    /tauri\.android\.versionCode=.*/,
    `tauri.android.versionCode=${versionCode}`,
  );

  if (!dryRun) {
    writeFileSync(filePath, updated, "utf8");
  }
  return { newVersion, versionCode };
}

/**
 * Update all non-lockfile synchronized version locations.
 * Returns array of repository-relative file paths that were processed.
 */
export function updateAllSynchronizedLocations(repoRoot, currentVersion, newVersion, dryRun = false) {
  const processedFiles = [];

  const updateTargets = [
    { rel: "apps/browser-extension/package.json", type: "json" },
    { rel: "apps/native/package.json", type: "json" },
    { rel: "apps/native/src-tauri/Cargo.toml", type: "cargo" },
    { rel: "apps/native/src-tauri/tauri.conf.json", type: "json" },
    { rel: "apps/web/package.json", type: "json" },
    { rel: "packages/browser-bridge/package.json", type: "json" },
    { rel: "packages/shared/package.json", type: "json" },
    { rel: "packages/ui/package.json", type: "json" },
    { rel: "server/Cargo.toml", type: "cargo" },
    { rel: "scripts/run-uat.sh", type: "uat" },
    { rel: "tests/deploy/linux-release-rootless-smoke.sh", type: "smoke" },
  ];

  for (const target of updateTargets) {
    const fullPath = resolve(repoRoot, target.rel);
    if (target.type === "json") {
      updateJsonVersion(fullPath, newVersion, dryRun);
    } else if (target.type === "cargo") {
      updateCargoTomlVersion(fullPath, newVersion, dryRun);
    } else if (target.type === "uat") {
      updateUatScriptVersion(fullPath, currentVersion, newVersion, dryRun);
    } else if (target.type === "smoke") {
      updateSmokeScriptVersion(fullPath, currentVersion, newVersion, dryRun);
    }
    processedFiles.push(target.rel);
  }

  // Optional Android properties: updated locally for builds but not staged (gitignored)
  const androidPropRel = "apps/native/src-tauri/gen/android/app/tauri.properties";
  const androidPropFull = resolve(repoRoot, androidPropRel);
  if (existsSync(androidPropFull)) {
    updateAndroidTauriProperties(androidPropFull, newVersion, dryRun);
  }
  return processedFiles;
}

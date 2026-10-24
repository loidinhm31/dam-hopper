#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const versionType = args[0] || "patch"; // patch, minor, major, or specific version like 1.2.3

function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);

  if (type === "major") {
    return `${parts[0] + 1}.0.0`;
  } else if (type === "minor") {
    return `${parts[0]}.${parts[1] + 1}.0`;
  } else if (type === "patch") {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  } else {
    // Assume it's a specific version
    return type;
  }
}

try {
  // Read package.json
  const packageJsonPath = join(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  const currentVersion = packageJson.version;
  const newVersion = bumpVersion(currentVersion, versionType);

  console.log(`Bumping version from ${currentVersion} to ${newVersion}`);

  // Update package.json
  packageJson.version = newVersion;
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
  console.log("✓ Updated package.json");

  // Update Cargo.toml
  const cargoTomlPath = join(process.cwd(), "src-tauri", "Cargo.toml");
  let cargoToml = readFileSync(cargoTomlPath, "utf8");
  cargoToml = cargoToml.replace(
    /^version = ".*"$/m,
    `version = "${newVersion}"`,
  );
  writeFileSync(cargoTomlPath, cargoToml);
  console.log("✓ Updated Cargo.toml");

  // Update tauri.conf.json
  const tauriConfPath = join(process.cwd(), "src-tauri", "tauri.conf.json");
  const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = newVersion;
  writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
  console.log("✓ Updated tauri.conf.json");


  console.log(`\nVersion updated to ${newVersion}`);
  console.log("\nNext steps:");
  console.log("1. git add .");
  console.log(`2. git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`3. git tag v${newVersion}`);
  console.log("4. git push && git push --tags");
} catch (error) {
  console.error("Error updating version:", error);
  process.exit(1);
}

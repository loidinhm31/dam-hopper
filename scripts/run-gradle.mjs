#!/usr/bin/env node
/**
 * Cross-platform Gradle wrapper launcher for native/android-app.
 * Dispatches to gradlew.bat on Windows and gradlew on Unix.
 */

import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const appDir = resolve(repoRoot, "native", "android-app");
const isWin = process.platform === "win32";
const gradlewBin = resolve(appDir, isWin ? "gradlew.bat" : "gradlew");

const args = ["-p", appDir, ...process.argv.slice(2)];

try {
  execFileSync(gradlewBin, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWin,
  });
} catch (err) {
  process.exit(err.status ?? 1);
}

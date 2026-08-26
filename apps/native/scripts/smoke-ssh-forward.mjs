import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

import { validateEvidence } from "./ssh-forward-evidence.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const appDist = resolve(root, "apps/native/dist/index.html");
const tauriConfig = resolve(root, "apps/native/src-tauri/tauri.conf.json");
const windowsPackageConfig = resolve(
  root,
  "apps/native/src-tauri/tauri.windows.package.conf.json",
);
const evidenceSchema = resolve(
  root,
  "apps/native/test-fixtures/ssh-forward/evidence.schema.json",
);
const env = process["env"];
const evidenceFile = resolve(
  root,
  env["SMOKE_EVIDENCE_FILE"] ??
    "artifacts/native-ssh-forward/windows-evidence.json",
);
const artifactFile = env["SMOKE_ARTIFACT_FILE"];

function fail(message) {
  console.error(`native-ssh-forward smoke: ${message}`);
  process.exitCode = 1;
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    fail(`invalid ${label}`);
    return null;
  }
}

function webView2Version() {
  if (process.platform !== "win32") return null;
  const keys = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
  ];
  for (const key of keys) {
    try {
      const output = execFileSync("reg.exe", ["query", key, "/v", "pv"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const match = output.match(/\bREG_SZ\s+([^\r\n]+)/i);
      if (match?.[1]) return match[1].trim();
    } catch {
      // Probe every registry view before failing the preflight.
    }
  }
  return null;
}

function commandVersion(command, args = ["-V"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return (
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .split(/\r?\n/)
      .find(Boolean)
      ?.trim() ?? null
  );
}

function assertBuildInputs() {
  const config = readJson(tauriConfig, "Tauri config");
  const packageConfig = readJson(
    windowsPackageConfig,
    "Windows package config",
  );
  if (!config || !packageConfig) return false;
  if (!existsSync(appDist)) fail("missing native app build output");
  if (!existsSync(evidenceSchema)) fail("missing evidence schema");
  if (config.plugins?.updater)
    fail("runtime updater plugin must remain absent");
  if (config.bundle?.createUpdaterArtifacts !== true)
    fail("metadata-only updater artifacts must remain enabled");
  if (packageConfig.bundle?.createUpdaterArtifacts !== false)
    fail("unsigned Windows packaging must disable updater artifacts");
  return !process.exitCode;
}

function runtimePreflight() {
  if (process.platform !== "win32")
    return fail("runtime preflight is Windows-only");
  const webview = webView2Version();
  const ssh = commandVersion("ssh.exe", ["-V"]);
  const sshd = commandVersion(env["SMOKE_SSHD"] ?? "sshd.exe", ["-V"]);
  if (!webview) fail("WebView2 Evergreen Runtime was not found");
  if (!ssh) fail("Windows OpenSSH client was not found");
  if (!sshd) fail("Windows OpenSSH server was not found");
  if (!process.exitCode) {
    console.log(`native-ssh-forward smoke: WebView2 ${webview}`);
    console.log("native-ssh-forward smoke: OpenSSH runtime preflight PASS");
    console.log(
      "native-ssh-forward smoke: packaged runtime checks remain manual-pending until evidence is submitted",
    );
  }
}

const mode = process.argv[2] ?? "--build-only";
if (mode === "--build-only") {
  if (assertBuildInputs()) {
    console.log(
      "native-ssh-forward smoke: Windows build inputs and updater boundary PASS",
    );
    console.log(
      "native-ssh-forward smoke: package/runtime evidence remains separate",
    );
  }
} else if (mode === "--runtime") runtimePreflight();
else if (mode === "--validate-evidence")
  validateEvidence({ root, evidenceFile, artifactFile });
else fail("unsupported smoke mode");

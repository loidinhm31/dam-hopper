import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const fixturePath = resolve(
  root,
  "apps/native/test-fixtures/browser-debug/index.html",
);
const bridgePath = resolve(root, "packages/browser-bridge/dist/index.iife.js");
const appDistPath = resolve(root, "apps/native/dist/index.html");
const evidencePath = resolve(
  root,
  process.env.DAM_HOPPER_NATIVE_SMOKE_EVIDENCE ??
    "artifacts/native-browser-debug/windows-evidence.json",
);

const requiredChecks = [
  "lifecycle",
  "documentStartTopFrame",
  "documentStartNestedFrame",
  "relayAccepted",
  "relayRejected",
  "navigationPolicy",
  "popupDenied",
  "downloadDenied",
  "profileIsolation",
  "rollback",
];

function fail(message) {
  console.error(`native-browser-debug smoke: ${message}`);
  process.exitCode = 1;
}

function assertFixture() {
  if (!existsSync(fixturePath)) {
    fail(`missing deterministic fixture: ${fixturePath}`);
    return false;
  }
  const fixture = readFileSync(fixturePath, "utf8");
  for (const marker of [
    "Same-origin smoke frame",
    "fixture-popup",
    "denied-download",
    "browser-debug-redirect",
  ]) {
    if (!fixture.includes(marker)) {
      fail(`fixture is missing required marker: ${marker}`);
      return false;
    }
  }
  return true;
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
      // Try the next registry hive/view.
    }
  }
  return null;
}

function validateEvidence() {
  if (!existsSync(evidencePath)) {
    fail(`missing Windows smoke evidence: ${evidencePath}`);
    return;
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  } catch (error) {
    fail(`invalid evidence JSON: ${error}`);
    return;
  }
  if (
    evidence.platform !== "windows" ||
    !evidence.webview2Version ||
    !evidence.commitSha ||
    !evidence.artifactSha256
  ) {
    fail(
      "evidence must identify platform=windows, WebView2, commitSha, and artifactSha256",
    );
  }
  for (const check of requiredChecks) {
    if (evidence.checks?.[check] !== true) {
      fail(`required Windows evidence is not passing: ${check}`);
    }
  }
  if (!process.exitCode)
    console.log(
      `native-browser-debug smoke: evidence PASS (${evidence.webview2Version})`,
    );
}

const mode = process.argv[2] ?? "--build-only";
if (!assertFixture()) process.exit();

if (mode === "--validate-evidence") {
  validateEvidence();
} else if (mode === "--runtime") {
  if (process.platform !== "win32") {
    console.log(
      "native-browser-debug smoke: runtime evidence gate is Windows-only; Linux WebKitGTK runtime verification remains pending",
    );
  } else {
    const version = webView2Version();
    if (!version) {
      fail("WebView2 Evergreen Runtime was not found");
    } else {
      console.log(`native-browser-debug smoke: WebView2 Runtime ${version}`);
      console.log(
        "native-browser-debug smoke: launch the app and record the required checks before validating evidence",
      );
    }
  }
} else if (mode === "--build-only") {
  if (!existsSync(bridgePath)) {
    fail(
      `missing embedded bridge input; run the browser-bridge build first: ${bridgePath}`,
    );
  }
  if (!existsSync(appDistPath)) {
    fail(
      `missing native app build output; run the native build first: ${appDistPath}`,
    );
  }
  if (!process.exitCode) {
    console.log(
      "native-browser-debug smoke: fixture, bridge asset, and app output checks PASS",
    );
    console.log(
      "native-browser-debug smoke: Linux WebKitGTK relay is compiled; packaged runtime verification remains pending",
    );
  }
} else {
  fail(`unknown mode ${mode}`);
}

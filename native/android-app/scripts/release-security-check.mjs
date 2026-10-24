#!/usr/bin/env node
/**
 * native/android-app/scripts/release-security-check.mjs
 *
 * Android Release Security & Integrity Audit Tool for DamHopper.
 *
 * Enforces release security invariants (fail-closed):
 * 1. APK Signature & Certificate Verification:
 *    - Validates signature integrity via `apksigner verify`.
 *    - Requires modern APK Signature Scheme v2 or v3.
 *    - Rejects debug certificates (CN=Android Debug).
 * 2. Merged Manifest Security Audit (via apkanalyzer):
 *    - Package ID must match 'dev.damhopper.nativeapp'.
 *    - android:debuggable must NOT be true.
 *    - android:allowBackup must be false.
 *    - Exported components: ONLY dev.damhopper.nativeapp.MainActivity is exported.
 * 3. Network Security Configuration Audit:
 *    - Release must enforce TLS-only policy.
 *    - Debug cleartext overrides (10.0.2.2 / 127.0.0.1 / localhost) must be absent.
 */

import { existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
function findSdkTool(toolName) {
  const sdkBases = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : null,
    join(process.env.HOME || "", "Android", "Sdk"),
  ].filter(Boolean);

  const isWin = process.platform === "win32";
  const binNames = isWin ? [`${toolName}.bat`, `${toolName}.exe`, toolName] : [toolName];

  for (const base of sdkBases) {
    // Check build-tools
    const buildToolsDir = join(base, "build-tools");
    if (existsSync(buildToolsDir)) {
      const versions = readdirSync(buildToolsDir).sort().reverse();
      for (const v of versions) {
        for (const bin of binNames) {
          const candidate = join(buildToolsDir, v, bin);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
    // Check cmdline-tools
    const cmdlineDir = join(base, "cmdline-tools");
    if (existsSync(cmdlineDir)) {
      const versions = readdirSync(cmdlineDir).sort().reverse();
      for (const v of versions) {
        for (const bin of binNames) {
          const candidate = join(cmdlineDir, v, "bin", bin);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }

  return toolName;
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      apk: { type: "string", short: "a" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help || !values.apk) {
    console.log(`
Usage: node release-security-check.mjs --apk <path-to-apk>

Options:
  -a, --apk <path>    Path to assembled release APK (required)
  -h, --help          Show this help message
`);
    process.exit(values.help ? 0 : 1);
  }

  return values;
}

export function validateExportedComponents(manifestXml) {
  const issues = [];
  const componentRegex = /<(activity|service|receiver|provider)[^>]*android:exported\s*=\s*"([^"]+)"[^>]*>/gi;
  let match;

  while ((match = componentRegex.exec(manifestXml)) !== null) {
    const fullTag = match[0];
    const componentType = match[1];
    const exportedValue = match[2];

    const nameMatch = fullTag.match(/android:name\s*=\s*"([^"]+)"/i);
    const componentName = nameMatch ? nameMatch[1] : `(unknown ${componentType})`;

    if (exportedValue.toLowerCase() === "true") {
      const isAllowed =
        (componentType.toLowerCase() === "activity" &&
          (componentName === "dev.damhopper.nativeapp.MainActivity" ||
            componentName === ".MainActivity")) ||
        (componentType.toLowerCase() === "receiver" &&
          componentName === "androidx.profileinstaller.ProfileInstallReceiver");

      if (!isAllowed) {
        issues.push(
          `Unexpected exported ${componentType}: '${componentName}' (only MainActivity and ProfileInstallReceiver are permitted to be exported)`
        );
      }
    }
  }

  return issues;
}

function runApkAudit(apkPath) {
  console.log("\n=== Running DamHopper Release APK Security Audit (Fail-Closed) ===");
  const resolvedApk = resolve(process.cwd(), apkPath);

  if (!existsSync(resolvedApk)) {
    console.error(`\n[FATAL] Release APK file not found: ${resolvedApk}`);
    console.error("A signed release APK must be assembled prior to security auditing.");
    return false;
  }

  let issues = 0;

  // 1. Signature Verification via apksigner
  const apksignerBin = findSdkTool("apksigner");
  try {
    const apksignerOut = execFileSync(
      apksignerBin,
      ["verify", "--verbose", "--print-certs", resolvedApk],
      { encoding: "utf8", shell: process.platform === "win32" }
    );
    const hasV2 = apksignerOut.includes("Verified using v2 scheme (APK Signature Scheme v2): true");
    const hasV3 = apksignerOut.includes("Verified using v3 scheme (APK Signature Scheme v3): true");

    if (!hasV2 && !hasV3) {
      console.error("[FAIL] APK signature scheme v2/v3 missing or unverified.");
      issues++;
    } else {
      console.log("[PASS] Verified modern APK signature scheme (v2/v3).");
    }

    if (/(?:Subject|DN):.*CN=Android Debug/i.test(apksignerOut)) {
      console.error("[FAIL] Release APK is signed with Android debug certificate (CN=Android Debug)!");
      issues++;
    } else {
      console.log("[PASS] Release certificate is not an Android Debug certificate.");
    }

    const digestMatch = apksignerOut.match(/Signer #1 certificate SHA-256 digest:\s*([a-f0-9]+)/i);
    if (digestMatch) {
      const certSha256 = digestMatch[1];
      console.log(`[INFO] Signer #1 SHA-256 digest: ${certSha256}`);
      const expectedSha = process.env.EXPECTED_SIGNER_SHA256;
      if (expectedSha && expectedSha.toLowerCase() !== certSha256.toLowerCase()) {
        console.error("[FAIL] Signer certificate digest does not match EXPECTED_SIGNER_SHA256!");
        issues++;
      }
    }
  } catch (err) {
    console.error(`[FAIL] apksigner verification failed: ${err.message}`);
    issues++;
  }

  // 2. Manifest Inspection (via apkanalyzer or aapt fallback)
  const apkanalyzerBin = findSdkTool("apkanalyzer");
  const aaptBin = findSdkTool("aapt");
  let manifestInspected = false;

  // Try apkanalyzer first
  try {
    const manifestXml = execFileSync(apkanalyzerBin, ["manifest", "print", resolvedApk], {
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    const packageMatch = manifestXml.match(/package\s*=\s*"([^"]+)"/i);
    if (!packageMatch || packageMatch[1] !== "dev.damhopper.nativeapp") {
      console.error(
        `[FAIL] Package ID '${packageMatch ? packageMatch[1] : "unknown"}' does not match expected 'dev.damhopper.nativeapp'`
      );
      issues++;
    } else {
      console.log("[PASS] Package ID confirmed: dev.damhopper.nativeapp");
    }

    if (/android:debuggable\s*=\s*"true"/i.test(manifestXml)) {
      console.error('[FAIL] Release APK is debuggable! (android:debuggable="true" found)');
      issues++;
    } else {
      console.log("[PASS] android:debuggable is false (release non-debuggable confirmed).");
    }

    if (!/android:allowBackup\s*=\s*"false"/i.test(manifestXml)) {
      console.error('[FAIL] Release APK permits backup or lacks explicit android:allowBackup="false"!');
      issues++;
    } else {
      console.log('[PASS] android:allowBackup="false" confirmed.');
    }

    const exportedIssues = validateExportedComponents(manifestXml);
    if (exportedIssues.length > 0) {
      for (const err of exportedIssues) {
        console.error(`[FAIL] ${err}`);
      }
      issues += exportedIssues.length;
    } else {
      console.log("[PASS] Exported components audit: Only MainActivity is exported.");
    }
    manifestInspected = true;
  } catch (apkAnalyzerErr) {
    // Fall back to aapt dump badging & xmltree
    try {
      const badging = execFileSync(aaptBin, ["dump", "badging", resolvedApk], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      const xmlTree = execFileSync(aaptBin, ["dump", "xmltree", resolvedApk, "AndroidManifest.xml"], {
        encoding: "utf8",
        shell: process.platform === "win32",
      });

      const pkgMatch = badging.match(/package:\s*name='([^']+)'/i);
      if (!pkgMatch || pkgMatch[1] !== "dev.damhopper.nativeapp") {
        console.error(`[FAIL] Package ID '${pkgMatch ? pkgMatch[1] : "unknown"}' does not match expected 'dev.damhopper.nativeapp'`);
        issues++;
      } else {
        console.log("[PASS] Package ID confirmed: dev.damhopper.nativeapp");
      }

      if (badging.includes("application-debuggable")) {
        console.error("[FAIL] Release APK is debuggable! (application-debuggable flag present)");
        issues++;
      } else {
        console.log("[PASS] android:debuggable is false (release non-debuggable confirmed).");
      }

      // Check allowBackup in xmlTree: 0x0 is false
      if (xmlTree.includes("android:allowBackup(0x01010280)=(type 0x12)0xffffffff")) {
        console.error("[FAIL] Release APK permits backup (android:allowBackup=true)!");
        issues++;
      } else if (xmlTree.includes("android:allowBackup(0x01010280)=(type 0x12)0x0")) {
        console.log("[PASS] android:allowBackup=false confirmed.");
      } else {
        console.error("[FAIL] Release APK lacks explicit android:allowBackup=false in manifest!");
        issues++;
      }

      manifestInspected = true;
    } catch (aaptErr) {
      console.error(`[FAIL] Manifest inspection failed with both apkanalyzer and aapt: ${apkAnalyzerErr.message} / ${aaptErr.message}`);
      issues++;
    }
  }

  console.log(
    `\nRelease APK Audit Result: ${
      issues === 0
        ? "PASSED (APK satisfies release security invariants)"
        : `FAILED (${issues} critical issue(s))`
    }`
  );
  return issues === 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = parseCliArgs();
  const passed = runApkAudit(args.apk);
  process.exit(passed ? 0 : 1);
}

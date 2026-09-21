#!/usr/bin/env node
/**
 * Comprehensive test harness for Windows release asset gate, deterministic packaging,
 * and profile composition (linux, windows, all).
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { buildDeterministicZipBuffer } from "../../deploy/release/build-windows-release-archive.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const CHECKER_SCRIPT = resolve(REPO_ROOT, "deploy/release/check-release-assets.mjs");
const PACKAGER_SCRIPT = resolve(REPO_ROOT, "deploy/release/build-windows-release-archive.mjs");

const TEST_TMP_ROOT = resolve(REPO_ROOT, "artifacts/test-asset-gate-" + Date.now());

function cleanup() {
  try {
    if (existsSync(TEST_TMP_ROOT)) {
      rmSync(TEST_TMP_ROOT, { recursive: true, force: true });
    }
  } catch {}
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function computeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
}

function assertThrows(fn, expectedSubstring, message) {
  totalTests++;
  try {
    fn();
    throw new Error(`Expected error containing "${expectedSubstring}", but no error was thrown: ${message}`);
  } catch (err) {
    if (!err.message.includes(expectedSubstring)) {
      throw new Error(
        `Expected error to contain "${expectedSubstring}", got "${err.message}": ${message}`,
      );
    }
    passedTests++;
  }
}

function runChecker(args) {
  return execFileSync(process.execPath, [CHECKER_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function createDummyZip(entries, epoch = 1700000000) {
  return buildDeterministicZipBuffer(entries, epoch);
}

function standardEntries() {
  return [
    { name: "dam-hopper-server.exe", data: Buffer.from("MZ-DUMMY-SERVER-EXE-CONTENT") },
    { name: "dam-hopper.example.toml", data: Buffer.from("[workspace]\nname = 'test'\n") },
    { name: "LICENSE", data: Buffer.from("MIT License\n") },
    { name: "README.md", data: Buffer.from("# DamHopper Windows\n") },
  ];
}

console.log("=== Running Windows Release Asset Gate & Packager Test Suite ===");

mkdirSync(TEST_TMP_ROOT, { recursive: true });

try {
  // -------------------------------------------------------------
  // Test 1: Bounded ZIP Inspection - Positive Case
  // -------------------------------------------------------------
  console.log("\n[Test 1] Valid 4-member Windows ZIP archive");
  {
    const dir = join(TEST_TMP_ROOT, "test1");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const zipBytes = createDummyZip(standardEntries());
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(
      join(dir, "dam-hopper-install.ps1"),
      'param([string]$Version)\nWrite-Host "Install $Version"\n',
    );

    const output = runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]);
    assert(output.includes("Local release asset gate passed"), "Local gate should pass for valid Windows assets");
    assert(output.includes(zipName), "Output should mention zip asset");
    assert(output.includes("dam-hopper-install.ps1"), "Output should mention install.ps1 asset");
  }

  // -------------------------------------------------------------
  // Test 2: ZIP Inspection - Missing required member
  // -------------------------------------------------------------
  console.log("\n[Test 2] ZIP missing required member (dam-hopper-server.exe)");
  {
    const dir = join(TEST_TMP_ROOT, "test2");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const entries = standardEntries().filter((e) => e.name !== "dam-hopper-server.exe");
    // Pack manually or adjust entry list
    const zipBytes = createDummyZip(entries);
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Windows release ZIP must contain exactly 4 members",
      "Reject ZIP missing member",
    );
  }

  // -------------------------------------------------------------
  // Test 3: ZIP Inspection - Extra unexpected member
  // -------------------------------------------------------------
  console.log("\n[Test 3] ZIP with unexpected extra member");
  {
    const dir = join(TEST_TMP_ROOT, "test3");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const entries = [
      ...standardEntries(),
      { name: "extra-file.txt", data: Buffer.from("hello") },
    ];
    const zipBytes = createDummyZip(entries);
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Windows release ZIP must contain exactly 4 members",
      "Reject ZIP with extra member",
    );
  }

  // -------------------------------------------------------------
  // Test 4: ZIP Inspection - Traversal member
  // -------------------------------------------------------------
  console.log("\n[Test 4] ZIP with path traversal member");
  {
    const dir = join(TEST_TMP_ROOT, "test4");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const entries = [
      { name: "../dam-hopper-server.exe", data: Buffer.from("MZ") },
      { name: "dam-hopper.example.toml", data: Buffer.from("test") },
      { name: "LICENSE", data: Buffer.from("MIT") },
      { name: "README.md", data: Buffer.from("test") },
    ];
    const zipBytes = createDummyZip(entries);
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');
    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "ZIP entry must be a root file",
      "Reject ZIP traversal member",
    );
  }

  // -------------------------------------------------------------
  // Test 5: ZIP Inspection - Subdirectory / slash in member name
  // -------------------------------------------------------------
  console.log("\n[Test 5] ZIP with directory separator in member name");
  {
    const dir = join(TEST_TMP_ROOT, "test5");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const entries = [
      { name: "bin/dam-hopper-server.exe", data: Buffer.from("MZ") },
      { name: "dam-hopper.example.toml", data: Buffer.from("test") },
      { name: "LICENSE", data: Buffer.from("MIT") },
      { name: "README.md", data: Buffer.from("test") },
    ];
    const zipBytes = createDummyZip(entries);
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "without directory separators",
      "Reject member with slash",
    );
  }

  // -------------------------------------------------------------
  // Test 6: ZIP Inspection - Corrupt CRC-32
  // -------------------------------------------------------------
  console.log("\n[Test 6] ZIP with corrupted CRC-32");
  {
    const dir = join(TEST_TMP_ROOT, "test6");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const zipBytes = Buffer.from(createDummyZip(standardEntries()));

    // Corrupt CDFH CRC-32 of first entry (at cdOffset + 16)
    // Find EOCD
    let eocd = zipBytes.length - 22;
    const cdOffset = zipBytes.readUInt32LE(eocd + 16);
    zipBytes.writeUInt32LE(0x12345678, cdOffset + 16); // corrupt CRC in CDFH
    zipBytes.writeUInt32LE(0x12345678, 14); // corrupt CRC in LFH

    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "CRC-32 mismatch",
      "Reject corrupted CRC",
    );
  }

  // -------------------------------------------------------------
  // Test 7: ZIP Inspection - Trailing garbage after EOCD
  // -------------------------------------------------------------
  console.log("\n[Test 7] ZIP with trailing bytes after EOCD");
  {
    const dir = join(TEST_TMP_ROOT, "test7");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const validZip = createDummyZip(standardEntries());
    const corruptedZip = Buffer.concat([validZip, Buffer.from("EXTRA_GARBAGE_BYTES")]);

    writeFileSync(join(dir, zipName), corruptedZip);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Trailing bytes detected after EOCD",
      "Reject trailing garbage",
    );
  }

  // -------------------------------------------------------------
  // Test 8: PowerShell Installer Syntax Validation
  // -------------------------------------------------------------
  console.log("\n[Test 8] Malformed PowerShell installer syntax");
  {
    const dir = join(TEST_TMP_ROOT, "test8");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    writeFileSync(join(dir, zipName), createDummyZip(standardEntries()));
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param([string]$Version\nWrite-Host "Unclosed paren\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Bootstrap installer syntax error in dam-hopper-install.ps1",
      "Reject malformed PS1 script",
    );
  }

  // -------------------------------------------------------------
  // Test 9: Windows Profile - Reject Migration Evidence
  // -------------------------------------------------------------
  console.log("\n[Test 9] Windows profile rejects --migration-evidence and gate flag");
  {
    const dir = join(TEST_TMP_ROOT, "test9");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    writeFileSync(join(dir, `dam-hopper-${tag}-windows-x86_64.zip`), createDummyZip(standardEntries()));
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () =>
        runChecker([
          "--profile",
          "windows",
          "--tag",
          tag,
          "--dir",
          dir,
          "--migration-evidence",
          "dummy.json",
        ]),
      "migration evidence is not supported for profile 'windows'",
      "Reject migration evidence for windows profile",
    );

    assertThrows(
      () =>
        runChecker([
          "--profile",
          "windows",
          "--tag",
          tag,
          "--dir",
          dir,
          "--require-migration-gate",
        ]),
      "migration evidence is not supported for profile 'windows'",
      "Reject require-migration-gate for windows profile",
    );
  }

  // -------------------------------------------------------------
  // Test 10: Missing or Extra Assets in Directory
  // -------------------------------------------------------------
  console.log("\n[Test 10] Missing or unexpected files in Windows asset directory");
  {
    const dir = join(TEST_TMP_ROOT, "test10");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    // Only install.ps1, missing zip
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Missing expected release assets",
      "Reject missing zip",
    );

    // Add extra file
    writeFileSync(join(dir, `dam-hopper-${tag}-windows-x86_64.zip`), createDummyZip(standardEntries()));
    writeFileSync(join(dir, "extra-asset.txt"), "unexpected");

    assertThrows(
      () => runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]),
      "Unexpected extra files found in release directory",
      "Reject extra asset in directory",
    );
  }

  // -------------------------------------------------------------
  // Test 11: Linux Profile Default & Invariant Preservation
  // -------------------------------------------------------------
  console.log("\n[Test 11] Linux profile is default and preserves exact 4-asset invariant");
  {
    const dir = join(TEST_TMP_ROOT, "test11");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    // Putting Windows assets in default (Linux) check must fail because it expects Linux assets
    writeFileSync(join(dir, `dam-hopper-${tag}-windows-x86_64.zip`), createDummyZip(standardEntries()));
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    assertThrows(
      () => runChecker(["--tag", tag, "--dir", dir]), // No --profile flag
      "Missing expected release assets",
      "Default profile (Linux) must expect 4 Linux assets, not Windows",
    );
  }

  // -------------------------------------------------------------
  // Test 12: All Profile - Exact 6-Asset Union
  // -------------------------------------------------------------
  console.log("\n[Test 12] All profile requires exact 6-asset union");
  {
    const dir = join(TEST_TMP_ROOT, "test12");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";

    // Create Windows assets
    writeFileSync(join(dir, `dam-hopper-${tag}-windows-x86_64.zip`), createDummyZip(standardEntries()));
    writeFileSync(join(dir, "dam-hopper-install.ps1"), 'param($v)\n');

    // Missing Linux assets
    assertThrows(
      () => runChecker(["--profile", "all", "--tag", tag, "--dir", dir]),
      "Missing expected release assets in",
      "All profile must require all 6 assets",
    );
  }

  // -------------------------------------------------------------
  // Test 13: Deterministic Packager - Two Builds Byte-for-Byte Match
  // -------------------------------------------------------------
  console.log("\n[Test 13] Packager reproducibility (identical bytes & SHA-256)");
  {
    const dir1 = join(TEST_TMP_ROOT, "pkg1");
    const dir2 = join(TEST_TMP_ROOT, "pkg2");
    const dir3 = join(TEST_TMP_ROOT, "pkg3");
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });
    mkdirSync(dir3, { recursive: true });

    const tag = "v0.2.0";
    let binary = resolve(REPO_ROOT, "server/target/x86_64-pc-windows-msvc/release/dam-hopper-server.exe");
    if (!existsSync(binary)) {
      binary = resolve(REPO_ROOT, "server/target/release/dam-hopper-server.exe");
    }
    if (!existsSync(binary)) {
      binary = join(TEST_TMP_ROOT, "mock-dam-hopper-server.exe");
      writeFileSync(binary, Buffer.from("MZ-MOCK-BINARY-CONTENT-FOR-TEST-SUITE"));
    }
    execFileSync(process.execPath, [
      PACKAGER_SCRIPT,
      "--tag", tag,
      "--binary", binary,
      "--output-dir", dir1,
      "--epoch", "1700000000",
    ]);

    execFileSync(process.execPath, [
      PACKAGER_SCRIPT,
      "--tag", tag,
      "--binary", binary,
      "--output-dir", dir2,
      "--epoch", "1700000000",
    ]);

    const archiveName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const bytes1 = readFileSync(join(dir1, archiveName));
    const bytes2 = readFileSync(join(dir2, archiveName));

    assert(bytes1.length === bytes2.length, "Archive lengths must match exactly");
    assert(bytes1.equals(bytes2), "Archive bytes must match byte-for-byte");
    assert(computeSha256(bytes1) === computeSha256(bytes2), "SHA-256 digests must match");

    // Negative check: different epoch produces different digest
    execFileSync(process.execPath, [
      PACKAGER_SCRIPT,
      "--tag", tag,
      "--binary", binary,
      "--output-dir", dir3,
      "--epoch", "1700000100",
    ]);
    const bytes3 = readFileSync(join(dir3, archiveName));
    assert(!bytes1.equals(bytes3), "Altered epoch must produce different archive bytes");
    assert(computeSha256(bytes1) !== computeSha256(bytes3), "Altered epoch must produce different digest");
  }

  // -------------------------------------------------------------
  // Test 14: Remote metadata comparison with --profile windows
  // -------------------------------------------------------------
  console.log("\n[Test 14] Remote metadata check with --assets-json for Windows profile");
  {
    const dir = join(TEST_TMP_ROOT, "test14");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const zipBytes = createDummyZip(standardEntries());
    const ps1Bytes = Buffer.from('param($v)\n');

    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(join(dir, "dam-hopper-install.ps1"), ps1Bytes);

    const remoteMetadata = [
      {
        name: "dam-hopper-install.ps1",
        size: ps1Bytes.length,
        state: "uploaded",
        digest: computeSha256(ps1Bytes),
      },
      {
        name: zipName,
        size: zipBytes.length,
        state: "uploaded",
        digest: computeSha256(zipBytes),
      },
    ];
    const remotePath = join(TEST_TMP_ROOT, "test14-remote-assets.json");
    writeFileSync(remotePath, JSON.stringify(remoteMetadata));

    const output = runChecker([
      "--profile", "windows",
      "--tag", tag,
      "--dir", dir,
      "--assets-json", remotePath,
    ]);
    assert(output.includes("Remote release asset gate passed: exactly 2 assets match"), "Remote gate should pass for 2 Windows assets");
  }

  // -------------------------------------------------------------
  // Test 15: Directory and script path containing spaces
  // -------------------------------------------------------------
  console.log("\n[Test 15] Asset directory and PowerShell script with spaces in path");
  {
    const dir = join(TEST_TMP_ROOT, "test 15 with spaces");
    mkdirSync(dir, { recursive: true });
    const tag = "v0.1.0";
    const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
    const zipBytes = createDummyZip(standardEntries());
    writeFileSync(join(dir, zipName), zipBytes);
    writeFileSync(
      join(dir, "dam-hopper-install.ps1"),
      'param([string]$Version)\nWrite-Host "Space path safe $Version"\n',
    );

    const output = runChecker(["--profile", "windows", "--tag", tag, "--dir", dir]);
    assert(output.includes("Local release asset gate passed"), "Local gate should pass with spaces in directory path");
  }

  console.log(`\n=============================================================`);
  console.log(`ALL TESTS PASSED: ${passedTests}/${totalTests} assertions verified.`);
  console.log(`=============================================================\n`);
} finally {
  cleanup();
}

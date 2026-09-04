#!/usr/bin/env node
/**
 * Strict validator for DamHopper Linux release runtime evidence artifacts.
 *
 * Verifies that:
 * 1. Evidence adheres to schema version 1 and protocol contract.
 * 2. Commit binding matches exact expected git SHA.
 * 3. Tag and archive SHA256 match expected release metadata if provided.
 * 4. OS and platform match Fedora 44 x86_64 / systemd 259+.
 * 5. All validation suites reported passing terminal status.
 * 6. Evidence contains zero secrets, tokens, env bodies, or credential leaks.
 */

import { readFileSync, existsSync } from "node:fs";

const COMMIT_REGEX = /^[0-9a-f]{40}$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const FORBIDDEN_SECRET_KEYS = [
  "token",
  "secret",
  "password",
  "credential",
  "authorization",
  "cookie",
  "private_key",
  "mongodb_uri",
];

function parseArgs() {
  const args = process.argv.slice(2);
  let evidencePath = null;
  let expectedCommit = process.env.EXPECTED_COMMIT || null;
  let expectedTag = process.env.EXPECTED_TAG || null;
  let expectedArchiveDigest = process.env.EXPECTED_ARCHIVE_DIGEST || null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--evidence" && i + 1 < args.length) {
      evidencePath = args[++i];
    } else if (arg === "--expected-commit" && i + 1 < args.length) {
      expectedCommit = args[++i];
    } else if (arg === "--expected-tag" && i + 1 < args.length) {
      expectedTag = args[++i];
    } else if (arg === "--expected-archive-digest" && i + 1 < args.length) {
      expectedArchiveDigest = args[++i];
    } else if (!arg.startsWith("--") && !evidencePath) {
      evidencePath = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!evidencePath) {
    console.error(
      "Usage: node linux-release-evidence-check.mjs --evidence <path/to/evidence.json> --expected-commit <sha> [--expected-tag <tag>] [--expected-archive-digest <sha256>]",
    );
    process.exit(1);
  }

  return { evidencePath, expectedCommit, expectedTag, expectedArchiveDigest };
}

function checkNoSecrets(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_SECRET_KEYS) {
      if (lowerKey.includes(forbidden)) {
        throw new Error(
          `Sanitization violation: evidence contains forbidden key '${currentPath}'`,
        );
      }
    }
    if (typeof value === "object" && value !== null) {
      checkNoSecrets(value, currentPath);
    }
  }
}

function validateEvidence(evidence, opts) {
  if (evidence.schemaVersion !== 1) {
    throw new Error(
      `Invalid schemaVersion: expected 1, got ${evidence.schemaVersion}`,
    );
  }

  if (evidence.protocol !== "dam-hopper-linux-release-evidence") {
    throw new Error(
      `Invalid protocol: expected 'dam-hopper-linux-release-evidence', got '${evidence.protocol}'`,
    );
  }

  if (!COMMIT_REGEX.test(evidence.commitSha)) {
    throw new Error(`Invalid commitSha format: '${evidence.commitSha}'`);
  }

  if (opts.expectedCommit && evidence.commitSha !== opts.expectedCommit) {
    throw new Error(
      `Commit binding mismatch: evidence has '${evidence.commitSha}', expected '${opts.expectedCommit}'`,
    );
  }

  if (!TAG_REGEX.test(evidence.tag)) {
    throw new Error(`Invalid release tag format: '${evidence.tag}'`);
  }

  if (opts.expectedTag && evidence.tag !== opts.expectedTag) {
    throw new Error(
      `Tag mismatch: evidence has '${evidence.tag}', expected '${opts.expectedTag}'`,
    );
  }

  if (!SHA256_REGEX.test(evidence.archiveDigest)) {
    throw new Error(
      `Invalid archiveDigest format: '${evidence.archiveDigest}'`,
    );
  }

  if (
    opts.expectedArchiveDigest &&
    evidence.archiveDigest !== opts.expectedArchiveDigest
  ) {
    throw new Error(
      `Archive digest mismatch: evidence has '${evidence.archiveDigest}', expected '${opts.expectedArchiveDigest}'`,
    );
  }

  // OS / Platform verification
  if (!evidence.platform || typeof evidence.platform !== "object") {
    throw new Error("Missing 'platform' metadata in evidence");
  }

  const { osId, osVersion, arch, systemdVersion, glibcVersion, selinux } =
    evidence.platform;
  if (osId !== "fedora" || osVersion !== "44" || arch !== "x86_64") {
    throw new Error(
      `Unsupported platform evidence: ${osId} ${osVersion} ${arch} (expected fedora 44 x86_64)`,
    );
  }

  if (typeof systemdVersion !== "number" || systemdVersion < 259) {
    throw new Error(
      `Unsupported systemd version: ${systemdVersion} (minimum 259)`,
    );
  }

  if (typeof glibcVersion !== "string" || !glibcVersion.trim()) {
    throw new Error("Missing or invalid 'glibcVersion' in platform evidence");
  }
  const [major, minor] = glibcVersion.split(".").map(Number);
  if (
    isNaN(major) ||
    isNaN(minor) ||
    major < 2 ||
    (major === 2 && minor < 43)
  ) {
    throw new Error(
      `Unsupported glibc version: ${glibcVersion} (minimum 2.43)`,
    );
  }

  if (selinux !== "Enforcing") {
    throw new Error(
      `SELinux must be Enforcing in platform evidence (got '${selinux}')`,
    );
  }

  if (evidence.publish !== false) {
    throw new Error("Runtime evidence must declare publish=false");
  }

  if (!evidence.workflow || typeof evidence.workflow !== "object") {
    throw new Error("Missing workflow execution metadata");
  }
  if (!/^[0-9]+$/.test(String(evidence.workflow.runId || ""))) {
    throw new Error("Workflow runId must be a numeric identifier");
  }
  if (!/^[0-9]+$/.test(String(evidence.workflow.runAttempt || ""))) {
    throw new Error("Workflow runAttempt must be a numeric identifier");
  }

  // Suite results verification
  if (!evidence.suites || typeof evidence.suites !== "object") {
    throw new Error("Missing 'suites' execution records in evidence");
  }
  const requiredSuites = [
    "cleanInstall",
    "upgradeRollback",
    "crashRecovery",
    "migration",
    "security",
    "webContract",
    "rootlessSmoke",
    "protectedRuntime",
  ];
  for (const suite of requiredSuites) {
    const result = evidence.suites[suite];
    if (!result || typeof result !== "object") {
      throw new Error(`Missing required test suite result for '${suite}'`);
    }
    if (result.status !== "passed") {
      throw new Error(
        `Test suite '${suite}' did not pass: status '${result.status}'`,
      );
    }
    if (
      result.execution !== "deterministic" &&
      result.execution !== "rootless" &&
      result.execution !== "protected"
    ) {
      throw new Error(
        `Test suite '${suite}' must declare deterministic or protected execution`,
      );
    }
    if (typeof result.command !== "string" || !result.command.trim()) {
      throw new Error(`Test suite '${suite}' is missing its command record`);
    }
    if (typeof result.startedAt !== "string" || typeof result.finishedAt !== "string") {
      throw new Error(`Test suite '${suite}' is missing bounded timestamps`);
    }
  }
  if (evidence.suites.protectedRuntime.execution !== "protected") {
    throw new Error("protectedRuntime must be executed on the protected host");
  }

  // Deep sanitization check
  checkNoSecrets(evidence);

}

function main() {
  const opts = parseArgs();

  if (!existsSync(opts.evidencePath)) {
    console.error(`Error: Evidence file not found: ${opts.evidencePath}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(opts.evidencePath, "utf8");
  } catch (err) {
    console.error(`Error reading evidence file: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Error parsing evidence JSON: ${err.message}`);
    process.exit(1);
  }

  try {
    validateEvidence(parsed, opts);
  } catch (err) {
    console.error(`Evidence validation FAILED: ${err.message}`);
    process.exit(1);
  }

  console.log(
    `✓ Runtime evidence verified for commit ${parsed.commitSha} (${parsed.tag}) on Fedora ${parsed.platform.osVersion} (${parsed.platform.arch})`,
  );
}

main();

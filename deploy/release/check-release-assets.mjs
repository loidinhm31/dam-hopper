#!/usr/bin/env node
/**
 * Pre-publication exact release asset gate for DamHopper Linux releases.
 * Compares release assets against the strict four-subject invariant:
 *   1. dam-hopper-install.sh
 *   2. dam-hopper-vX.Y.Z-linux-x86_64-systemd.tar.gz
 *   3. release-manifest.json
 *   4. dam-hopper-vX.Y.Z-linux-x86_64-systemd.spdx.json
 *
 * Fails closed on any extra, missing, empty, or mismatched asset.
 */

import {
  closeSync,
  constants as FS_CONSTANTS,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { resolve, basename, dirname, isAbsolute, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
const TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;
const ISO_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;
const MIGRATION_EVIDENCE_SCHEMA_VERSION = 1;
const RELEASE_MANIFEST_SCHEMA_VERSION = 2;
const MANAGER_STATE_SCHEMA_VERSION = 1;
const MIGRATION_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MIGRATION_EVIDENCE_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MIGRATION_EVIDENCE_BYTES = 1024 * 1024;
const MAX_SBOM_BYTES = 16 * 1024 * 1024;
const MAX_RELEASE_ASSET_BYTES = 500 * 1024 * 1024;
const MAX_REMOTE_ASSET_METADATA_BYTES = 1024 * 1024;
const MAX_MANAGER_INVENTORY_TARGETS = 1024;
const MAX_MANAGER_ID_BYTES = 128;
const ATTESTATION_PROVIDER = "github-actions-attestation";
const RELEASE_PROFILE = Object.freeze({
  id: "linux-x86_64-systemd",
  osId: "linux",
  osVersion: "any",
  arch: "x86_64",
  target: "x86_64-unknown-linux-gnu",
  glibcMin: "2.39",
  systemdMin: 245,
});
const REQUIRED_INVENTORY_PATHS = Object.freeze([
  "bin/dam-hopper-manager",
  "bin/dam-hopper-server",
  "bin/dam-hopper-idle-suspend-helper",
  "bin/dam-hopper-plugin-runner",
  "bin/dam-hopper-web",
  "web",
  "systemd/dam-hopper-api.service",
  "systemd/dam-hopper-idle-suspend-helper.service",
  "systemd/dam-hopper-plugin-runner.service",
  "systemd/dam-hopper-web.service",
  "systemd/dam-hopper-recovery.service",
  "sysusers.d/dam-hopper-web.conf",
  "tmpfiles.d/dam-hopper-plugin-runner.conf",
]);

const DISALLOWED_INVENTORY_NAMES = new Set([
  ".env",
  "server.env",
  "server-safety.env",
  "dam-hopper.toml",
  "config.toml",
  "server-token",
]);

function failMigration(message) {
  throw new Error(`Migration gate: ${message}`);
}
function failAsset(message) {
  throw new Error(message);
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failMigration(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    failMigration(
      `${label} must contain exactly: ${expected.join(", ")}`,
    );
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    failMigration(`${label} must be a non-empty string`);
  }
  return value;
}

function requireBoundedString(value, label, maxBytes) {
  const string = requireString(value, label);
  if (Buffer.byteLength(string, "utf8") > maxBytes) {
    failMigration(`${label} exceeds ${maxBytes} UTF-8 bytes`);
  }
  return string;
}

function requireTag(value, label) {
  requireString(value, label);
  if (!TAG_REGEX.test(value)) {
    failMigration(`${label} must be a stable vMAJOR.MINOR.PATCH tag`);
  }
  return value;
}

function requireSha256(value, label) {
  requireString(value, label);
  if (!SHA256_REGEX.test(value)) {
    failMigration(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireSchemaVersion(value, expected, label) {
  if (value !== expected) {
    failMigration(`${label} must be schema version ${expected}, got ${value}`);
  }
}
function requireVersion(value, label) {
  requireString(value, label);
  if (!VERSION_REGEX.test(value)) {
    failMigration(`${label} must be a semantic MAJOR.MINOR.PATCH version`);
  }
  return value;
}
function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function requireCommitSha(value, label) {
  requireString(value, label);
  if (!COMMIT_SHA_REGEX.test(value)) {
    failMigration(`${label} must be a lowercase 40-character commit SHA`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    failMigration(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function validateInventoryPath(value, label) {
  requireString(value, label);
  if (
    Buffer.byteLength(value, "utf8") > 255 ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    failMigration(`${label} must be a normalized relative path`);
  }
  const lower = value.toLowerCase();
  const fileName = lower.split("/").at(-1);
  if (
    DISALLOWED_INVENTORY_NAMES.has(fileName) ||
    fileName.startsWith(".env.") ||
    lower.endsWith(".sqlite") ||
    lower.endsWith(".sqlite-wal") ||
    lower.endsWith(".sqlite-shm") ||
    lower.endsWith(".db")
  ) {
    failMigration(`${label} is a disallowed runtime file`);
  }
  return value;
}

function validateInventory(inventory, label) {
  if (
    !Array.isArray(inventory) ||
    inventory.length === 0 ||
    inventory.length > 20_000
  ) {
    failMigration(`${label} must contain 1..20000 entries`);
  }
  const seenPaths = new Set();
  const required = new Set(REQUIRED_INVENTORY_PATHS);
  let hasWebPayload = false;
  let hasLicenseOrNotices = false;
  const roles = new Set(["common", "server", "web"]);

  for (const [index, entry] of inventory.entries()) {
    const entryLabel = `${label}[${index}]`;
    const isFile = entry?.kind === "file";
    if (isFile) {
      assertExactKeys(
        entry,
        ["path", "kind", "roles", "mode", "size", "sha256"],
        entryLabel,
      );
    } else if (entry?.kind === "dir") {
      assertExactKeys(entry, ["path", "kind", "roles", "mode"], entryLabel);
    } else {
      failMigration(`${entryLabel}.kind must be file or dir`);
    }

    const path = validateInventoryPath(entry.path, `${entryLabel}.path`);
    if (seenPaths.has(path)) {
      failMigration(`duplicate inventory path '${path}'`);
    }
    seenPaths.add(path);
    required.delete(path);

    if (
      !Array.isArray(entry.roles) ||
      entry.roles.length === 0 ||
      new Set(entry.roles).size !== entry.roles.length ||
      entry.roles.some((role) => !roles.has(role))
    ) {
      failMigration(`${entryLabel}.roles must contain unique release roles`);
    }
    requireInteger(entry.mode, `${entryLabel}.mode`);
    if (entry.mode > 0o7777) {
      failMigration(`${entryLabel}.mode exceeds 07777`);
    }
    if (isFile) {
      requireInteger(entry.size, `${entryLabel}.size`);
      requireSha256(entry.sha256, `${entryLabel}.sha256`);
    }

    const requires = (role, executable = false) => {
      if (!entry.roles.includes(role) || (executable && (entry.mode & 0o111) === 0)) {
        failMigration(`${entryLabel} has an invalid role or mode`);
      }
    };
    switch (path) {
      case "bin/dam-hopper-manager":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("common", true);
        break;
      case "bin/dam-hopper-server":
      case "bin/dam-hopper-idle-suspend-helper":
      case "bin/dam-hopper-plugin-runner":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("server", true);
        break;
      case "bin/dam-hopper-web":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("web", true);
        break;
      case "systemd/dam-hopper-api.service":
      case "systemd/dam-hopper-idle-suspend-helper.service":
      case "systemd/dam-hopper-plugin-runner.service":
      case "tmpfiles.d/dam-hopper-plugin-runner.conf":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("server");
        break;
      case "systemd/dam-hopper-web.service":
      case "sysusers.d/dam-hopper-web.conf":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("web");
        break;
      case "systemd/dam-hopper-recovery.service":
      case "LICENSE":
      case "NOTICES":
        if (!isFile) failMigration(`${entryLabel} must be a file`);
        requires("common");
        hasLicenseOrNotices = true;
        break;
      default:
        if (path === "web") {
          if (isFile) {
            failMigration(`${entryLabel} must be a directory`);
          }
          if (!entry.roles.includes("web")) {
            failMigration(`${entryLabel} must belong to the web role`);
          }
        } else if (path.startsWith("web/")) {
          if (!entry.roles.includes("web")) {
            failMigration(`${entryLabel} must belong to the web role`);
          }
          hasWebPayload = true;
        }
    }
  }
  if (required.size > 0 || !hasWebPayload || !hasLicenseOrNotices) {
    const missing = [
      ...required,
      ...(hasWebPayload ? [] : ["web/<payload>"]),
      ...(hasLicenseOrNotices ? [] : ["LICENSE or NOTICES"]),
    ];
    failMigration(`${label} is missing required paths: ${missing.join(", ")}`);
  }
}

function validateManifestShape(manifest, label) {
  assertExactKeys(
    manifest,
    [
      "schemaVersion",
      "release",
      "profile",
      "archive",
      "components",
      "inventory",
      "services",
      "rollback",
    ],
    label,
  );
  if (
    manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION &&
    manifest.schemaVersion !== 3
  ) {
    failMigration(`${label}.schemaVersion expected schema version 2 or 3, got ${manifest.schemaVersion}`);
  }

  assertExactKeys(manifest.release, ["tag", "version", "commitSha"], `${label}.release`);
  const tag = requireTag(manifest.release.tag, `${label}.release.tag`);
  const version = requireVersion(manifest.release.version, `${label}.release.version`);
  requireCommitSha(manifest.release.commitSha, `${label}.release.commitSha`);
  if (tag.slice(1) !== version) {
    failMigration(`${label}.release.tag and version must agree`);
  }

  assertExactKeys(
    manifest.profile,
    ["id", "osId", "osVersion", "arch", "target", "glibcMin", "systemdMin"],
    `${label}.profile`,
  );
  for (const [field, expected] of Object.entries(RELEASE_PROFILE)) {
    if (manifest.profile[field] !== expected) {
      failMigration(`${label}.profile.${field} must be ${expected}`);
    }
  }

  assertExactKeys(manifest.archive, ["name", "size", "sha256"], `${label}.archive`);
  if (
    manifest.archive.name !==
    `dam-hopper-${tag}-linux-x86_64-systemd.tar.gz`
  ) {
    failMigration(`${label}.archive.name must be the v2 Linux archive`);
  }
  requireInteger(manifest.archive.size, `${label}.archive.size`, 1);
  requireSha256(manifest.archive.sha256, `${label}.archive.sha256`);

  const expectedComponents = ["cli", "api", "webHost", "webAssets"];
  if (manifest.components.runner) {
    expectedComponents.push("runner");
  }
  assertExactKeys(
    manifest.components,
    expectedComponents,
    `${label}.components`,
  );
  for (const [component, value] of Object.entries(manifest.components)) {
    assertExactKeys(value, ["version"], `${label}.components.${component}`);
    if (value.version !== version) {
      failMigration(`${label}.components.${component}.version must match release.version`);
    }
    requireVersion(value.version, `${label}.components.${component}.version`);
  }

  validateInventory(manifest.inventory, `${label}.inventory`);

  const expectedServices = ["api", "web"];
  if (manifest.services.runner) {
    expectedServices.push("runner");
  }
  assertExactKeys(manifest.services, expectedServices, `${label}.services`);
  assertExactKeys(
    manifest.services.api,
    ["unitName", "bindHost", "port", "healthPath"],
    `${label}.services.api`,
  );
  if (
    manifest.services.api.unitName !== "dam-hopper-api.service" ||
    manifest.services.api.bindHost !== "0.0.0.0" ||
    manifest.services.api.port !== 4801 ||
    manifest.services.api.healthPath !== "/api/health"
  ) {
    failMigration(`${label}.services.api does not match the fixed API contract`);
  }
  assertExactKeys(
    manifest.services.web,
    ["unitName", "identity", "bindHost", "port", "healthPath"],
    `${label}.services.web`,
  );
  if (
    manifest.services.web.unitName !== "dam-hopper-web.service" ||
    manifest.services.web.identity !== "dam-hopper-web" ||
    manifest.services.web.bindHost !== "0.0.0.0" ||
    manifest.services.web.port !== 4802 ||
    manifest.services.web.healthPath !== "/__dam-hopper/health"
  ) {
    failMigration(`${label}.services.web does not match the fixed web contract`);
  }
  if (manifest.services.runner) {
    assertExactKeys(
      manifest.services.runner,
      ["unitName", "socketPath"],
      `${label}.services.runner`,
    );
    if (
      manifest.services.runner.unitName !== "dam-hopper-plugin-runner.service" ||
      manifest.services.runner.socketPath !== "/run/dam-hopper/plugin-runner.sock"
    ) {
      failMigration(`${label}.services.runner does not match the fixed runner contract`);
    }
  }

  assertExactKeys(
    manifest.rollback,
    ["previousReleaseCompatible", "stateCompatibility"],
    `${label}.rollback`,
  );
  if (
    manifest.rollback.previousReleaseCompatible !== true ||
    manifest.rollback.stateCompatibility !== "n-1"
  ) {
    failMigration(`${label}.rollback does not match the v2 compatibility contract`);
  }
}



function readBoundedFile(filePath, label, maxBytes, failure = failMigration) {
  const isWindows = process.platform === "win32";
  if (!isWindows) {
    if (
      typeof FS_CONSTANTS.O_NOFOLLOW !== "number" ||
      typeof FS_CONSTANTS.O_NONBLOCK !== "number"
    ) {
      failure(`${label} cannot be read with no-follow protection`);
    }
  } else {
    let linkStats;
    try {
      linkStats = lstatSync(filePath);
    } catch (err) {
      failure(`cannot inspect ${label}: ${err.message}`);
    }
    if (linkStats.isSymbolicLink()) {
      failure(`${label} must not be a symbolic link`);
    }
    if (!linkStats.isFile()) {
      failure(`${label} must be a regular file`);
    }
  }

  let fd;
  try {
    const flags = isWindows
      ? FS_CONSTANTS.O_RDONLY
      : FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW | FS_CONSTANTS.O_NONBLOCK;
    fd = openSync(filePath, flags);
  } catch (err) {
    failure(`cannot read ${label}: ${err.message}`);
  }
  try {
    let stats;
    try {
      stats = fstatSync(fd);
    } catch (err) {
      failure(`cannot inspect ${label}: ${err.message}`);
    }
    if (!stats.isFile()) {
      failure(`${label} must be a regular file`);
    }
    if (stats.size > maxBytes) {
      failure(`${label} exceeds ${maxBytes} bytes`);
    }

    const buffer = Buffer.allocUnsafe(Math.min(stats.size, maxBytes) + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      let count;
      try {
        count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null);
      } catch (err) {
        failure(`cannot read ${label}: ${err.message}`);
      }
      if (count === 0) {
        break;
      }
      bytesRead += count;
    }
    if (bytesRead === buffer.length) {
      const probe = Buffer.allocUnsafe(1);
      let count;
      try {
        count = readSync(fd, probe, 0, 1, null);
      } catch (err) {
        failure(`cannot read ${label}: ${err.message}`);
      }
      if (count !== 0) {
        failure(`${label} changed while reading`);
      }
    }

    let finalStats;
    try {
      finalStats = fstatSync(fd);
    } catch (err) {
      failure(`cannot inspect ${label}: ${err.message}`);
    }
    if (finalStats.size > maxBytes) {
      failure(`${label} exceeds ${maxBytes} bytes`);
    }
    if (
      finalStats.dev !== stats.dev ||
      finalStats.ino !== stats.ino ||
      finalStats.mode !== stats.mode ||
      finalStats.mtimeMs !== stats.mtimeMs ||
      finalStats.ctimeMs !== stats.ctimeMs ||
      finalStats.size !== stats.size ||
      finalStats.size !== bytesRead
    ) {
      failure(`${label} changed while reading`);
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    try {
      closeSync(fd);
    } catch (err) {
      failure(`cannot close ${label}: ${err.message}`);
    }
  }
}

function parseJsonBytes(bytes, label, failure = failMigration) {
  let raw;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (err) {
    failure(`${label} is not valid UTF-8: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    failure(`${label} is not valid JSON: ${err.message}`);
  }
}

function readJsonFile(
  filePath,
  label,
  maxBytes = MAX_MANIFEST_BYTES,
  failure = failMigration,
) {
  return parseJsonBytes(
    readBoundedFile(filePath, label, maxBytes, failure),
    label,
    failure,
  );
}

function parseTimestamp(value, label) {
  requireString(value, label);
  const match = value.match(ISO_TIMESTAMP_REGEX);
  if (!match) {
    failMigration(`${label} must be a UTC ISO-8601 timestamp`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const milliseconds = Number(match[7]?.padEnd(3, "0") || 0);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second ||
    date.getUTCMilliseconds() !== milliseconds
  ) {
    failMigration(`${label} must be a valid UTC ISO-8601 timestamp`);
  }
  return date.getTime();
}


function resolveEvidencePath(evidencePath, relativePath, label) {
  requireString(relativePath, `${label}.path`);
  if (
    Buffer.byteLength(relativePath, "utf8") > 255 ||
    isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    failMigration(`${label}.path must be a safe relative path`);
  }
  const evidenceRoot = realpathSync(dirname(evidencePath));
  const candidate = resolve(dirname(evidencePath), relativePath);
  let candidateRealPath;
  try {
    candidateRealPath = realpathSync(candidate);
  } catch {
    return candidate;
  }
  const fromRoot = relative(evidenceRoot, candidateRealPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${"/"}`) || isAbsolute(fromRoot)) {
    failMigration(`${label}.path resolves outside migration evidence`);
  }
  return candidate;
}

function canonicalPath(filePath, label) {
  try {
    return realpathSync(filePath);
  } catch (err) {
    failMigration(`cannot resolve ${label}: ${err.message}`);
  }
}

function validateSignature(signature, expectedDigest, label) {
  assertExactKeys(
    signature,
    ["provider", "verified", "subjectSha256"],
    `${label}.signature`,
  );
  if (signature.provider !== ATTESTATION_PROVIDER) {
    failMigration(
      `${label}.signature.provider must be ${ATTESTATION_PROVIDER}`,
    );
  }
  if (signature.verified !== true) {
    failMigration(`${label}.signature must be verified`);
  }
  if (signature.subjectSha256 !== expectedDigest) {
    failMigration(`${label}.signature subject digest does not match manifest`);
  }
}


const VALID_PROFILES = Object.freeze(["linux", "windows", "all"]);
const WINDOWS_ZIP_REQUIRED_MEMBERS = Object.freeze([
  "dam-hopper-server.exe",
  "dam-hopper.example.toml",
  "LICENSE",
  "README.md",
]);
const MAX_ZIP_MEMBER_BYTES = 100 * 1024 * 1024;

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

function getPowerShellExecutable() {
  const custom = process.env.POWERSHELL_BIN;
  if (custom) return custom;
  const candidates = ["pwsh", "powershell"];
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
        stdio: "ignore",
      });
      return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

function validatePowerShellScriptSyntax(ps1Path) {
  const psBin = getPowerShellExecutable();
  if (!psBin) {
    throw new Error(
      "PowerShell syntax validation requires 'pwsh' or 'powershell' in PATH (or POWERSHELL_BIN)",
    );
  }
  try {
    execFileSync(
      psBin,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:TARGET_PS1_PATH, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { foreach ($err in $errors) { [Console]::Error.WriteLine($err.ToString()) }; exit 1 }",
      ],
      {
        env: { ...process.env, TARGET_PS1_PATH: ps1Path },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    const detail = err.stderr ? err.stderr.toString("utf8").trim() : err.message;
    throw new Error(
      `Bootstrap installer syntax error in ${basename(ps1Path)}: ${detail}`,
    );
  }
}

function inspectWindowsReleaseZip(zipPath, tag) {
  const zipBytes = readBoundedFile(
    zipPath,
    "Windows release archive",
    MAX_RELEASE_ASSET_BYTES,
    failAsset,
  );
  if (zipBytes.length === 0) {
    throw new Error(`Windows release archive is empty: ${basename(zipPath)}`);
  }
  if (zipBytes.length < 22) {
    throw new Error(`Windows release archive is too small for EOCD record: ${basename(zipPath)}`);
  }

  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBytes.length - 22 - 65535);
  for (let i = zipBytes.length - 22; i >= minOffset; i--) {
    if (zipBytes.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error(`End of Central Directory (EOCD) signature not found in ${basename(zipPath)}`);
  }

  const diskNumber = zipBytes.readUInt16LE(eocdOffset + 4);
  const startDisk = zipBytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = zipBytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = zipBytes.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  const commentLength = zipBytes.readUInt16LE(eocdOffset + 20);

  if (diskNumber !== 0 || startDisk !== 0) {
    throw new Error(`Multi-disk ZIP archives are disallowed in ${basename(zipPath)}`);
  }
  if (diskEntries !== totalEntries) {
    throw new Error(`ZIP disk entries (${diskEntries}) do not match total entries (${totalEntries})`);
  }
  if (totalEntries !== WINDOWS_ZIP_REQUIRED_MEMBERS.length) {
    throw new Error(
      `Windows release ZIP must contain exactly ${WINDOWS_ZIP_REQUIRED_MEMBERS.length} members, got ${totalEntries}`,
    );
  }
  if (eocdOffset + 22 + commentLength !== zipBytes.length) {
    throw new Error(`Trailing bytes detected after EOCD record in ${basename(zipPath)}`);
  }
  if (commentLength !== 0) {
    throw new Error(`ZIP archive comment must be empty in ${basename(zipPath)}`);
  }
  if (cdOffset + cdSize !== eocdOffset) {
    throw new Error(`Central directory boundary does not meet EOCD record in ${basename(zipPath)}`);
  }
  if (cdOffset < 0 || cdOffset + cdSize > zipBytes.length) {
    throw new Error(`Invalid central directory offset/size in ${basename(zipPath)}`);
  }

  let pos = cdOffset;
  const seenNames = new Set();
  const cdEntries = [];

  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > cdOffset + cdSize) {
      throw new Error(`Malformed central directory header in ${basename(zipPath)}`);
    }
    const signature = zipBytes.readUInt32LE(pos);
    if (signature !== 0x02014b50) {
      throw new Error(`Invalid central directory signature at offset ${pos} in ${basename(zipPath)}`);
    }

    const versionMadeBy = zipBytes.readUInt16LE(pos + 4);
    const versionNeeded = zipBytes.readUInt16LE(pos + 6);
    const flags = zipBytes.readUInt16LE(pos + 8);
    const method = zipBytes.readUInt16LE(pos + 10);
    const crc = zipBytes.readUInt32LE(pos + 16);
    const compressedSize = zipBytes.readUInt32LE(pos + 20);
    const uncompressedSize = zipBytes.readUInt32LE(pos + 24);
    const nameLen = zipBytes.readUInt16LE(pos + 28);
    const extraLen = zipBytes.readUInt16LE(pos + 30);
    const commentLen = zipBytes.readUInt16LE(pos + 32);
    const externalAttr = zipBytes.readUInt32LE(pos + 38);
    const lfhOffset = zipBytes.readUInt32LE(pos + 42);

    if (flags & 0x0001) {
      throw new Error(`Encrypted ZIP entries are disallowed in ${basename(zipPath)}`);
    }
    if (versionNeeded > 20) {
      throw new Error(`Unsupported ZIP version (${versionNeeded}) in ${basename(zipPath)}`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported compression method (${method}) in ${basename(zipPath)}`);
    }
    if (uncompressedSize === 0) {
      throw new Error(`ZIP member uncompressed size must be positive in ${basename(zipPath)}`);
    }
    if (uncompressedSize > MAX_ZIP_MEMBER_BYTES) {
      throw new Error(`ZIP member uncompressed size exceeds limit in ${basename(zipPath)}`);
    }
    if (commentLen !== 0) {
      throw new Error(`ZIP member comment must be empty in ${basename(zipPath)}`);
    }

    if (externalAttr & 0x10) {
      throw new Error(`ZIP directory entries are disallowed in ${basename(zipPath)}`);
    }
    const unixMode = (externalAttr >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === 0o120000) {
      throw new Error(`ZIP symlink entries are disallowed in ${basename(zipPath)}`);
    }
    if ((unixMode & 0o170000) === 0o040000) {
      throw new Error(`ZIP directory entries are disallowed in ${basename(zipPath)}`);
    }

    if (pos + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) {
      throw new Error(`Central directory entry exceeds bounds in ${basename(zipPath)}`);
    }

    const name = zipBytes.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    if (name.includes("\0")) {
      throw new Error(`ZIP entry name contains NUL byte in ${basename(zipPath)}`);
    }
    if (name.includes("\\") || name.includes("/")) {
      throw new Error(`ZIP entry must be a root file without directory separators: '${name}'`);
    }
    if (name === "." || name === ".." || name.includes("..")) {
      throw new Error(`ZIP entry name contains traversal characters: '${name}'`);
    }
    if (/^[a-zA-Z]:/.test(name)) {
      throw new Error(`ZIP entry name must not be an absolute path: '${name}'`);
    }
    if (!WINDOWS_ZIP_REQUIRED_MEMBERS.includes(name)) {
      throw new Error(`Unexpected ZIP entry name in ${basename(zipPath)}: '${name}'`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate ZIP entry in ${basename(zipPath)}: '${name}'`);
    }
    seenNames.add(name);

    cdEntries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      lfhOffset,
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (pos !== cdOffset + cdSize) {
    throw new Error(`Central directory size does not match parsed entries in ${basename(zipPath)}`);
  }

  for (const required of WINDOWS_ZIP_REQUIRED_MEMBERS) {
    if (!seenNames.has(required)) {
      throw new Error(`Missing required ZIP member in ${basename(zipPath)}: '${required}'`);
    }
  }

  for (const entry of cdEntries) {
    if (entry.lfhOffset + 30 > cdOffset) {
      throw new Error(`LFH offset exceeds central directory offset for '${entry.name}'`);
    }
    const lfhSig = zipBytes.readUInt32LE(entry.lfhOffset);
    if (lfhSig !== 0x04034b50) {
      throw new Error(`Invalid LFH signature for '${entry.name}' at offset ${entry.lfhOffset}`);
    }

    const lfhMethod = zipBytes.readUInt16LE(entry.lfhOffset + 8);
    const lfhCrc = zipBytes.readUInt32LE(entry.lfhOffset + 14);
    const lfhCompSize = zipBytes.readUInt32LE(entry.lfhOffset + 18);
    const lfhUncompSize = zipBytes.readUInt32LE(entry.lfhOffset + 22);
    const lfhNameLen = zipBytes.readUInt16LE(entry.lfhOffset + 26);
    const lfhExtraLen = zipBytes.readUInt16LE(entry.lfhOffset + 28);

    if (lfhMethod !== entry.method) {
      throw new Error(`LFH compression method does not match CDFH for '${entry.name}'`);
    }
    if (lfhCrc !== entry.crc) {
      throw new Error(`LFH CRC-32 does not match CDFH for '${entry.name}'`);
    }
    if (lfhCompSize !== entry.compressedSize) {
      throw new Error(`LFH compressed size does not match CDFH for '${entry.name}'`);
    }
    if (lfhUncompSize !== entry.uncompressedSize) {
      throw new Error(`LFH uncompressed size does not match CDFH for '${entry.name}'`);
    }

    const lfhName = zipBytes
      .subarray(entry.lfhOffset + 30, entry.lfhOffset + 30 + lfhNameLen)
      .toString("utf8");
    if (lfhName !== entry.name) {
      throw new Error(`LFH name '${lfhName}' does not match CDFH name '${entry.name}'`);
    }

    const dataOffset = entry.lfhOffset + 30 + lfhNameLen + lfhExtraLen;
    if (dataOffset + entry.compressedSize > cdOffset) {
      throw new Error(`Compressed data exceeds CD offset for '${entry.name}'`);
    }

    const rawData = zipBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    let decompressed;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        throw new Error(`Stored method size mismatch for '${entry.name}'`);
      }
      decompressed = rawData;
    } else {
      try {
        decompressed = inflateRawSync(rawData, { maxOutputLength: MAX_ZIP_MEMBER_BYTES });
      } catch (err) {
        throw new Error(`Failed to decompress ZIP member '${entry.name}': ${err.message}`);
      }
    }

    if (decompressed.length !== entry.uncompressedSize) {
      throw new Error(
        `Decompressed size (${decompressed.length}) does not match declared (${entry.uncompressedSize}) for '${entry.name}'`,
      );
    }
    const computedCrc = computeCrc32(decompressed);
    if (computedCrc !== entry.crc) {
      throw new Error(
        `CRC-32 mismatch for '${entry.name}': declared ${entry.crc.toString(16)}, computed ${computedCrc.toString(16)}`,
      );
    }
  }

  return seenNames;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let tag = process.env.RELEASE_TAG || null;
  let profile = "linux";
  let dir = null;
  let releaseId = null;
  let repo = process.env.GITHUB_REPOSITORY || null;
  let repoArgumentProvided = false;
  let assetsJsonPath = null;
  let migrationEvidencePath = null;
  let requireMigrationGate = process.env.REQUIRE_MIGRATION_GATE === "1";
  let allowUnverifiedPublish =
    process.env.ALLOW_UNVERIFIED_PUBLISH === "true" ||
    process.env.ALLOW_UNVERIFIED_PUBLISH === "1";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tag" && i + 1 < args.length) {
      tag = args[++i];
    } else if (arg === "--profile" && i + 1 < args.length) {
      profile = args[++i];
    } else if (arg === "--dir" && i + 1 < args.length) {
      dir = args[++i];
    } else if (arg === "--release-id" && i + 1 < args.length) {
      releaseId = args[++i];
    } else if (arg === "--repo" && i + 1 < args.length) {
      repo = args[++i];
      repoArgumentProvided = true;
    } else if (arg === "--assets-json" && i + 1 < args.length) {
      assetsJsonPath = args[++i];
    } else if (arg === "--migration-evidence" && i + 1 < args.length) {
      migrationEvidencePath = args[++i];
    } else if (arg === "--require-migration-gate") {
      requireMigrationGate = true;
    } else if (arg === "--allow-unverified-publish") {
      allowUnverifiedPublish = true;
    } else if (!arg.startsWith("--") && !dir) {
      dir = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!tag) {
    console.error(
      "Usage: node check-release-assets.mjs --tag <vX.Y.Z> [--profile <linux|windows|all>] [--dir <dir>] [--release-id <id>] [--repo <owner/repo>] [--migration-evidence <path>] [--require-migration-gate] [--allow-unverified-publish]",
    );
    process.exit(1);
  }
  if (!TAG_REGEX.test(tag)) {
    console.error(`Invalid release tag '${tag}'. Must match vMAJOR.MINOR.PATCH`);
    process.exit(1);
  }
  if (!VALID_PROFILES.includes(profile)) {
    console.error(
      `Invalid profile '${profile}'. Must be one of: ${VALID_PROFILES.join(", ")}`,
    );
    process.exit(1);
  }

  if (releaseId !== null && !/^[1-9]\d*$/.test(releaseId)) {
    console.error(`Invalid release ID '${releaseId}'. Must be a positive integer`);
    process.exit(1);
  }

  return {
    tag,
    profile,
    dir: dir ? resolve(process.cwd(), dir) : null,
    releaseId,
    repo,
    repoArgumentProvided,
    assetsJsonPath: assetsJsonPath
      ? resolve(process.cwd(), assetsJsonPath)
      : null,
    migrationEvidencePath: migrationEvidencePath
      ? resolve(process.cwd(), migrationEvidencePath)
      : null,
    requireMigrationGate,
    allowUnverifiedPublish,
  };
}

function getLinuxExpectedAssetNames(tag) {
  return [
    "dam-hopper-install.sh",
    `dam-hopper-${tag}-linux-x86_64-systemd.tar.gz`,
    "release-manifest.json",
    `dam-hopper-${tag}-linux-x86_64-systemd.spdx.json`,
  ].sort();
}

function getWindowsExpectedAssetNames(tag) {
  return [
    "dam-hopper-install.ps1",
    `dam-hopper-${tag}-windows-x86_64.zip`,
  ].sort();
}

function getExpectedAssetNames(tag, profile = "linux") {
  if (profile === "linux") {
    return getLinuxExpectedAssetNames(tag);
  }
  if (profile === "windows") {
    return getWindowsExpectedAssetNames(tag);
  }
  if (profile === "all") {
    return Array.from(
      new Set([...getLinuxExpectedAssetNames(tag), ...getWindowsExpectedAssetNames(tag)]),
    ).sort();
  }
  throw new Error(`Unknown profile: ${profile}`);
}

function validateLinuxAssetSet(dir, tag, digests, expectedNames) {
  const manifestBytes = readBoundedFile(
    resolve(dir, "release-manifest.json"),
    "release manifest",
    MAX_MANIFEST_BYTES,
    failAsset,
  );
  const manifest = parseJsonBytes(
    manifestBytes,
    "release manifest",
    failAsset,
  );
  validateManifestShape(manifest, "release manifest");
  if (manifest.release.tag !== tag) {
    throw new Error(
      `Manifest release.tag '${manifest.release.tag}' does not match expected '${tag}'`,
    );
  }

  const archiveName = `dam-hopper-${tag}-linux-x86_64-systemd.tar.gz`;
  if (manifest.archive.name !== archiveName) {
    throw new Error(
      `Manifest archive.name '${manifest.archive.name}' does not match expected '${archiveName}'`,
    );
  }

  const archiveDigest = digests[archiveName];
  if (!archiveDigest) {
    throw new Error(`Missing digest for archive '${archiveName}'`);
  }
  if (manifest.archive.size !== archiveDigest.size) {
    throw new Error(
      `Manifest archive.size (${manifest.archive.size}) differs from actual archive (${archiveDigest.size})`,
    );
  }
  if (manifest.archive.sha256 !== archiveDigest.sha256) {
    throw new Error(
      `Manifest archive.sha256 (${manifest.archive.sha256}) differs from actual archive (${archiveDigest.sha256})`,
    );
  }

  const installerBytes = readBoundedFile(
    resolve(dir, "dam-hopper-install.sh"),
    "dam-hopper-install.sh",
    MAX_RELEASE_ASSET_BYTES,
    failAsset,
  );
  try {
    execFileSync("bash", ["-n"], { input: installerBytes });
  } catch (err) {
    throw new Error(
      `Bootstrap installer syntax error in dam-hopper-install.sh: ${err.message}`,
    );
  }

  const sbomName = `dam-hopper-${tag}-linux-x86_64-systemd.spdx.json`;
  const sbomBytes = readBoundedFile(
    resolve(dir, sbomName),
    "release SBOM",
    MAX_SBOM_BYTES,
    failAsset,
  );
  const sbom = parseJsonBytes(sbomBytes, "release SBOM", failAsset);
  if (sbom.spdxVersion !== "SPDX-2.3") {
    throw new Error(`SBOM spdxVersion '${sbom.spdxVersion}' is not SPDX-2.3`);
  }
}

function validateWindowsAssetSet(dir, tag, digests, expectedNames) {
  const ps1Path = resolve(dir, "dam-hopper-install.ps1");
  validatePowerShellScriptSyntax(ps1Path);

  const zipName = `dam-hopper-${tag}-windows-x86_64.zip`;
  const zipPath = resolve(dir, zipName);
  inspectWindowsReleaseZip(zipPath, tag);
}

function checkLocalDirectory(dir, tag, expectedNames, profile = "linux") {
  if (!existsSync(dir)) {
    throw new Error(`Asset directory does not exist: ${dir}`);
  }
  const directoryStats = lstatSync(dir);
  if (!directoryStats.isDirectory()) {
    throw new Error(`Asset path is not a regular directory: ${dir}`);
  }

  const allFiles = [];
  for (const name of readdirSync(dir)) {
    const stats = lstatSync(resolve(dir, name));
    if (name.startsWith(".")) {
      if (!stats.isFile()) {
        throw new Error(`Hidden release entry is not a regular file: ${name}`);
      }
      continue;
    }
    if (!stats.isFile()) {
      throw new Error(`Unexpected non-regular release entry: ${name}`);
    }
    allFiles.push(name);
  }
  allFiles.sort();

  const missing = expectedNames.filter((name) => !allFiles.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Missing expected release assets in ${dir}:\n  - ${missing.join("\n  - ")}`,
    );
  }

  const extra = allFiles.filter((name) => !expectedNames.includes(name));
  if (extra.length > 0) {
    throw new Error(
      `Unexpected extra files found in release directory:\n  - ${extra.join("\n  - ")}`,
    );
  }

  const digests = {};
  for (const name of expectedNames) {
    const filePath = resolve(dir, name);
    const maxBytes =
      name === "release-manifest.json"
        ? MAX_MANIFEST_BYTES
        : name.endsWith(".spdx.json")
          ? MAX_SBOM_BYTES
          : MAX_RELEASE_ASSET_BYTES;
    const buf = readBoundedFile(
      filePath,
      `Asset file '${name}'`,
      maxBytes,
      failAsset,
    );
    if (buf.length === 0) {
      throw new Error(`Asset file is empty: ${name}`);
    }
    digests[name] = {
      size: buf.length,
      sha256: computeSha256(buf),
    };
  }

  if (profile === "linux" || profile === "all") {
    validateLinuxAssetSet(dir, tag, digests, expectedNames);
  }
  if (profile === "windows" || profile === "all") {
    validateWindowsAssetSet(dir, tag, digests, expectedNames);
  }

  console.log(`✓ Local release asset gate passed for ${tag}:`);
  for (const name of expectedNames) {
    const info = digests[name];
    console.log(`  - ${name}: ${info.size} bytes (sha256: ${info.sha256})`);
  }

  return digests;
}
function validateManifestArtifact({
  evidencePath,
  artifact,
  label,
  expectedTag,
  evidenceGeneratedAt,
  expiresAt,
  now,
  publicationDir = null,
  rollback = false,
}) {
  const requiredKeys = rollback
    ? [
        "manifestPath",
        "archivePath",
        "releaseTag",
        "manifestSchemaVersion",
        "generatedAt",
        "sourceManifestPath",
        "sourceManifestSchemaVersion",
        "sourceManifestSha256",
        "regenerated",
        "signed",
        "manifestSha256",
        "archiveSha256",
        "signature",
      ]
    : [
        "manifestPath",
        "archivePath",
        "releaseTag",
        "manifestSchemaVersion",
        "generatedAt",
        "generated",
        "signed",
        "manifestSha256",
        "archiveSha256",
        "signature",
      ];
  assertExactKeys(artifact, requiredKeys, label);
  if (!rollback && artifact.releaseTag !== expectedTag) {
    failMigration(`${label}.releaseTag must match ${expectedTag}`);
  }
  if (rollback && artifact.releaseTag === expectedTag) {
    failMigration(`${label}.releaseTag must identify a previous release`);
  }
  requireTag(artifact.releaseTag, `${label}.releaseTag`);
  requireSchemaVersion(
    artifact.manifestSchemaVersion,
    RELEASE_MANIFEST_SCHEMA_VERSION,
    `${label}.manifestSchemaVersion`,
  );
  const generatedAt = parseTimestamp(artifact.generatedAt, `${label}.generatedAt`);
  if (generatedAt < evidenceGeneratedAt || generatedAt > now || generatedAt > expiresAt) {
    failMigration(`${label}.generatedAt is outside the evidence window`);
  }
  if (!rollback && artifact.generated !== true) {
    failMigration(`${label} must declare generated=true`);
  }
  if (rollback && artifact.regenerated !== true) {
    failMigration(`${label} must declare regenerated=true`);
  }
  if (artifact.signed !== true) {
    failMigration(`${label} must declare signed=true`);
  }
  requireSha256(artifact.manifestSha256, `${label}.manifestSha256`);
  requireSha256(artifact.archiveSha256, `${label}.archiveSha256`);

  const manifestPath = resolveEvidencePath(
    evidencePath,
    artifact.manifestPath,
    `${label} manifest`,
  );
  const archivePath = resolveEvidencePath(
    evidencePath,
    artifact.archivePath,
    `${label} archive`,
  );
  if (dirname(manifestPath) !== dirname(archivePath)) {
    failMigration(`${label} manifest and archive must share a publication directory`);
  }
  if (publicationDir) {
    const expectedManifestPath = resolve(publicationDir, "release-manifest.json");
    const expectedArchivePath = resolve(publicationDir, basename(artifact.archivePath));
    if (
      canonicalPath(manifestPath, `${label} manifest`) !==
      canonicalPath(expectedManifestPath, `${label} published manifest`)
    ) {
      failMigration(`${label} manifest is not the local published manifest`);
    }
    if (
      canonicalPath(archivePath, `${label} archive`) !==
      canonicalPath(expectedArchivePath, `${label} published archive`)
    ) {
      failMigration(`${label} archive is not the local published archive`);
    }
  }

  const manifestBytes = readBoundedFile(
    manifestPath,
    `${label} manifest`,
    MAX_MANIFEST_BYTES,
  );
  const manifestDigest = computeSha256(manifestBytes);
  if (manifestDigest !== artifact.manifestSha256) {
    failMigration(`${label}.manifestSha256 does not match manifest bytes`);
  }
  const manifest = parseJsonBytes(manifestBytes, `${label} manifest`);
  validateManifestShape(manifest, `${label} manifest`);
  if (manifest.release.tag !== artifact.releaseTag) {
    failMigration(`${label} manifest release.tag does not match evidence`);
  }
  if (manifest.archive.name !== basename(archivePath)) {
    failMigration(`${label} archive path does not match manifest.archive.name`);
  }

  const archiveBytes = readBoundedFile(
    archivePath,
    `${label} archive`,
    MAX_RELEASE_ASSET_BYTES,
  );
  if (archiveBytes.length === 0) {
    failMigration(`${label} archive is empty`);
  }
  const archiveDigest = computeSha256(archiveBytes);
  if (archiveDigest !== artifact.archiveSha256) {
    failMigration(`${label}.archiveSha256 does not match archive bytes`);
  }
  if (manifest.archive.size !== archiveBytes.length) {
    failMigration(`${label} manifest archive.size does not match archive bytes`);
  }
  if (manifest.archive.sha256 !== archiveDigest) {
    failMigration(`${label} manifest archive.sha256 does not match archive bytes`);
  }
  validateSignature(artifact.signature, manifestDigest, label);

  return {
    generatedAt,
    manifest,
    digest: manifestDigest,
    archiveDigest,
    manifestPath,
    archivePath,
  };
}

function checkMigrationGate(evidencePath, tag, publicationDir, localDigests) {
  if (!publicationDir || !localDigests) {
    failMigration(
      "required migration gate needs --dir so evidence can bind to published bytes",
    );
  }
  const evidence = readJsonFile(
    evidencePath,
    "migration evidence",
    MAX_MIGRATION_EVIDENCE_BYTES,
  );
  assertExactKeys(
    evidence,
    [
      "schemaVersion",
      "releaseTag",
      "environment",
      "generatedAt",
      "expiresAt",
      "managerFirst",
      "inventoryComplete",
      "managerInventory",
      "forward",
      "rollback",
      "active",
    ],
    "migration evidence",
  );
  requireSchemaVersion(
    evidence.schemaVersion,
    MIGRATION_EVIDENCE_SCHEMA_VERSION,
    "migration evidence",
  );
  if (evidence.releaseTag !== tag) {
    failMigration(
      `evidence.releaseTag '${evidence.releaseTag}' does not match '${tag}'`,
    );
  }
  requireTag(evidence.releaseTag, "evidence.releaseTag");
  const environment = requireString(evidence.environment, "evidence.environment");
  if (environment !== "production") {
    failMigration("evidence.environment must be production");
  }
  const generatedAt = parseTimestamp(evidence.generatedAt, "evidence.generatedAt");
  const expiresAt = parseTimestamp(evidence.expiresAt, "evidence.expiresAt");
  const now = Date.now();
  if (generatedAt > now) {
    failMigration("evidence.generatedAt is in the future");
  }
  if (now - generatedAt > MIGRATION_EVIDENCE_MAX_AGE_MS) {
    failMigration("evidence is stale");
  }
  if (expiresAt <= now || expiresAt <= generatedAt) {
    failMigration("evidence has expired or invalid expiry");
  }
  if (expiresAt - generatedAt > MIGRATION_EVIDENCE_MAX_LIFETIME_MS) {
    failMigration("evidence expiry exceeds the 24-hour maximum lifetime");
  }
  if (evidence.managerFirst !== true) {
    failMigration("manager prerequisite must be completed before publication");
  }
  if (evidence.inventoryComplete !== true) {
    failMigration("manager inventory must be complete");
  }
  if (
    !Array.isArray(evidence.managerInventory) ||
    evidence.managerInventory.length === 0 ||
    evidence.managerInventory.length > MAX_MANAGER_INVENTORY_TARGETS
  ) {
    failMigration(
      `manager inventory must contain 1..${MAX_MANAGER_INVENTORY_TARGETS} targets`,
    );
  }

  const managerIds = new Set();
  for (const [index, manager] of evidence.managerInventory.entries()) {
    const label = `managerInventory[${index}]`;
    assertExactKeys(
      manager,
      [
        "id",
        "releaseTag",
        "environment",
        "manifestSchemaVersion",
        "stateSchemaVersion",
        "attestation",
      ],
      label,
    );
    const id = requireBoundedString(
      manager.id,
      `${label}.id`,
      MAX_MANAGER_ID_BYTES,
    );
    if (managerIds.has(id)) {
      failMigration(`duplicate manager inventory id '${id}'`);
    }
    managerIds.add(id);
    if (manager.releaseTag !== tag) {
      failMigration(`${label}.releaseTag must match ${tag}`);
    }
    if (manager.environment !== environment) {
      failMigration(`${label}.environment must match evidence environment`);
    }
    requireSchemaVersion(
      manager.manifestSchemaVersion,
      RELEASE_MANIFEST_SCHEMA_VERSION,
      `${label}.manifestSchemaVersion`,
    );
    requireSchemaVersion(
      manager.stateSchemaVersion,
      MANAGER_STATE_SCHEMA_VERSION,
      `${label}.stateSchemaVersion`,
    );
    assertExactKeys(
      manager.attestation,
      ["provider", "subject", "verified", "subjectSha256", "verifiedAt"],
      `${label}.attestation`,
    );
    if (manager.attestation.provider !== ATTESTATION_PROVIDER) {
      failMigration(`${label}.attestation.provider is not trusted`);
    }
    if (manager.attestation.subject !== "dam-hopper-manager") {
      failMigration(`${label}.attestation.subject is invalid`);
    }
    if (manager.attestation.verified !== true) {
      failMigration(`${label}.attestation must be verified`);
    }
    requireSha256(
      manager.attestation.subjectSha256,
      `${label}.attestation.subjectSha256`,
    );
    const verifiedAt = parseTimestamp(
      manager.attestation.verifiedAt,
      `${label}.attestation.verifiedAt`,
    );
    if (verifiedAt < generatedAt || verifiedAt > now || verifiedAt > expiresAt) {
      failMigration(`${label}.attestation.verifiedAt is outside evidence window`);
    }
  }

  assertExactKeys(evidence.active, ["releaseTag", "manifestSchemaVersion"], "active");
  requireTag(evidence.active.releaseTag, "active.releaseTag");
  if (![1, RELEASE_MANIFEST_SCHEMA_VERSION].includes(evidence.active.manifestSchemaVersion)) {
    failMigration("active.manifestSchemaVersion must be 1 or 2");
  }

  const forward = validateManifestArtifact({
    evidencePath,
    artifact: evidence.forward,
    label: "forward",
    expectedTag: tag,
    evidenceGeneratedAt: generatedAt,
    expiresAt,
    now,
    publicationDir,
  });
  const forwardArchiveName = basename(forward.archivePath);
  if (
    forward.digest !== localDigests["release-manifest.json"]?.sha256 ||
    forward.archiveDigest !== localDigests[forwardArchiveName]?.sha256
  ) {
    failMigration("forward evidence is not bound to the local published asset bytes");
  }

  const rollback = validateManifestArtifact({
    evidencePath,
    artifact: evidence.rollback,
    label: "rollback",
    expectedTag: tag,
    evidenceGeneratedAt: generatedAt,
    expiresAt,
    now,
    rollback: true,
  });
  if (
    compareVersions(rollback.manifest.release.version, forward.manifest.release.version) >= 0
  ) {
    failMigration("rollback release must be older than the forward release");
  }
  if (
    rollback.manifest.release.tag.slice(1) !== rollback.manifest.release.version ||
    forward.manifest.release.tag.slice(1) !== forward.manifest.release.version
  ) {
    failMigration("manifest release tags and versions must agree");
  }

  const sourceManifestPath = resolveEvidencePath(
    evidencePath,
    evidence.rollback.sourceManifestPath,
    "rollback source manifest",
  );
  if (
    canonicalPath(sourceManifestPath, "rollback source manifest") ===
    canonicalPath(rollback.manifestPath, "rollback manifest")
  ) {
    failMigration("rollback source manifest must be distinct from regenerated manifest");
  }
  if (dirname(sourceManifestPath) !== dirname(rollback.manifestPath)) {
    failMigration("rollback source and regenerated manifests must share a directory");
  }
  const sourceManifestBytes = readBoundedFile(
    sourceManifestPath,
    "rollback source manifest",
    MAX_MANIFEST_BYTES,
  );
  const sourceManifestDigest = computeSha256(sourceManifestBytes);
  if (sourceManifestDigest !== evidence.rollback.sourceManifestSha256) {
    failMigration("rollback source digest does not match source manifest bytes");
  }
  const sourceManifest = parseJsonBytes(
    sourceManifestBytes,
    "rollback source manifest",
  );
  requireSchemaVersion(
    sourceManifest.schemaVersion,
    evidence.rollback.sourceManifestSchemaVersion,
    "rollback source manifest",
  );
  requireSchemaVersion(
    sourceManifest.schemaVersion,
    RELEASE_MANIFEST_SCHEMA_VERSION,
    "rollback source manifest",
  );
  validateManifestShape(sourceManifest, "rollback source manifest");
  if (sourceManifest.release.tag !== evidence.rollback.releaseTag) {
    failMigration("rollback source must identify the rollback release");
  }
  if (
    sourceManifest.archive.name !== rollback.manifest.archive.name ||
    sourceManifest.archive.size !== rollback.manifest.archive.size ||
    sourceManifest.archive.sha256 !== rollback.manifest.archive.sha256
  ) {
    failMigration("rollback source and regenerated manifests must describe the same archive");
  }
  if (evidence.active.releaseTag !== evidence.rollback.releaseTag) {
    failMigration("active release must match the designated rollback release");
  }
  if (sourceManifestDigest === rollback.digest) {
    failMigration("rollback manifest was reused instead of regenerated");
  }
  const managerDigest = forward.manifest.inventory.find(
    (entry) => entry.path === "bin/dam-hopper-manager",
  )?.sha256;
  if (!managerDigest) {
    failMigration("forward manifest must declare the manager binary digest");
  }
  for (const [index, manager] of evidence.managerInventory.entries()) {
    if (manager.attestation.subjectSha256 !== managerDigest) {
      failMigration(
        `managerInventory[${index}].attestation.subjectSha256 does not match the published manager`,
      );
    }
  }

  console.log(
    `✓ Migration gate passed for ${tag}: complete homogeneous v2 manager inventory, v2 forward/rollback manifests, and no downgrade`,
  );
  return { evidence, forward, rollback };
}

function normalizeRemoteDigest(value, label) {
  requireString(value, label);
  const digest = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  return requireSha256(digest, label);
}

function checkGitHubReleaseAssets(
  tag,
  releaseId,
  repo,
  assetsJsonPath,
  localDigests,
  expectedNames,
) {
  let assets = [];

  if (assetsJsonPath) {
    if (!existsSync(assetsJsonPath)) {
      throw new Error(`Remote asset metadata file does not exist: ${assetsJsonPath}`);
    }
    assets = parseJsonBytes(
      readBoundedFile(
        assetsJsonPath,
        "remote asset metadata",
        MAX_REMOTE_ASSET_METADATA_BYTES,
      ),
      "remote asset metadata",
    );
  } else if (releaseId && repo) {
    const output = execFileSync(
      "gh",
      [
        "api",
        `repos/${repo}/releases/${releaseId}/assets`,
        "--jq",
        "[.[] | {name: .name, size: .size, state: .state, digest: .digest}]",
      ],
      { maxBuffer: MAX_REMOTE_ASSET_METADATA_BYTES },
    );
    assets = parseJsonBytes(output, "remote asset metadata");
  } else {
    return;
  }
  if (!Array.isArray(assets)) {
    throw new Error("Remote release asset response must be an array");
  }

  const remoteNames = assets.map((asset) => requireString(asset?.name, "remote asset.name"));
  const uniqueNames = new Set(remoteNames);
  if (uniqueNames.size !== remoteNames.length) {
    throw new Error("Remote release contains duplicate asset names");
  }
  if (remoteNames.length !== expectedNames.length) {
    throw new Error(
      `Remote release must contain exactly ${expectedNames.length} assets, got ${remoteNames.length}`,
    );
  }
  remoteNames.sort();
  const missing = expectedNames.filter((name) => !remoteNames.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `Remote release is missing expected assets:\n  - ${missing.join("\n  - ")}`,
    );
  }

  const extra = remoteNames.filter((name) => !expectedNames.includes(name));
  if (extra.length > 0) {
    throw new Error(
      `Remote release has unexpected extra assets:\n  - ${extra.join("\n  - ")}`,
    );
  }

  for (const asset of assets) {
    if (asset.state !== "uploaded") {
      throw new Error(
        `Remote asset '${asset.name}' is in non-uploaded state: '${asset.state}'`,
      );
    }
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
      throw new Error(`Remote asset '${asset.name}' must have a positive size`);
    }
    const local = localDigests?.[asset.name];
    if (local && asset.size !== local.size) {
      throw new Error(
        `Remote asset '${asset.name}' size (${asset.size}) differs from local (${local.size})`,
      );
    }
    const remoteDigest = normalizeRemoteDigest(
      asset.digest,
      `remote asset '${asset.name}' digest`,
    );
    if (local && remoteDigest !== local.sha256) {
      throw new Error(
        `Remote asset '${asset.name}' digest (${remoteDigest}) differs from local (${local.sha256})`,
      );
    }
  }

  console.log(`✓ Remote release asset gate passed: exactly ${expectedNames.length} assets match.`);
}

function isStablePublishJob(tag, allowUnverifiedPublish = false) {
  if (allowUnverifiedPublish) {
    return false;
  }
  return (
    process.env.REQUIRE_MIGRATION_GATE === "1" &&
    process.env.GITHUB_ACTIONS === "true" &&
    process.env.GITHUB_JOB === "publish-release" &&
    process.env.GITHUB_REF === `refs/tags/${tag}`
  );
}

function main() {
  const {
    tag,
    profile,
    dir,
    releaseId,
    repo,
    repoArgumentProvided,
    assetsJsonPath,
    migrationEvidencePath,
    requireMigrationGate,
    allowUnverifiedPublish,
  } = parseArgs();
  const expectedNames = getExpectedAssetNames(tag, profile);

  if (profile === "windows") {
    if (migrationEvidencePath || requireMigrationGate) {
      throw new Error(
        "Migration gate: migration evidence is not supported for profile 'windows'",
      );
    }
  }

  if (assetsJsonPath && (releaseId || repoArgumentProvided)) {
    throw new Error(
      "Remote release selectors cannot be combined with --assets-json",
    );
  }
  if (releaseId && !repo) {
    throw new Error("Remote release checks require --repo with --release-id");
  }
  if (repoArgumentProvided && !releaseId) {
    throw new Error("Remote release checks require --release-id with --repo");
  }

  let localDigests = null;
  if (dir) {
    localDigests = checkLocalDirectory(dir, tag, expectedNames, profile);
  }

  if (profile === "linux" || profile === "all") {
    if (requireMigrationGate && !migrationEvidencePath) {
      throw new Error(
        "Migration gate: --migration-evidence is required when the migration gate is enabled",
      );
    }
    if (isStablePublishJob(tag, allowUnverifiedPublish) && !migrationEvidencePath) {
      throw new Error(
        "Migration gate: stable GitHub publication is held until externally verified migration evidence is supplied",
      );
    }
    if (migrationEvidencePath) {
      checkMigrationGate(migrationEvidencePath, tag, dir, localDigests);
    }
  }

  if (assetsJsonPath || (releaseId && repo)) {
    checkGitHubReleaseAssets(
      tag,
      releaseId,
      repo,
      assetsJsonPath,
      localDigests,
      expectedNames,
    );
  }
}

main();

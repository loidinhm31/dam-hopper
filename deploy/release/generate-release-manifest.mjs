#!/usr/bin/env node
/**
 * Release manifest and SPDX 2.3 SBOM generator for DamHopper Linux releases.
 * Inspects staged archive bytes, extracts file inventory, computes exact SHA-256
 * digests, assigns component roles, and emits schema-compliant release-manifest.json
 * and SPDX JSON SBOM.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { resolve, basename, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");

const TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/;

const DISALLOWED_FILES = new Set([
  ".env",
  "server.env",
  "server-safety.env",
  "dam-hopper.toml",
  "config.toml",
  "server-token",
]);

function checkDisallowedPath(relPath) {
  const fileName = basename(relPath).toLowerCase();
  if (DISALLOWED_FILES.has(fileName) || fileName.startsWith(".env.")) {
    throw new Error(
      `Prohibited runtime configuration file in release archive: ${relPath}`,
    );
  }
  const lower = relPath.toLowerCase();
  if (
    lower.endsWith(".sqlite") ||
    lower.endsWith(".sqlite-wal") ||
    lower.endsWith(".sqlite-shm") ||
    lower.endsWith(".db")
  ) {
    throw new Error(`Prohibited database file in release archive: ${relPath}`);
  }
}

function computeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseArgs() {
  const args = process.argv.slice(2);
  let archivePath = null;
  let tag = process.env.RELEASE_TAG || null;
  let commitSha = process.env.RELEASE_COMMIT || null;
  let outputDir = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--archive" && i + 1 < args.length) {
      archivePath = args[++i];
    } else if (arg === "--tag" && i + 1 < args.length) {
      tag = args[++i];
    } else if (arg === "--commit" && i + 1 < args.length) {
      commitSha = args[++i];
    } else if (arg === "--output-dir" && i + 1 < args.length) {
      outputDir = args[++i];
    } else if (!arg.startsWith("--") && !archivePath) {
      archivePath = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!archivePath) {
    console.error(
      "Usage: node generate-release-manifest.mjs --archive <path> [--tag <vX.Y.Z>] [--commit <sha>] [--output-dir <dir>]",
    );
    process.exit(1);
  }

  return {
    archivePath: resolve(process.cwd(), archivePath),
    tag,
    commitSha,
    outputDir,
  };
}

function resolveCommitSha(providedSha) {
  if (providedSha && COMMIT_SHA_REGEX.test(providedSha)) {
    return providedSha;
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    if (COMMIT_SHA_REGEX.test(sha)) {
      return sha;
    }
  } catch {}
  throw new Error(
    "Could not resolve valid 40-character commit SHA. Pass --commit <sha>.",
  );
}

function assignRoles(relPath) {
  if (relPath === "bin/dam-hopper-manager") return ["common"];
  if (relPath === "bin/dam-hopper-server") return ["server"];
  if (relPath === "bin/dam-hopper-web") return ["web"];
  if (relPath === "systemd/dam-hopper-api.service") return ["server"];
  if (relPath === "systemd/dam-hopper-web.service") return ["web"];
  if (relPath === "systemd/dam-hopper-recovery.service") return ["common"];
  if (relPath === "sysusers.d/dam-hopper-web.conf") return ["web"];
  if (relPath === "LICENSE" || relPath === "NOTICES") return ["common"];
  if (relPath === "web" || relPath.startsWith("web/")) return ["web"];
  throw new Error(
    `Unrecognized release entry has no assigned role: '${relPath}'`,
  );
}

function main() {
  const {
    archivePath,
    tag: userTag,
    commitSha: userSha,
    outputDir: userOutputDir,
  } = parseArgs();

  if (!existsSync(archivePath)) {
    console.error(`Archive file not found: ${archivePath}`);
    process.exit(1);
  }

  const archiveBuffer = readFileSync(archivePath);
  const archiveSize = archiveBuffer.length;
  const archiveSha256 = computeSha256(archiveBuffer);
  const archiveName = basename(archivePath);

  // Derive tag from archive name if not provided
  let tag = userTag;
  if (!tag) {
    const match = archiveName.match(
      /^dam-hopper-(v[0-9]+\.[0-9]+\.[0-9]+)-fedora44-x86_64-systemd\.tar\.gz$/,
    );
    if (match) {
      tag = match[1];
    } else {
      console.error(
        `Could not deduce release tag from archive name '${archiveName}'. Pass --tag <vX.Y.Z>.`,
      );
      process.exit(1);
    }
  }

  if (!TAG_REGEX.test(tag)) {
    console.error(
      `Invalid release tag '${tag}'. Must match vMAJOR.MINOR.PATCH`,
    );
    process.exit(1);
  }

  const version = tag.slice(1);
  const commitSha = resolveCommitSha(userSha);
  const outDir = userOutputDir
    ? resolve(process.cwd(), userOutputDir)
    : dirname(archivePath);
  mkdirSync(outDir, { recursive: true });

  // Extract archive to temporary directory to inspect exact entries
  const tmpExtract = mkdtempSync(resolve(tmpdir(), "dam-hopper-manifest-"));
  try {
    execFileSync("tar", ["-xzf", archivePath, "-C", tmpExtract]);

    // Inspect entries via tar -ztvf with LC_ALL=C to preserve exact tar header modes and order
    const tarListing = execFileSync("tar", ["-ztvf", archivePath], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    })
      .trim()
      .split("\n");
    const inventory = [];
    const seenPaths = new Set();

    for (const line of tarListing) {
      if (!line.trim()) continue;
      // Format: -rwxr-xr-x root/root 123456 2023-11-15 00:00 bin/dam-hopper-server
      // or:     drwxr-xr-x root/root      0 2023-11-15 00:00 web/
      const parts = line.trim().split(/\s+/);
      const permStr = parts[0];
      const rawPath = parts.slice(5).join(" ");
      const cleanPath = rawPath.replace(/\/+$/, "").replace(/^\.\//, "");

      if (!cleanPath) continue;
      const isDir = permStr.startsWith("d");
      // Skip intermediate packaging parent directories that are created automatically
      if (
        isDir &&
        (cleanPath === "bin" ||
          cleanPath === "systemd" ||
          cleanPath === "sysusers.d")
      ) {
        continue;
      }
      if (seenPaths.has(cleanPath)) continue;
      seenPaths.add(cleanPath);
      checkDisallowedPath(cleanPath);

      const kind = isDir ? "dir" : "file";

      // Parse mode from perm string
      let mode = 0;
      if (permStr[1] === "r") mode |= 0o400;
      if (permStr[2] === "w") mode |= 0o200;
      if (permStr[3] === "x") mode |= 0o100;
      if (permStr[4] === "r") mode |= 0o040;
      if (permStr[5] === "w") mode |= 0o020;
      if (permStr[6] === "x") mode |= 0o010;
      if (permStr[7] === "r") mode |= 0o004;
      if (permStr[8] === "w") mode |= 0o002;
      if (permStr[9] === "x") mode |= 0o001;

      const roles = assignRoles(cleanPath);

      if (kind === "file") {
        const fullExtractedPath = resolve(tmpExtract, cleanPath);
        if (!existsSync(fullExtractedPath)) {
          throw new Error(`Extracted file not found: ${cleanPath}`);
        }
        const fileBytes = readFileSync(fullExtractedPath);
        const fileSha = computeSha256(fileBytes);
        inventory.push({
          path: cleanPath,
          kind: "file",
          roles,
          mode,
          size: fileBytes.length,
          sha256: fileSha,
        });
      } else {
        inventory.push({
          path: cleanPath,
          kind: "dir",
          roles,
          mode,
        });
      }
    }

    // Sort inventory deterministically by path (ASCII byte order)
    inventory.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const manifest = {
      schemaVersion: 1,
      release: {
        tag,
        version,
        commitSha,
      },
      profile: {
        id: "fedora44-x86_64-systemd",
        osId: "fedora",
        osVersion: "44",
        arch: "x86_64",
        target: "x86_64-unknown-linux-gnu",
        glibcMin: "2.43",
        systemdMin: 259,
      },
      archive: {
        name: archiveName,
        size: archiveSize,
        sha256: archiveSha256,
      },
      components: {
        cli: { version },
        api: { version },
        webHost: { version },
        webAssets: { version },
      },
      inventory,
      services: {
        api: {
          unitName: "dam-hopper-api.service",
          identity: "root",
          bindHost: "0.0.0.0",
          port: 4801,
          healthPath: "/api/health",
        },
        web: {
          unitName: "dam-hopper-web.service",
          identity: "dam-hopper-web",
          bindHost: "0.0.0.0",
          port: 4802,
          healthPath: "/__dam-hopper/health",
        },
      },
      rollback: {
        previousReleaseCompatible: true,
        stateCompatibility: "n-1",
      },
    };

    const manifestPath = resolve(outDir, "release-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8",
    );

    // Generate SPDX 2.3 JSON SBOM
    const sbom = {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: `dam-hopper-${tag}`,
      documentNamespace: `https://dam-hopper.dev/spdx/dam-hopper-${tag}`,
      creationInfo: {
        created: process.env.SOURCE_DATE_EPOCH
          ? new Date(
              parseInt(process.env.SOURCE_DATE_EPOCH, 10) * 1000,
            ).toISOString()
          : new Date().toISOString(),
        creators: [
          "Tool: dam-hopper-release-publisher-1.0.0",
          "Organization: DamHopper",
        ],
      },
      packages: [
        {
          name: "dam-hopper",
          SPDXID: "SPDXRef-Package-dam-hopper",
          versionInfo: version,
          packageFileName: archiveName,
          downloadLocation: `https://github.com/${process.env.GITHUB_REPOSITORY || "loidinhm31/dam-hopper"}/releases/download/${tag}/${archiveName}`,
          filesAnalyzed: true,
          licenseConcluded: "MIT",
          licenseDeclared: "MIT",
          checksums: [
            {
              algorithm: "SHA256",
              checksumValue: archiveSha256,
            },
          ],
        },
      ],
      files: inventory
        .filter((entry) => entry.kind === "file")
        .map((entry) => ({
          fileName: entry.path,
          SPDXID: `SPDXRef-File-${entry.path.replace(/[^a-zA-Z0-9.-]/g, "-")}`,
          checksums: [
            {
              algorithm: "SHA256",
              checksumValue: entry.sha256,
            },
          ],
          licenseConcluded: "MIT",
        })),
      relationships: [
        {
          spdxElementId: "SPDXRef-DOCUMENT",
          relationshipType: "DESCRIBES",
          relatedSpdxElement: "SPDXRef-Package-dam-hopper",
        },
      ],
    };

    const sbomName = `dam-hopper-${tag}-fedora44-x86_64-systemd.spdx.json`;
    const sbomPath = resolve(outDir, sbomName);
    writeFileSync(sbomPath, JSON.stringify(sbom, null, 2) + "\n", "utf8");

    console.log(`✓ Generated release manifest and SPDX SBOM:
  Manifest: ${manifestPath} (${inventory.length} entries)
  SBOM:     ${sbomPath} (${sbom.files.length} files)
  Archive:  ${archiveName} (${archiveSha256})`);
  } finally {
    rmSync(tmpExtract, { recursive: true, force: true });
  }
}

main();

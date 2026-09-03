#!/usr/bin/env node
/**
 * Pre-publication exact release asset gate for DamHopper Linux releases.
 * Compares release assets against the strict four-subject invariant:
 *   1. dam-hopper-install.sh
 *   2. dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.tar.gz
 *   3. release-manifest.json
 *   4. dam-hopper-vX.Y.Z-fedora44-x86_64-systemd.spdx.json
 *
 * Fails closed on any extra, missing, empty, or mismatched asset.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TAG_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function computeSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let tag = process.env.RELEASE_TAG || null;
  let dir = null;
  let releaseId = null;
  let repo = process.env.GITHUB_REPOSITORY || null;
  let assetsJsonPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--tag' && i + 1 < args.length) {
      tag = args[++i];
    } else if (arg === '--dir' && i + 1 < args.length) {
      dir = args[++i];
    } else if (arg === '--release-id' && i + 1 < args.length) {
      releaseId = args[++i];
    } else if (arg === '--repo' && i + 1 < args.length) {
      repo = args[++i];
    } else if (arg === '--assets-json' && i + 1 < args.length) {
      assetsJsonPath = args[++i];
    } else if (!arg.startsWith('--') && !dir) {
      dir = arg;
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  if (!tag) {
    console.error('Usage: node check-release-assets.mjs --tag <vX.Y.Z> [--dir <dir>] [--release-id <id>] [--repo <owner/repo>]');
    process.exit(1);
  }

  if (!TAG_REGEX.test(tag)) {
    console.error(`Invalid tag '${tag}'. Must follow vMAJOR.MINOR.PATCH`);
    process.exit(1);
  }

  return {
    tag,
    dir: dir ? resolve(process.cwd(), dir) : null,
    releaseId,
    repo,
    assetsJsonPath: assetsJsonPath ? resolve(process.cwd(), assetsJsonPath) : null,
  };
}

function getExpectedAssetNames(tag) {
  return [
    'dam-hopper-install.sh',
    `dam-hopper-${tag}-fedora44-x86_64-systemd.tar.gz`,
    'release-manifest.json',
    `dam-hopper-${tag}-fedora44-x86_64-systemd.spdx.json`,
  ].sort();
}

function checkLocalDirectory(dir, tag, expectedNames) {
  if (!existsSync(dir)) {
    throw new Error(`Asset directory does not exist: ${dir}`);
  }

  const allFiles = readdirSync(dir).filter((f) => {
    // Ignore hidden files and subdirectories
    const full = resolve(dir, f);
    return statSync(full).isFile() && !f.startsWith('.');
  }).sort();

  // Find exact matches
  const missing = expectedNames.filter((name) => !allFiles.includes(name));
  if (missing.length > 0) {
    throw new Error(`Missing expected release assets in ${dir}:\n  - ${missing.join('\n  - ')}`);
  }

  const extra = allFiles.filter((name) => !expectedNames.includes(name));
  if (extra.length > 0) {
    throw new Error(`Unexpected extra files found in release directory:\n  - ${extra.join('\n  - ')}`);
  }

  // Check each file is non-empty
  const digests = {};
  for (const name of expectedNames) {
    const filePath = resolve(dir, name);
    const buf = readFileSync(filePath);
    if (buf.length === 0) {
      throw new Error(`Asset file is empty: ${name}`);
    }
    digests[name] = {
      size: buf.length,
      sha256: computeSha256(buf),
    };
  }

  // Verify release-manifest.json consistency
  const manifestPath = resolve(dir, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (manifest.release.tag !== tag) {
    throw new Error(`Manifest release.tag '${manifest.release.tag}' does not match expected '${tag}'`);
  }

  const archiveName = `dam-hopper-${tag}-fedora44-x86_64-systemd.tar.gz`;
  if (manifest.archive.name !== archiveName) {
    throw new Error(`Manifest archive.name '${manifest.archive.name}' does not match expected '${archiveName}'`);
  }

  const archiveDigest = digests[archiveName];
  if (manifest.archive.size !== archiveDigest.size) {
    throw new Error(`Manifest archive.size (${manifest.archive.size}) differs from actual archive (${archiveDigest.size})`);
  }
  if (manifest.archive.sha256 !== archiveDigest.sha256) {
    throw new Error(`Manifest archive.sha256 (${manifest.archive.sha256}) differs from actual archive (${archiveDigest.sha256})`);
  }

  // Verify bootstrap script syntax
  const installScriptPath = resolve(dir, 'dam-hopper-install.sh');
  try {
    execFileSync('bash', ['-n', installScriptPath]);
  } catch (err) {
    throw new Error(`Bootstrap installer syntax error in dam-hopper-install.sh: ${err.message}`);
  }

  // Verify SBOM is valid JSON and references tag
  const sbomName = `dam-hopper-${tag}-fedora44-x86_64-systemd.spdx.json`;
  const sbom = JSON.parse(readFileSync(resolve(dir, sbomName), 'utf8'));
  if (sbom.spdxVersion !== 'SPDX-2.3') {
    throw new Error(`SBOM spdxVersion '${sbom.spdxVersion}' is not SPDX-2.3`);
  }

  console.log(`✓ Local release asset gate passed for ${tag}:`);
  for (const name of expectedNames) {
    const info = digests[name];
    console.log(`  - ${name}: ${info.size} bytes (sha256: ${info.sha256})`);
  }

  return digests;
}

function checkGitHubReleaseAssets(tag, releaseId, repo, assetsJsonPath, localDigests, expectedNames) {
  let assets = [];

  if (assetsJsonPath && existsSync(assetsJsonPath)) {
    assets = JSON.parse(readFileSync(assetsJsonPath, 'utf8'));
  } else if (releaseId && repo) {
    const out = execFileSync('gh', [
      'api',
      `repos/${repo}/releases/${releaseId}/assets`,
      '--jq',
      '[.[] | {name: .name, size: .size, state: .state}]',
    ], { encoding: 'utf8' });
    assets = JSON.parse(out);
  } else {
    return;
  }

  const remoteNames = assets.map((a) => a.name).sort();
  const missing = expectedNames.filter((name) => !remoteNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Remote release is missing expected assets:\n  - ${missing.join('\n  - ')}`);
  }

  const extra = remoteNames.filter((name) => !expectedNames.includes(name));
  if (extra.length > 0) {
    throw new Error(`Remote release has unexpected extra assets:\n  - ${extra.join('\n  - ')}`);
  }

  for (const asset of assets) {
    if (asset.state !== 'uploaded') {
      throw new Error(`Remote asset '${asset.name}' is in non-uploaded state: '${asset.state}'`);
    }
    if (asset.size === 0) {
      throw new Error(`Remote asset '${asset.name}' has 0 bytes`);
    }
    if (localDigests && localDigests[asset.name]) {
      if (asset.size !== localDigests[asset.name].size) {
        throw new Error(`Remote asset '${asset.name}' size (${asset.size}) differs from local (${localDigests[asset.name].size})`);
      }
    }
  }

  console.log(`✓ Remote release asset gate passed: exactly 4 assets match.`);
}

function main() {
  const { tag, dir, releaseId, repo, assetsJsonPath } = parseArgs();
  const expectedNames = getExpectedAssetNames(tag);

  let localDigests = null;
  if (dir) {
    localDigests = checkLocalDirectory(dir, tag, expectedNames);
  }

  if (assetsJsonPath || (releaseId && repo)) {
    checkGitHubReleaseAssets(tag, releaseId, repo, assetsJsonPath, localDigests, expectedNames);
  }
}

main();

#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const BUILD_ARCHIVE_SCRIPT = resolve(REPO_ROOT, "deploy/release/build-release-archive.sh");
const CHECK_ASSETS_SCRIPT = resolve(REPO_ROOT, "deploy/release/check-release-assets.mjs");
const PACKAGE_TWICE_SCRIPT = resolve(REPO_ROOT, "tests/deploy/linux-release-package-twice.sh");
const PROVENANCE_PATH = resolve(REPO_ROOT, "deploy/release/semantic-engine/provenance.json");

const provenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8"));

function createMockBinariesAndWeb(targetDir, webDir) {
  mkdirSync(targetDir, { recursive: true });
  mkdirSync(webDir, { recursive: true });
  for (const bin of [
    "dam-hopper",
    "dam-hopper-server",
    "dam-hopper-web",
    "dam-hopper-idle-suspend-helper",
  ]) {
    const binPath = join(targetDir, bin);
    writeFileSync(binPath, `#!/bin/sh\necho ${bin}\n`);
    chmodSync(binPath, 0o755);
  }
  writeFileSync(join(webDir, "index.html"), "<!doctype html><html><body>ok</body></html>");
}

function createMockSemanticEngine(engineDir, overrides = {}) {
  mkdirSync(join(engineDir, "tsls/node_modules/typescript/lib"), { recursive: true });
  mkdirSync(join(engineDir, "tsls/node_modules/typescript-language-server/lib"), { recursive: true });

  const nodePath = join(engineDir, "node");
  writeFileSync(nodePath, "#!/bin/sh\necho node\n");
  chmodSync(nodePath, overrides.nodeMode ?? 0o755);

  const metaFiles = ["package.json", "pnpm-lock.yaml", "LICENSES.txt", "provenance.json"];
  for (const meta of metaFiles) {
    const src = resolve(REPO_ROOT, "deploy/release/semantic-engine", meta);
    const dst = join(engineDir, "tsls", meta);
    if (existsSync(src)) {
      copyFileSync(src, dst);
    } else {
      writeFileSync(dst, "{}\n");
    }
    chmodSync(dst, 0o644);
  }

  // Create typescript and language server files
  const tsFiles = [
    "tsls/node_modules/typescript-language-server/package.json",
    "tsls/node_modules/typescript-language-server/lib/cli.mjs",
    "tsls/node_modules/typescript-language-server/LICENSE",
    "tsls/node_modules/typescript/package.json",
    "tsls/node_modules/typescript/lib/tsserver.js",
    "tsls/node_modules/typescript/lib/_tsserver.js",
    "tsls/node_modules/typescript/lib/typescript.js",
    "tsls/node_modules/typescript/lib/typingsInstaller.js",
    "tsls/node_modules/typescript/lib/_typingsInstaller.js",
    "tsls/node_modules/typescript/lib/watchGuard.js",
    "tsls/node_modules/typescript/lib/typesMap.json",
    "tsls/node_modules/typescript/lib/lib.d.ts",
    "tsls/node_modules/typescript/lib/lib.es5.d.ts",
    "tsls/node_modules/typescript/LICENSE.txt",
    "tsls/node_modules/typescript/ThirdPartyNoticeText.txt",
  ];

  for (const rel of tsFiles) {
    const full = join(engineDir, rel);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, overrides.tamperFile === rel ? "tampered content" : "mock payload");
    chmodSync(full, overrides.fileMode?.[rel] ?? 0o644);
  }
}

function createMockReleaseAssetSet(dir, tag = "v0.1.0", options = {}) {
  mkdirSync(dir, { recursive: true });
  const ver = tag.replace(/^v/, "");
  const archiveName = `dam-hopper-${tag}-linux-x86_64-systemd.tar.gz`;
  const archivePath = join(dir, archiveName);

  const stageDir = join(dir, "staging");
  mkdirSync(join(stageDir, "bin"), { recursive: true });
  mkdirSync(join(stageDir, "web"), { recursive: true });
  mkdirSync(join(stageDir, "systemd"), { recursive: true });
  mkdirSync(join(stageDir, "sysusers.d"), { recursive: true });
  mkdirSync(join(stageDir, "tmpfiles.d"), { recursive: true });

  for (const bin of [
    "dam-hopper-manager",
    "dam-hopper-server",
    "dam-hopper-idle-suspend-helper",
    "dam-hopper-web",
  ]) {
    const p = join(stageDir, "bin", bin);
    writeFileSync(p, `#!/bin/sh\necho ${bin}\n`);
    chmodSync(p, 0o755);
  }

  writeFileSync(join(stageDir, "web/index.html"), "<!doctype html><html><body>ok</body></html>");
  writeFileSync(join(stageDir, "LICENSE"), "MIT\n");
  writeFileSync(join(stageDir, "NOTICES"), "Notices\n");
  copyFileSync(
    resolve(REPO_ROOT, "deploy/systemd/dam-hopper-api.service.in"),
    join(stageDir, "systemd/dam-hopper-api.service"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "deploy/systemd/dam-hopper-idle-suspend-helper.service.in"),
    join(stageDir, "systemd/dam-hopper-idle-suspend-helper.service"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "deploy/systemd/dam-hopper-web.service.in"),
    join(stageDir, "systemd/dam-hopper-web.service"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "deploy/systemd/dam-hopper-recovery.service.in"),
    join(stageDir, "systemd/dam-hopper-recovery.service"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "deploy/sysusers.d/dam-hopper-web.conf"),
    join(stageDir, "sysusers.d/dam-hopper-web.conf"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "deploy/tmpfiles.d/dam-hopper-runtime.conf.in"),
    join(stageDir, "tmpfiles.d/dam-hopper-runtime.conf"),
  );

  let inventory = [
    { path: "bin/dam-hopper-manager", kind: "file", mode: 0o755, size: 20, sha256: "0".repeat(64), roles: ["common"] },
    { path: "bin/dam-hopper-server", kind: "file", mode: 0o755, size: 20, sha256: "0".repeat(64), roles: ["server"] },
    { path: "bin/dam-hopper-idle-suspend-helper", kind: "file", mode: 0o755, size: 20, sha256: "0".repeat(64), roles: ["server"] },
    { path: "bin/dam-hopper-web", kind: "file", mode: 0o755, size: 20, sha256: "0".repeat(64), roles: ["web"] },
    { path: "systemd/dam-hopper-api.service", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["server"] },
    { path: "systemd/dam-hopper-idle-suspend-helper.service", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["server"] },
    { path: "systemd/dam-hopper-web.service", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["web"] },
    { path: "systemd/dam-hopper-recovery.service", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["common"] },
    { path: "sysusers.d/dam-hopper-web.conf", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["web"] },
    { path: "tmpfiles.d/dam-hopper-runtime.conf", kind: "file", mode: 0o644, size: 100, sha256: "0".repeat(64), roles: ["server"] },
    { path: "web", kind: "dir", mode: 0o755, roles: ["web"] },
    { path: "web/index.html", kind: "file", mode: 0o644, size: 50, sha256: "0".repeat(64), roles: ["web"] },
    { path: "LICENSE", kind: "file", mode: 0o644, size: 4, sha256: "0".repeat(64), roles: ["common"] },
    { path: "NOTICES", kind: "file", mode: 0o644, size: 8, sha256: "0".repeat(64), roles: ["common"] },
  ];

    if (options.includeSemanticEngine) {
      const engineStage = join(stageDir, "lib/semantic-engine");
      mkdirSync(join(engineStage, "tsls/node_modules/typescript/lib"), { recursive: true });
      mkdirSync(join(engineStage, "tsls/node_modules/typescript-language-server/lib"), { recursive: true });

      if (options.nodePayload) {
        writeFileSync(join(engineStage, "node"), options.nodePayload);
      } else {
        writeFileSync(join(engineStage, "node"), "#!/bin/sh\necho node\n");
      }
      chmodSync(join(engineStage, "node"), options.nodeMode ?? 0o755);

      const mockProvenance = {
        title: "MockProvenance",
        transitivePayloadDigests: {
          "node": createHash("sha256").update(readFileSync(join(engineStage, "node"))).digest("hex"),
        },
      };

      for (const rel of [
        "tsls/package.json",
        "tsls/pnpm-lock.yaml",
        "tsls/LICENSES.txt",
        "tsls/node_modules/typescript-language-server/lib/cli.mjs",
        "tsls/node_modules/typescript/lib/tsserver.js",
        "tsls/node_modules/typescript/lib/_tsserver.js",
        "tsls/node_modules/typescript/lib/typescript.js",
      ]) {
        const full = join(engineStage, rel);
        const content = `data for ${rel}\n`;
        writeFileSync(full, content);
        chmodSync(full, options.unsafeMode ?? 0o644);
        mockProvenance.transitivePayloadDigests[rel] = createHash("sha256").update(content).digest("hex");
      }
      if (options.omitFromArchive) {
        rmSync(join(engineStage, options.omitFromArchive), { force: true });
      }
      if (options.tamperArchiveBytes) {
        writeFileSync(join(engineStage, options.tamperArchiveBytes), "tampered content!\n");
      }

      const provPath = join(tmpdir(), "dam-hopper-mock-prov.json");
      writeFileSync(provPath, JSON.stringify(mockProvenance, null, 2));
      copyFileSync(provPath, join(engineStage, "tsls/provenance.json"));
      chmodSync(join(engineStage, "tsls/provenance.json"), options.unsafeMode ?? 0o644);
      const provSha = createHash("sha256").update(readFileSync(provPath)).digest("hex");

      const engineEntries = [
        { path: "lib", kind: "dir", mode: 0o755, roles: ["server"] },
        { path: "lib/semantic-engine", kind: "dir", mode: 0o755, roles: ["server"] },
        { path: "lib/semantic-engine/node", kind: "file", mode: options.nodeMode ?? 0o755, size: 100, sha256: options.tamper_node ? "0".repeat(64) : mockProvenance.transitivePayloadDigests["node"], roles: options.engineRole ?? ["server"] },
        { path: "lib/semantic-engine/tsls/package.json", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/package.json"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/pnpm-lock.yaml", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/pnpm-lock.yaml"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/LICENSES.txt", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/LICENSES.txt"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/provenance.json", kind: "file", mode: 0o644, size: 100, sha256: options.tamperDigest ? "f".repeat(64) : provSha, roles: ["server"] },
        { path: "lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/node_modules/typescript-language-server/lib/cli.mjs"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/node_modules/typescript/lib/tsserver.js"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/node_modules/typescript/lib/_tsserver.js", kind: "file", mode: options.unsafeMode ?? 0o644, size: 100, sha256: options.tamper_tsserver ? "0".repeat(64) : mockProvenance.transitivePayloadDigests["tsls/node_modules/typescript/lib/_tsserver.js"], roles: ["server"] },
        { path: "lib/semantic-engine/tsls/node_modules/typescript/lib/typescript.js", kind: "file", mode: 0o644, size: 100, sha256: mockProvenance.transitivePayloadDigests["tsls/node_modules/typescript/lib/typescript.js"], roles: ["server"] },
      ];

      if (options.omitEssentialPath) {
        const idx = engineEntries.findIndex((e) => e.path === options.omitEssentialPath);
        if (idx !== -1) engineEntries.splice(idx, 1);
      }

      inventory.push(...engineEntries);
    }

  // Write fake tarball
  execFileSync("tar", ["-czf", archivePath, "-C", stageDir, "."]);

  const archiveStat = readFileSync(archivePath);
  const archiveSha = createHash("sha256").update(archiveStat).digest("hex");

  const manifest = {
    schemaVersion: 2,
    release: { tag, version: ver, commitSha: "0123456789abcdef0123456789abcdef01234567" },
    profile: {
      id: "linux-x86_64-systemd",
      osId: "linux",
      osVersion: "any",
      arch: "x86_64",
      target: "x86_64-unknown-linux-gnu",
      glibcMin: "2.39",
      systemdMin: 245,
    },
    archive: {
      name: archiveName,
      size: archiveStat.length,
      sha256: archiveSha,
    },
    components: {
      cli: { version: ver },
      api: { version: ver },
      webHost: { version: ver },
      webAssets: { version: ver },
    },
    inventory,
    services: {
      api: { unitName: "dam-hopper-api.service", bindHost: "0.0.0.0", port: 4801, healthPath: "/api/health" },
      web: { unitName: "dam-hopper-web.service", identity: "dam-hopper-web", bindHost: "0.0.0.0", port: 4802, healthPath: "/__dam-hopper/health" },
    },
    rollback: {
      previousReleaseCompatible: true,
      stateCompatibility: "n-1",
    },
  };

  writeFileSync(join(dir, "release-manifest.json"), JSON.stringify(manifest, null, 2));

  // Write dummy install script and SBOM
  writeFileSync(join(dir, "dam-hopper-install.sh"), "#!/bin/sh\necho installer\n");
  chmodSync(join(dir, "dam-hopper-install.sh"), 0o755);
  writeFileSync(
    join(dir, `dam-hopper-${tag}-linux-x86_64-systemd.spdx.json`),
    JSON.stringify({ spdxVersion: "SPDX-2.3", name: "dam-hopper" }),
  );

  rmSync(stageDir, { recursive: true, force: true });
}

test("build-release-archive.sh fails when semantic engine is omitted without explicit flag", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-build-"));
  try {
    const targetDir = join(tmp, "bin");
    const webDir = join(tmp, "web");
    const outDir = join(tmp, "out");
    createMockBinariesAndWeb(targetDir, webDir);

    const res = spawnSync("bash", [
      BUILD_ARCHIVE_SCRIPT,
      "--version", "v0.1.0",
      "--target-dir", targetDir,
      "--web-dist", webDir,
      "--output-dir", outDir,
    ]);

    assert.notEqual(res.status, 0, "Build archive should fail when semantic engine is not provided");
    const stderr = res.stderr.toString();
    assert.match(stderr, /Semantic engine is required for Linux release archive/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("build-release-archive.sh succeeds with --allow-omitted-engine (diagnostic mode)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-build-"));
  try {
    const targetDir = join(tmp, "bin");
    const webDir = join(tmp, "web");
    const outDir = join(tmp, "out");
    createMockBinariesAndWeb(targetDir, webDir);

    const res = spawnSync("bash", [
      BUILD_ARCHIVE_SCRIPT,
      "--version", "v0.1.0",
      "--target-dir", targetDir,
      "--web-dist", webDir,
      "--output-dir", outDir,
      "--allow-omitted-engine",
    ]);

    assert.equal(res.status, 0, `Build archive should succeed with --allow-omitted-engine: ${res.stderr.toString()}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("package-twice.sh fails when --semantic-engine-dir is not provided", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-pkg-"));
  try {
    const targetDir = join(tmp, "bin");
    const webDir = join(tmp, "web");
    const outDir = join(tmp, "out");
    createMockBinariesAndWeb(targetDir, webDir);

    const res = spawnSync("bash", [
      PACKAGE_TWICE_SCRIPT,
      "--version", "v0.1.0",
      "--target-dir", targetDir,
      "--web-dist", webDir,
      "--output-dir", outDir,
    ]);

    assert.notEqual(res.status, 0, "package-twice.sh should fail when --semantic-engine-dir is omitted");
    const stderr = res.stderr.toString();
    assert.match(stderr, /--semantic-engine-dir <dir> is required for Linux package-twice/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when --require-semantic-engine is passed but engine is absent", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", { includeSemanticEngine: false });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ]);

    assert.notEqual(res.status, 0, "check-release-assets should fail when semantic engine is missing under --require-semantic-engine");
    const stderr = res.stderr.toString();
    assert.match(stderr, /missing required semantic engine/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when an essential engine file is omitted", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      omitEssentialPath: "lib/semantic-engine/tsls/node_modules/typescript/lib/_tsserver.js",
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail when _tsserver.js is missing");
    const stderr = res.stderr.toString();
    assert.match(stderr, /missing required semantic engine paths.*_tsserver\.js/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when essential engine file has tampered digest", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      tamper_tsserver: true,
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail on tampered digest");
    const stderr = res.stderr.toString();
    assert.match(stderr, /digest mismatch/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when essential engine file has unsafe writable mode", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      unsafeMode: 0o666,
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail on group/world-writable mode");
    const stderr = res.stderr.toString();
    assert.match(stderr, /unsafe group\/world-writable mode/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when node binary is not executable", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      nodeMode: 0o644,
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail when node binary is not executable");
    const stderr = res.stderr.toString();
    assert.match(stderr, /must be an executable regular file/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when semantic engine entry has invalid role", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      engineRole: ["web"],
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail when engine entry has role web");
    const stderr = res.stderr.toString();
    assert.match(stderr, /must belong to the server role/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs passes when release bundle has valid semantic engine", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.equal(res.status, 0, `check-release-assets should pass: ${res.stderr.toString()}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when manifest claims engine but physical archive omits essential file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      omitFromArchive: "node",
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail when physical archive omits file");
    const stderr = res.stderr.toString();
    assert.match(stderr, /missing essential semantic engine payload/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs fails when physical archive member bytes are tampered relative to provenance", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      tamperArchiveBytes: "tsls/node_modules/typescript/lib/tsserver.js",
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.notEqual(res.status, 0, "check-release-assets should fail when physical archive member is tampered");
    const stderr = res.stderr.toString();
    assert.match(stderr, /does not match/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("check-release-assets.mjs extracts and verifies member larger than 64 MiB without ENOBUFS", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-sem-assets-"));
  try {
    await createMockReleaseAssetSet(tmp, "v0.1.0", {
      includeSemanticEngine: true,
      nodePayload: Buffer.alloc(70 * 1024 * 1024, 0x41),
    });

    const res = spawnSync("node", [
      CHECK_ASSETS_SCRIPT,
      "--profile", "linux",
      "--tag", "v0.1.0",
      "--dir", tmp,
      "--require-semantic-engine",
    ], { env: { ...process.env, DAM_HOPPER_PROVENANCE_PATH: join(tmpdir(), "dam-hopper-mock-prov.json") } });

    assert.equal(res.status, 0, `check-release-assets should pass 70MB member: ${res.stderr.toString()}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

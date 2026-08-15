import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const nativeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = resolve(nativeRoot, "scripts/smoke-ssh-forward.mjs");
const schema = resolve(
  nativeRoot,
  "test-fixtures/ssh-forward/evidence.schema.json",
);
const repoRoot = resolve(nativeRoot, "../..");
const requiredChecks = [
  "aclExact12",
  "unauthorizedDenied",
  "numericOrdering",
  "eventHintContext",
  "targetLoopback",
  "trustApprovalAndRepair",
  "openSshBytes",
  "longIdleConcurrent",
  "secondProcessExposureAccepted",
  "listenerClosure",
  "reloadSingleListener",
  "updaterAbsent",
  "redacted",
];
const protectedApprovalTimestamp = new Date(Date.now() - 1000).toISOString();

function validEvidence(commitSha: string, artifactSha256: string) {
  return {
    schemaVersion: 1,
    status: "pass",
    platform: "windows",
    osVersion: "Windows test runner",
    webview2Version: "151.0.4129.78",
    sshVersion: "OpenSSH_for_Windows_9.5p1",
    commitSha,
    artifactSha256,
    artifactName: "fixture.exe",
    checks: Object.fromEntries(requiredChecks.map((check) => [check, true])),
    approvals: {
      releaseEngineer: { id: "release", timestamp: protectedApprovalTimestamp },
      securityReviewer: {
        id: "security",
        timestamp: protectedApprovalTimestamp,
      },
      productOwner: { id: "product", timestamp: protectedApprovalTimestamp },
    },
  };
}

function runEvidenceValidator(evidence: object, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dam-hopper-evidence-"));
  const artifact = join(directory, "fixture.exe");
  const evidenceFile = join(directory, "evidence.json");
  writeFileSync(artifact, "fixture artifact");
  writeFileSync(evidenceFile, JSON.stringify(evidence));
  const artifactCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  try {
    return execFileSync(process.execPath, [script, "--validate-evidence"], {
      cwd: resolve(nativeRoot, ".."),
      env: {
        ...process["env"],
        SMOKE_EVIDENCE_FILE: evidenceFile,
        SMOKE_ARTIFACT_FILE: artifact,
        SMOKE_ARTIFACT_COMMIT_SHA: artifactCommit,
        SMOKE_RELEASE_ENGINEER_ID: "release",
        SMOKE_SECURITY_REVIEWER_ID: "security",
        SMOKE_PRODUCT_OWNER_ID: "product",
        SMOKE_RELEASE_ENGINEER_APPROVED_AT: protectedApprovalTimestamp,
        SMOKE_SECURITY_REVIEWER_APPROVED_AT: protectedApprovalTimestamp,
        SMOKE_PRODUCT_OWNER_APPROVED_AT: protectedApprovalTimestamp,
        ...overrides,
      },
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("native SSH forwarding smoke gate", () => {
  it("passes the build-only boundary check", () => {
    const output = execFileSync(process.execPath, [script, "--build-only"], {
      cwd: resolve(nativeRoot, ".."),
      encoding: "utf8",
    });
    expect(output).toContain("build inputs and updater boundary PASS");
  });

  it("keeps the evidence schema strict", () => {
    const parsed = JSON.parse(readFileSync(schema, "utf8"));
    expect(parsed.additionalProperties).toBe(false);
    expect(parsed.properties.checks.additionalProperties).toBe(false);
    expect(parsed.properties.approvals.additionalProperties).toBe(false);
  });

  it("fails closed when runtime evidence is missing", () => {
    expect(() =>
      execFileSync(process.execPath, [script, "--validate-evidence"], {
        cwd: resolve(nativeRoot, ".."),
        env: { ...process.env, SMOKE_EVIDENCE_FILE: "missing-evidence.json" },
        encoding: "utf8",
      }),
    ).toThrow();
  });

  it("rejects nested evidence fields outside the schema", () => {
    const artifact = Buffer.from("fixture artifact");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const evidence = validEvidence(
      commit,
      createHash("sha256").update(artifact).digest("hex"),
    );
    (evidence.checks as Record<string, boolean>).unexpected = true;
    expect(() => runEvidenceValidator(evidence)).toThrow();
  });

  it("rejects evidence without a package commit binding", () => {
    const artifact = Buffer.from("fixture artifact");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const evidence = validEvidence(
      commit,
      createHash("sha256").update(artifact).digest("hex"),
    );
    expect(() =>
      runEvidenceValidator(evidence, { SMOKE_ARTIFACT_COMMIT_SHA: "" }),
    ).toThrow();
  });

  it("rejects an artifact hash mismatch", () => {
    const artifact = Buffer.from("fixture artifact");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const evidence = validEvidence(
      commit,
      createHash("sha256").update(artifact).digest("hex"),
    );
    evidence.artifactSha256 = "0".repeat(64);
    expect(() => runEvidenceValidator(evidence)).toThrow();
  });

  it("rejects evidence for a different checked-out commit", () => {
    const artifact = Buffer.from("fixture artifact");
    const evidence = validEvidence(
      "f".repeat(40),
      createHash("sha256").update(artifact).digest("hex"),
    );
    expect(() => runEvidenceValidator(evidence)).toThrow();
  });

  it("rejects approval timestamps that are not protected bindings", () => {
    const artifact = Buffer.from("fixture artifact");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const evidence = validEvidence(
      commit,
      createHash("sha256").update(artifact).digest("hex"),
    );
    evidence.approvals.securityReviewer.timestamp = new Date(
      Date.now() - 2000,
    ).toISOString();
    expect(() => runEvidenceValidator(evidence)).toThrow();
  });

  it("rejects redaction-sensitive evidence values", () => {
    const artifact = Buffer.from("fixture artifact");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const evidence = validEvidence(
      commit,
      createHash("sha256").update(artifact).digest("hex"),
    );
    evidence.osVersion = "Windows secret-token";
    expect(() => runEvidenceValidator(evidence)).toThrow();
  });

  it("does not echo unknown smoke arguments", () => {
    let output = "";
    try {
      execFileSync(
        process.execPath,
        [script, "--unknown", "C:\\secret\\payload"],
        { cwd: resolve(nativeRoot, ".."), encoding: "utf8", stdio: "pipe" },
      );
    } catch (error) {
      const result = error as { stdout?: string; stderr?: string };
      output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    }
    expect(output).toContain("unsupported smoke mode");
    expect(output).not.toContain("C:\\secret\\payload");
  });
});

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

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
const allowedEvidenceKeys = new Set([
  "schemaVersion",
  "status",
  "platform",
  "osVersion",
  "webview2Version",
  "sshVersion",
  "commitSha",
  "artifactSha256",
  "artifactName",
  "checks",
  "approvals",
]);
const sensitiveKey =
  /(secret|password|passphrase|private|fingerprint|endpoint|username|payload|path|key.?id)/i;
const protectedApprovalBindings = [
  {
    role: "releaseEngineer",
    idEnv: "SMOKE_RELEASE_ENGINEER_ID",
    timestampEnv: "SMOKE_RELEASE_ENGINEER_APPROVED_AT",
  },
  {
    role: "securityReviewer",
    idEnv: "SMOKE_SECURITY_REVIEWER_ID",
    timestampEnv: "SMOKE_SECURITY_REVIEWER_APPROVED_AT",
  },
  {
    role: "productOwner",
    idEnv: "SMOKE_PRODUCT_OWNER_ID",
    timestampEnv: "SMOKE_PRODUCT_OWNER_APPROVED_AT",
  },
];

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

function gitHead(root) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function sha256(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    fail("could not hash the packaged artifact");
    return null;
  }
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => expected.has(key)) &&
    [...expected].every((key) => Object.hasOwn(value, key))
  );
}

function validDateTime(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) <= Date.now()
  );
}

function validateEvidenceShape(evidence) {
  if (!exactKeys(evidence, allowedEvidenceKeys)) {
    fail("evidence does not match the top-level schema");
    return false;
  }
  if (evidence.schemaVersion !== 1) fail("evidence schemaVersion must be 1");
  if (evidence.status !== "pass") fail("runtime evidence must be status=pass");
  if (evidence.platform !== "windows")
    fail("evidence platform must be windows");
  for (const [key, pattern] of [
    [
      "osVersion",
      /^(?:Microsoft )?Windows(?: [A-Za-z0-9][A-Za-z0-9 .,_()[\]-]*)?$/,
    ],
    ["webview2Version", /^\d+(?:\.\d+){1,5}$/],
    [
      "sshVersion",
      /^OpenSSH(?:_for_Windows)?_[0-9][A-Za-z0-9._+-]*(?:, [A-Za-z]+ [0-9][A-Za-z0-9._+-]*)?$/,
    ],
  ]) {
    if (typeof evidence[key] !== "string" || !pattern.test(evidence[key]))
      fail(`evidence ${key} is invalid`);
  }
  if (!/^[0-9a-f]{40}$/.test(evidence.commitSha ?? ""))
    fail("evidence commitSha must be a 40-character lowercase SHA");
  if (!/^[0-9a-f]{64}$/.test(evidence.artifactSha256 ?? ""))
    fail("evidence artifactSha256 must be a lowercase SHA-256");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(evidence.artifactName ?? ""))
    fail("evidence artifactName is invalid");
  if (!exactKeys(evidence.checks, new Set(requiredChecks))) {
    fail("evidence checks do not match the schema");
  } else {
    for (const check of requiredChecks)
      if (evidence.checks[check] !== true)
        fail(`required check is not passing: ${check}`);
  }
  const roles = ["releaseEngineer", "securityReviewer", "productOwner"];
  if (!exactKeys(evidence.approvals, new Set(roles))) {
    fail("evidence approvals do not match the schema");
  } else {
    for (const role of roles) {
      const approval = evidence.approvals[role];
      if (!exactKeys(approval, new Set(["id", "timestamp"]))) {
        fail(`approval binding is malformed: ${role}`);
        continue;
      }
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(approval.id))
        fail(`approval ID is invalid: ${role}`);
      if (!validDateTime(approval.timestamp))
        fail(`approval timestamp is invalid: ${role}`);
    }
  }
  return !process.exitCode;
}

function collectStrings(value, key = "", result = []) {
  if (typeof value === "string") result.push([key, value]);
  else if (Array.isArray(value))
    value.forEach((item) => collectStrings(item, key, result));
  else if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value))
      collectStrings(childValue, childKey, result);
  }
  return result;
}

export function validateEvidence({ root, evidenceFile, artifactFile }) {
  if (process.platform !== "win32")
    return fail("evidence validation is Windows-only");
  if (!existsSync(evidenceFile)) return fail("missing Windows evidence");
  const evidence = readJson(evidenceFile, "evidence");
  if (!evidence || !validateEvidenceShape(evidence)) return;
  const head = gitHead(root);
  const artifactCommit = process["env"]["SMOKE_ARTIFACT_COMMIT_SHA"];
  if (!head) fail("could not resolve the checked-out commit");
  else if (evidence.commitSha !== head)
    fail("evidence commitSha does not match the checked-out commit");
  if (!/^[0-9a-f]{40}$/.test(artifactCommit ?? ""))
    fail("SMOKE_ARTIFACT_COMMIT_SHA must be a 40-character lowercase SHA");
  else if (evidence.commitSha !== artifactCommit)
    fail("evidence commitSha does not match the packaged artifact commit");
  if (!artifactFile || !existsSync(artifactFile))
    fail("SMOKE_ARTIFACT_FILE must point to the packaged artifact");
  else if (evidence.artifactName !== basename(artifactFile))
    fail("evidence artifactName does not match the packaged artifact");
  else if (evidence.artifactSha256 !== sha256(artifactFile))
    fail("evidence artifactSha256 does not match the packaged artifact");
  for (const binding of protectedApprovalBindings) {
    const approval = evidence.approvals?.[binding.role];
    const expectedId = process["env"][binding.idEnv];
    const expectedTimestamp = process["env"][binding.timestampEnv];
    if (!expectedId)
      fail(`protected approval ID is not configured: ${binding.role}`);
    else if (approval?.id !== expectedId)
      fail(`approval ID is not bound to protected role: ${binding.role}`);
    if (!validDateTime(expectedTimestamp))
      fail(`protected approval timestamp is invalid: ${binding.role}`);
    else if (approval?.timestamp !== expectedTimestamp)
      fail(
        `approval timestamp is not bound to protected record: ${binding.role}`,
      );
  }
  for (const [key, value] of collectStrings(evidence)) {
    if (
      sensitiveKey.test(key) ||
      /[\\/]|\.ssh|127\.0\.0\.1|localhost|\b(?:bearer|token|secret|api[_-]?key)\b/i.test(
        value,
      )
    )
      fail(`evidence contains a prohibited ${key || "value"}`);
  }
  if (!process.exitCode) console.log("native-ssh-forward smoke: evidence PASS");
}

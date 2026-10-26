#!/usr/bin/env node
/**
 * scripts/qualify-semantic-navigation.mjs
 *
 * Phase 09 qualification runner consuming Main's canonical
 * `plans/260901-1000-lsp-server-integration/reports/phase-09-qualification-budget-v1.json`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as FS_CONST,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, release as osRelease, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadProvenance,
  locateVerifiedNodeBinary,
  locateVerifiedNodeModules,
} from "../deploy/release/semantic-engine/stage-semantic-engine.mjs";
import { generateCorpusTier } from "../server/tests/fixtures/generate-semantic-large.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const DEFAULT_CANONICAL_BUDGET_PATH = resolve(
  REPO_ROOT,
  "plans/260901-1000-lsp-server-integration/reports/phase-09-qualification-budget-v1.json",
);

function sha256FileOrNull(filePath) {
  if (!existsSync(filePath)) return null;
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function parseCompiledThresholdFromResourcesRs(
  resourcesPath = resolve(REPO_ROOT, "server/src/semantic/resources.rs"),
) {
  if (!existsSync(resourcesPath)) return null;
  const content = readFileSync(resourcesPath, "utf8");
  const match = content.match(
    /pub\s+const\s+ADAPTIVE_SYNC_THRESHOLD_BYTES\s*:\s*usize\s*=\s*([^;]+);/,
  );
  if (!match) return null;
  const expr = match[1].replace(/_/g, "").trim();
  if (/^\d+$/.test(expr)) {
    const val = Number(expr);
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  const mulMatch = expr.match(/^(\d+)\s*\*\s*(\d+)$/);
  if (mulMatch) {
    const val = Number(mulMatch[1]) * Number(mulMatch[2]);
    return Number.isSafeInteger(val) && val > 0 ? val : null;
  }
  return null;
}

export function inspectSourceIdentity() {
  const resourcesPath = resolve(REPO_ROOT, "server/src/semantic/resources.rs");
  const compiledProductionThresholdBytes =
    parseCompiledThresholdFromResourcesRs(resourcesPath);
  let gitHeadSha = null;
  let gitWorktreeDirty = null;
  try {
    const rev = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (rev.status === 0 && rev.stdout) {
      gitHeadSha = rev.stdout.trim();
    }
    const st = spawnSync("git", ["status", "--porcelain"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (st.status === 0 && typeof st.stdout === "string") {
      gitWorktreeDirty = st.stdout.trim().length > 0;
    }
  } catch {
    // Ignore git inspection failures
  }

  return {
    gitHeadSha,
    gitWorktreeDirty,
    compiledProductionThresholdBytes,
    fileDigests: {
      resourcesRsSha256: sha256FileOrNull(resourcesPath),
      semanticClientTsSha256: sha256FileOrNull(
        resolve(REPO_ROOT, "packages/ui/src/api/semantic-client.ts"),
      ),
      semanticMonacoTsSha256: sha256FileOrNull(resolve(REPO_ROOT, "packages/ui/src/lib/semantic-monaco.ts")),
      semanticModelUriTsSha256: sha256FileOrNull(resolve(REPO_ROOT, "packages/ui/src/lib/semantic-model-uri.ts")),
      editorStoreTsSha256: sha256FileOrNull(resolve(REPO_ROOT, "packages/ui/src/stores/editor.ts")),
      backendQualificationRsSha256: sha256FileOrNull(
        resolve(REPO_ROOT, "server/tests/semantic_resource_qualification.rs"),
      ),
      browserQualificationTsSha256: sha256FileOrNull(
        resolve(
          REPO_ROOT,
          "packages/ui/browser-tests/semantic-threshold-qualification.browser.ts",
        ),
      ),
      runnerMjsSha256: sha256FileOrNull(
        resolve(REPO_ROOT, "scripts/qualify-semantic-navigation.mjs"),
      ),
    },
  };
}

export function parseCandidateThresholdArg(
  raw,
  allowedCandidates = [32768, 65536, 131072],
) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim().toLowerCase().replace(/_/g, "");
  let parsed = null;
  if (trimmed === "32kib" || trimmed === "32kb" || trimmed === "32k") {
    parsed = 32768;
  } else if (trimmed === "64kib" || trimmed === "64kb" || trimmed === "64k") {
    parsed = 65536;
  } else if (trimmed === "128kib" || trimmed === "128kb" || trimmed === "128k") {
    parsed = 131072;
  } else if (/^\d+$/.test(trimmed)) {
    parsed = Number(trimmed);
  }
  if (!Number.isFinite(parsed) || !allowedCandidates.includes(parsed)) {
    throw new Error(
      `Invalid --candidate-threshold '${raw}': must be one of ${allowedCandidates.join(", ")} (32KiB/64KiB/128KiB)`,
    );
  }
  return parsed;
}

export function loadCanonicalBudget(budgetPath = DEFAULT_CANONICAL_BUDGET_PATH) {
  if (!existsSync(budgetPath)) {
    throw new Error(`Canonical qualification budget not found at ${budgetPath}`);
  }
  const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
  if (budget.schemaVersion !== 1 || budget.fixtureSeed !== 24301) {
    throw new Error(
      `Invalid canonical budget schemaVersion or fixtureSeed in ${budgetPath}`,
    );
  }
  return budget;
}

export function inspectHostCgroupV2Capability() {
  try {
    const line = readFileSync("/proc/self/cgroup", "utf8")
      .trim()
      .split("\n")
      .find((l) => l.startsWith("0::"));
    if (!line) {
      return {
        available: false,
        reason: "cgroup v2 unified hierarchy (0::) not active",
      };
    }
    const relPath = line.slice(3).trim().replace(/^\/+/, "");
    const cgDir = relPath ? join("/sys/fs/cgroup", relPath) : "/sys/fs/cgroup";
    const controllersPath = join(cgDir, "cgroup.controllers");
    if (!existsSync(controllersPath)) {
      return { available: false, reason: "cgroup.controllers not present" };
    }
    const controllers = readFileSync(controllersPath, "utf8").trim().split(/\s+/);
    for (const req of ["memory", "cpu", "pids"]) {
      if (!controllers.includes(req)) {
        return {
          available: false,
          reason: `Missing delegated controller '${req}'`,
        };
      }
    }
    try {
      accessSync(cgDir, FS_CONST.W_OK);
    } catch {
      return {
        available: false,
        reason: "Current process cgroup directory is not writable (test -w exit 1)",
      };
    }
    return {
      available: false,
      reason:
        "Host cgroup writable, but SemanticSupervisor does not wire LinuxResourceController into session spawn",
    };
  } catch (err) {
    return {
      available: false,
      reason: `cgroup inspection failed: ${err.message}`,
    };
  }
}

export function verifyTupleAndFixturesOrFail(canonicalBudget) {
  const provenance = loadProvenance(
    join(REPO_ROOT, "deploy/release/semantic-engine"),
  );
  if (provenance.tupleId !== canonicalBudget.tuple) {
    throw new Error(
      `Tuple mismatch: provenance ${provenance.tupleId} != budget ${canonicalBudget.tuple}`,
    );
  }
  locateVerifiedNodeBinary(provenance.components.node.sha256);
  locateVerifiedNodeModules(provenance);
  const fixtureManifest = JSON.parse(
    readFileSync(
      join(REPO_ROOT, "server/tests/fixtures/semantic-fixtures-manifest.json"),
      "utf8",
    ),
  );
  if (fixtureManifest.fixtureSeed !== canonicalBudget.fixtureSeed) {
    throw new Error(
      `Fixture seed mismatch: manifest ${fixtureManifest.fixtureSeed} != budget ${canonicalBudget.fixtureSeed}`,
    );
  }
  return { provenance, fixtureManifest };
}

function buildIdentityEnvelope(provenance, fixtureManifest, sourceIdentity) {
  return {
    sourceIdentity,
    compiledProductionThresholdBytes:
      sourceIdentity.compiledProductionThresholdBytes,
    tupleIdentity: {
      tupleId: provenance.tupleId,
      nodeSha256: provenance.components?.node?.sha256 ?? null,
      packageJsonSha256: provenance.components.packageJson.sha256,
      lockfileSha256: provenance.components.lockfile.sha256,
      tslsEntrypointSha256: provenance.components.typescriptLanguageServer.sha256,
      tsserverSha256: provenance.components.typescript.sha256,
    },
    fixtureIdentity: {
      fixtureSeed: fixtureManifest.fixtureSeed,
      tiers: fixtureManifest.tiers,
    },
  };
}

function runCargoQualificationStage({
  stage,
  mode,
  thresholdBytes,
  sampling,
  largeDir,
  attemptFile,
  dev,
  identityEnvelope,
}) {
  const cargoArgs = [
    "test",
    ...(dev ? [] : ["--release"]),
    "--manifest-path",
    "server/Cargo.toml",
    "--test",
    "semantic_resource_qualification",
    "live_semantic_navigation_qualification",
    "--",
    "--ignored",
    "--exact",
    "--nocapture",
  ];
  const res = spawnSync("cargo", cargoArgs, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      SEMANTIC_QUAL_STAGE: stage,
      SEMANTIC_QUAL_MODE: mode,
      SEMANTIC_QUAL_THRESHOLD_BYTES: String(thresholdBytes),
      SEMANTIC_QUAL_REPETITIONS: String(sampling.freshFinalRepetitions),
      SEMANTIC_QUAL_WARMUP_SAMPLES: String(sampling.warmupNavigationsPerWorkload),
      SEMANTIC_QUAL_WARM_SAMPLES: String(sampling.warmNavigationsPerWorkload),
      SEMANTIC_QUAL_COLD_SESSIONS: String(sampling.coldSessionsPerWorkload),
      SEMANTIC_QUAL_CORE_SAMPLES: String(
        sampling.coreSamplesPerEndpointPerCondition,
      ),
      SEMANTIC_QUAL_LARGE_DIR: largeDir,
      SEMANTIC_QUAL_OUTPUT_FILE: attemptFile,
    },
  });

  let payload = null;
  if (existsSync(attemptFile)) {
    try {
      payload = JSON.parse(readFileSync(attemptFile, "utf8"));
    } catch {
      payload = null;
    }
  }

  const enriched = {
    stage,
    requestedMode: mode,
    requestedThresholdBytes: thresholdBytes,
    ...identityEnvelope,
    ...(payload ?? {
      status: "FAILED",
      reason: `Cargo test exited with status ${res.status ?? "null"} before writing output file`,
    }),
    cargoExitStatus: res.status ?? null,
    cargoSignal: res.signal ?? null,
  };
  if (res.status !== 0 && enriched.status === "MEASURED") {
    enriched.status = "FAILED_NONZERO_EXIT";
  }
  writeFileSync(attemptFile, JSON.stringify(enriched, null, 2) + "\n");

  if (res.status !== 0 || !payload) {
    throw new Error(
      `Qualification stage '${stage}' (mode=${mode}, threshold=${thresholdBytes}) failed with exit ${res.status} (preserved attempt: ${attemptFile})`,
    );
  }
  return enriched;
}

function isFiniteNonNegativeNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isNonNegativeSafeInteger(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

export function evaluateRunAgainstCanonicalBudgets(report, offBaseline, budgets) {
  const failures = [];
  if (report?.status !== "MEASURED" || offBaseline?.status !== "MEASURED") {
    failures.push("Both loaded run and OFF baseline must have measured status");
    return { passed: false, failures, evaluatedCoreCeilingMs: null };
  }
  for (const field of [
    "coldReadyP95Ms",
    "coreAndTerminalP95Ms",
    "reapDurationMaxMs",
  ]) {
    if (!isFiniteNonNegativeNumber(report[field])) {
      failures.push(`${field} is unmeasured (null) or invalid`);
    }
  }
  if (!isFiniteNonNegativeNumber(offBaseline.coreAndTerminalP95Ms)) {
    failures.push(
      "OFF baseline core/terminal latency is unmeasured (null) or invalid",
    );
  }
  if (failures.length) {
    return { passed: false, failures, evaluatedCoreCeilingMs: null };
  }

  if (report.coldReadyP95Ms > budgets.coldReadyP95Ms) {
    failures.push(
      `coldReadyP95Ms ${report.coldReadyP95Ms.toFixed(2)} > ${budgets.coldReadyP95Ms}`,
    );
  }
  for (const tier of ["small", "medium", "large"]) {
    const tierObj = report.tiers?.[tier];
    const actual = tierObj?.warmNavP95Ms;
    const limit = budgets.warmNavigationP95Ms[tier];
    if (!isFiniteNonNegativeNumber(actual)) {
      failures.push(`warmNavigationP95Ms.${tier} is unmeasured (null)`);
    } else if (actual > limit) {
      failures.push(`warmNavigationP95Ms.${tier} ${actual} > ${limit}`);
    }
    const overlap = tierObj?.overlap;
    if (
      !overlap ||
      overlap.barrierSynchronized !== true ||
      !isFiniteNonNegativeNumber(overlap.totalOverlapDurationMs) ||
      overlap.totalOverlapDurationMs <= 0 ||
      !isFiniteNonNegativeNumber(overlap.observedNavigationsDuringCoreWindow) ||
      overlap.observedNavigationsDuringCoreWindow <= 0 ||
      !isFiniteNonNegativeNumber(overlap.observedCoreProbesDuringNavWindow) ||
      overlap.observedCoreProbesDuringNavWindow <= 0
    ) {
      failures.push(
        `Tier '${tier}' missing verified barrier-overlapped core/terminal schedule`,
      );
    }
  }

  const offP95 = offBaseline.coreAndTerminalP95Ms;
  const coreLimit = Math.min(
    budgets.coreAndTerminalP95AbsoluteMs,
    Math.max(3.0 * offP95, offP95 + 50.0),
  );
  if (report.coreAndTerminalP95Ms > coreLimit) {
    failures.push(
      `coreAndTerminalP95Ms ${report.coreAndTerminalP95Ms.toFixed(2)} > ${coreLimit.toFixed(2)}`,
    );
  }
  if (report.reapDurationMaxMs > budgets.reapDeadlineMs) {
    failures.push(
      `reapDurationMaxMs ${report.reapDurationMaxMs.toFixed(2)} > ${budgets.reapDeadlineMs}`,
    );
  }
  for (const tier of ["small", "medium", "large"]) {
    for (const endpoint of ["health", "workspaceStatus", "fsList", "gitRoots", "ptyRoundTrip"]) {
      const actual = report.tiers?.[tier]?.perEndpoint?.[endpoint]?.p95Ms;
      const baseline = offBaseline.corePerEndpoint?.[endpoint]?.p95Ms;
      if (!isFiniteNonNegativeNumber(actual) || !isFiniteNonNegativeNumber(baseline)) {
        failures.push(`${tier}.${endpoint} p95 or matching OFF baseline is unmeasured`);
      } else {
        const ceiling = Math.min(budgets.coreAndTerminalP95AbsoluteMs,
          Math.max(3 * baseline, baseline + 50));
        if (actual > ceiling) failures.push(`${tier}.${endpoint} p95 ${actual} > ${ceiling}`);
      }
    }
  }

  const res = report.resources;
  if (
    !res ||
    !isFiniteNonNegativeNumber(res.peakTreeRssBytes) ||
    res.peakTreeRssBytes <= 0 ||
    !isFiniteNonNegativeNumber(res.p95TreeRssBytes) ||
    res.p95TreeRssBytes <= 0 ||
    !isFiniteNonNegativeNumber(res.totalCpuDeltaMs) ||
    !isFiniteNonNegativeNumber(res.intervalCpuPctP95) ||
    !res.measuredScope
  ) {
    failures.push(
      "Whole-tree CPU delta or RSS finite-interval resource metrics are unmeasured (null)",
    );
  }
  for (const phase of ["startup", "warm", "browser"]) {
    const live = res?.perPhaseObservations?.[phase]?.liveSamples;
    if (!Number.isSafeInteger(live) || live <= 0) {
      failures.push(`Missing actual semantic live-process resource observations during ${phase}`);
    }
  }
  if (!Number.isSafeInteger(res?.postCleanupZeroObservations) || res.postCleanupZeroObservations <= 0) {
    failures.push("Missing observed zero owned processes after cleanup");
  }

  const clientQual = report.clientThresholdQualification;
  if (
    !clientQual ||
    clientQual.status !== "MEASURED" ||
    clientQual.negotiatedThresholdBytes !== report.adaptiveSyncThresholdBytes ||
    !isFiniteNonNegativeNumber(clientQual.totalWirePayloadBytes) ||
    clientQual.fixedUnionStepCount !== 21
  ) {
    failures.push(
      "Real SemanticClient browser adaptive threshold qualification is unmeasured or incomplete",
    );
  }

  for (const [key, expected] of [
    ["terminalDrops", budgets.terminalDrops],
    ["staleReveals", budgets.staleReveals],
    [
      "unauthorizedOrOutsideTargetDisclosures",
      budgets.unauthorizedOrOutsideTargetDisclosures,
    ],
    ["orphanProcesses", budgets.orphanProcesses],
    [
      "projectCodeCanaryExecutionsInDeniedRuns",
      budgets.projectCodeCanaryExecutionsInDeniedRuns,
    ],
  ]) {
    if (
      report[key] === null ||
      typeof report[key] !== "number" ||
      !Number.isFinite(report[key])
    ) {
      failures.push(`${key} is UNMEASURED (null)`);
    } else if (report[key] !== expected) {
      failures.push(`${key} expected ${expected}, got ${report[key]}`);
    }
  }

  const diag = report.sessionPressureDiagnostics;
  if (!diag) {
    failures.push("sessionPressureDiagnostics is UNMEASURED (null)");
  } else {
    const scope = diag.measuredScope;
    if (!scope || typeof scope.inspectedActorHandles !== "string") {
      failures.push("sessionPressureDiagnostics.measuredScope is missing or invalid");
    } else {
      if (!isNonNegativeSafeInteger(scope.inspectedSessionCount) || scope.inspectedSessionCount <= 0) {
        failures.push("sessionPressureDiagnostics.measuredScope.inspectedSessionCount must be a positive integer");
      }
      if (scope.browserWsSessions !== null) {
        failures.push("sessionPressureDiagnostics.measuredScope.browserWsSessions must be null (unmeasured, not fake 0)");
      }
    }

    const peaks = diag.maxPerSessionPeaks;
    if (!peaks) {
      failures.push("sessionPressureDiagnostics.maxPerSessionPeaks is missing");
    } else {
      for (const field of [
        "inFlightRequests",
        "commandQueueSlots",
        "childOutboundQueueSlots",
        "childOutboundBytes",
        "openDocuments",
        "overlayBytes",
      ]) {
        if (!isNonNegativeSafeInteger(peaks[field])) {
          failures.push(`sessionPressureDiagnostics.maxPerSessionPeaks.${field} is unmeasured or invalid`);
        }
      }
      if (isNonNegativeSafeInteger(peaks?.openDocuments) && peaks.openDocuments <= 0) {
        failures.push("sessionPressureDiagnostics.maxPerSessionPeaks.openDocuments must be > 0");
      }
      if (isNonNegativeSafeInteger(peaks?.overlayBytes) && peaks.overlayBytes <= 0) {
        failures.push("sessionPressureDiagnostics.maxPerSessionPeaks.overlayBytes must be > 0");
      }
    }

    const cleanup = diag.postReapCleanup;
    if (!cleanup) {
      failures.push("sessionPressureDiagnostics.postReapCleanup is missing");
    } else {
      if (cleanup.allClean !== true) {
        failures.push("sessionPressureDiagnostics.postReapCleanup.allClean is false (residual resources detected)");
      }
      for (const field of [
        "maxResidualOverlayBytes",
        "maxResidualOpenDocuments",
        "maxResidualInFlightRequests",
        "maxResidualCommandQueueSlots",
        "maxResidualChildOutboundQueueSlots",
        "maxResidualChildOutboundBytes",
      ]) {
        if (!isNonNegativeSafeInteger(cleanup[field])) {
          failures.push(`sessionPressureDiagnostics.postReapCleanup.${field} is unmeasured or invalid`);
        } else if (cleanup[field] !== 0) {
          failures.push(`sessionPressureDiagnostics.postReapCleanup.${field} expected 0, got ${cleanup[field]}`);
        }
      }
      if (!isNonNegativeSafeInteger(cleanup.reapedSessionCount)) {
        failures.push("sessionPressureDiagnostics.postReapCleanup.reapedSessionCount is unmeasured");
      }
      if (
        isNonNegativeSafeInteger(cleanup.reapedSessionCount) &&
        isNonNegativeSafeInteger(scope?.inspectedSessionCount) &&
        cleanup.reapedSessionCount !== scope.inspectedSessionCount
      ) {
        failures.push(
          `sessionPressureDiagnostics.postReapCleanup.reapedSessionCount (${cleanup.reapedSessionCount}) != inspectedSessionCount (${scope.inspectedSessionCount})`,
        );
      }
    }

    const lifetime = diag.lifetimeTotals;
    if (!lifetime) {
      failures.push("sessionPressureDiagnostics.lifetimeTotals is missing");
    } else {
      for (const field of ["spawnAttempts", "successfulSpawns", "restartAttempts", "successfulRestarts"]) {
        if (!isNonNegativeSafeInteger(lifetime[field])) {
          failures.push(`sessionPressureDiagnostics.lifetimeTotals.${field} is unmeasured or invalid`);
        }
      }
      if (isNonNegativeSafeInteger(lifetime?.spawnAttempts) && lifetime.spawnAttempts <= 0) {
        failures.push("sessionPressureDiagnostics.lifetimeTotals.spawnAttempts must be > 0");
      }
      if (
        isNonNegativeSafeInteger(lifetime?.successfulSpawns) &&
        isNonNegativeSafeInteger(lifetime?.spawnAttempts) &&
        lifetime.successfulSpawns !== lifetime.spawnAttempts
      ) {
        failures.push(
          `sessionPressureDiagnostics.lifetimeTotals.successfulSpawns (${lifetime.successfulSpawns}) != spawnAttempts (${lifetime.spawnAttempts})`,
        );
      }
      if (isNonNegativeSafeInteger(lifetime?.restartAttempts) && lifetime.restartAttempts !== 0) {
        failures.push(`Unexpected restartAttempts: expected 0, got ${lifetime.restartAttempts}`);
      }
      if (isNonNegativeSafeInteger(lifetime?.successfulRestarts) && lifetime.successfulRestarts !== 0) {
        failures.push(`Unexpected successfulRestarts: expected 0, got ${lifetime.successfulRestarts}`);
      }
    }

    const errors = diag.unexpectedErrorCounters;
    if (!errors) {
      failures.push("sessionPressureDiagnostics.unexpectedErrorCounters is missing");
    } else {
      for (const [field, label] of [
        ["navigationTimeouts", "navigationTimeouts"],
        ["navigationCancellations", "navigationCancellations"],
        ["navigationOverloads", "navigationOverloads"],
        ["staleResults", "staleResults"],
      ]) {
        if (!isNonNegativeSafeInteger(errors[field])) {
          failures.push(`sessionPressureDiagnostics.unexpectedErrorCounters.${label} is unmeasured (null)`);
        } else if (errors[field] !== 0) {
          failures.push(`Unexpected ${label}: expected 0, got ${errors[field]}`);
        }
      }
    }
  }
  return {
    passed: failures.length === 0,
    failures,
    evaluatedCoreCeilingMs: coreLimit,
  };
}

export function parseCliArgs(args, allowedCandidates = [32768, 65536, 131072]) {
  let stage = null;
  let mode = "both";
  let outputDir = resolve(REPO_ROOT, "artifacts/semantic-qualification");
  let budgetPath = DEFAULT_CANONICAL_BUDGET_PATH;
  let candidateThreshold = null;
  let dev = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--stage" && i + 1 < args.length) stage = args[++i];
    else if (a === "--mode" && i + 1 < args.length) mode = args[++i];
    else if (a === "--output" && i + 1 < args.length) outputDir = resolve(args[++i]);
    else if (a === "--budget-file" && i + 1 < args.length) {
      budgetPath = resolve(args[++i]);
    } else if (a === "--candidate-threshold" && i + 1 < args.length) {
      candidateThreshold = parseCandidateThresholdArg(args[++i], allowedCandidates);
    } else if (a.startsWith("--candidate-threshold=")) {
      candidateThreshold = parseCandidateThresholdArg(
        a.slice("--candidate-threshold=".length),
        allowedCandidates,
      );
    } else if (a === "--dev") dev = true;
    else throw new Error(`Unknown or incomplete CLI argument: '${a}'`);
  }
  if (!["verify-inputs", "off-baseline", "exploratory", "final"].includes(stage)) {
    throw new Error(
      "Required --stage must be one of: verify-inputs | off-baseline | exploratory | final",
    );
  }
  if (!["portable", "hard", "both"].includes(mode)) {
    throw new Error("--mode must be one of: portable | hard | both");
  }
  if (stage === "final" && dev) throw new Error("Final qualification requires the optimized release build");
  return {
    stage,
    mode,
    outputDir,
    budgetPath,
    candidateThreshold,
    dev,
  };
}

function main() {
  const preArgs = process.argv.slice(2);
  let budgetPathPreview = DEFAULT_CANONICAL_BUDGET_PATH;
  for (let i = 0; i < preArgs.length; i++) {
    if (preArgs[i] === "--budget-file" && i + 1 < preArgs.length) {
      budgetPathPreview = resolve(preArgs[i + 1]);
    }
  }
  const canonicalBudget = loadCanonicalBudget(budgetPathPreview);
  const {
    stage,
    mode,
    outputDir,
    budgetPath,
    candidateThreshold,
    dev,
  } = parseCliArgs(preArgs, canonicalBudget.candidateThresholdBytes);

  const { provenance, fixtureManifest } =
    verifyTupleAndFixturesOrFail(canonicalBudget);
  const cgroupInfo = inspectHostCgroupV2Capability();
  const sourceIdentity = inspectSourceIdentity();
  const identityEnvelope = buildIdentityEnvelope(
    provenance,
    fixtureManifest,
    sourceIdentity,
  );
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-pid${process.pid}`;
  const attemptsDir = join(outputDir, "attempts");
  mkdirSync(attemptsDir, { recursive: true });
  if (mode === "hard" && stage !== "verify-inputs") {
    writeFileSync(join(attemptsDir, `${runId}-hard-unqualified.json`),
      JSON.stringify({ runId, status: "UNAVAILABLE_UNQUALIFIED", ...identityEnvelope, ...cgroupInfo }, null, 2) + "\n");
    throw new Error("Hard-mode qualification unavailable: production child-tree adapter is not wired");
  }

  if (stage === "verify-inputs") {
    writeFileSync(
      join(attemptsDir, `${runId}-verify-inputs.json`),
      JSON.stringify(
        {
          runId,
          status: "VERIFIED",
          budgetSha256: sha256FileOrNull(budgetPath),
          ...identityEnvelope,
          host: {
            kernel: osRelease(),
            cpuCount: cpus().length,
            hardCgroupV2: cgroupInfo,
          },
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const tempLargeDir = mkdtempSync(join(tmpdir(), "dam-hopper-qual-large-"));
  try {
    const largeGen = generateCorpusTier(
      "large",
      tempLargeDir,
      canonicalBudget.fixtureSeed,
    );
    if (largeGen.corpusDigest !== fixtureManifest.tiers.large.corpusDigest) {
      throw new Error("Large corpus digest mismatch");
    }

    if (stage === "off-baseline") {
      const effectiveThreshold =
        candidateThreshold ??
        sourceIdentity.compiledProductionThresholdBytes ??
        65536;
      const rep = runCargoQualificationStage({
        stage: "off-baseline",
        mode: "portable",
        thresholdBytes: effectiveThreshold,
        sampling: canonicalBudget.sampling,
        largeDir: tempLargeDir,
        attemptFile: join(attemptsDir, `${runId}-off-baseline.json`),
        dev,
        identityEnvelope,
      });
      writeFileSync(
        join(outputDir, "latest-off-baseline.json"),
        JSON.stringify({ runId, ...rep }, null, 2) + "\n",
      );
      return;
    }

    if (stage === "exploratory") {
      const latestOffPath = join(outputDir, "latest-off-baseline.json");
      if (!existsSync(latestOffPath)) {
        throw new Error("Run --stage off-baseline before --stage exploratory");
      }
      const offBaseline = JSON.parse(readFileSync(latestOffPath, "utf8"));
      const requestedThresholds =
        candidateThreshold !== null
          ? [candidateThreshold]
          : canonicalBudget.candidateThresholdBytes;

      const candidates = [];
      const errors = [];
      for (const thresholdBytes of requestedThresholds) {
        const attemptFile = join(
          attemptsDir,
          `${runId}-exploratory-${thresholdBytes}.json`,
        );
        try {
          const rep = runCargoQualificationStage({
            stage: "exploratory",
            mode: "portable",
            thresholdBytes,
            sampling: {
              ...canonicalBudget.sampling,
              freshFinalRepetitions: 1,
              warmNavigationsPerWorkload: 20,
              coreSamplesPerEndpointPerCondition: 20,
            },
            largeDir: tempLargeDir,
            attemptFile,
            dev,
            identityEnvelope,
          });
          candidates.push({ thresholdBytes, ...rep });
          if (rep.status === "MEASURED") {
            writeFileSync(
              join(outputDir, `latest-exploratory-${thresholdBytes}.json`),
              JSON.stringify({ runId, thresholdBytes, ...rep }, null, 2) + "\n",
            );
          }
        } catch (err) {
          errors.push(err);
          if (existsSync(attemptFile)) {
            candidates.push({
              thresholdBytes,
              ...JSON.parse(readFileSync(attemptFile, "utf8")),
            });
          } else {
            candidates.push({
              thresholdBytes,
              status: "FAILED",
              ...identityEnvelope,
              error: err.message,
            });
          }
        }
      }

      const blocked = candidates.filter((c) => c.status !== "MEASURED");
      const summaryStatus =
        errors.length > 0
          ? "FAILED"
          : blocked.length > 0
            ? "PARTIAL_BLOCKED_ON_PRODUCTION_POLICY_OVERRIDE"
            : "MEASURED";
      const summaryPayload = {
        runId,
        status: summaryStatus,
        selectedCandidateThresholdBytes: candidateThreshold,
        offBaselineRunId: offBaseline.runId,
        ...identityEnvelope,
        candidates,
      };
      const summaryPath = join(
        attemptsDir,
        candidateThreshold !== null
          ? `${runId}-exploratory-${candidateThreshold}-summary.json`
          : `${runId}-exploratory-summary.json`,
      );
      writeFileSync(summaryPath, JSON.stringify(summaryPayload, null, 2) + "\n");
      if (errors.length > 0) {
        throw new Error(
          `Exploratory stage failed (${errors.map((e) => e.message).join("; ")}); preserved at ${summaryPath}`,
        );
      }
      if (blocked.length > 0) {
        throw new Error(
          `Exploratory candidates blocked (${blocked.map((b) => `${b.thresholdBytes}:${b.status}`).join(", ")}); preserved at ${summaryPath}`,
        );
      }
      return;
    }

    if (stage === "final") {
      if (
        !canonicalBudget.finalPolicy ||
        typeof canonicalBudget.finalPolicy.adaptiveSyncThresholdBytes !== "number"
      ) {
        throw new Error(
          `Refusing --stage final: finalPolicy in ${budgetPath} is null; Main must freeze finalPolicy after exploratory evidence`,
        );
      }
      const frozenThreshold =
        canonicalBudget.finalPolicy.adaptiveSyncThresholdBytes;
      if (
        candidateThreshold !== null &&
        candidateThreshold !== frozenThreshold
      ) {
        throw new Error(
          `--candidate-threshold ${candidateThreshold} does not match frozen finalPolicy.adaptiveSyncThresholdBytes ${frozenThreshold}`,
        );
      }
      const offBaseline = runCargoQualificationStage({
        stage: "off-baseline",
        mode: "portable",
        thresholdBytes: frozenThreshold,
        sampling: canonicalBudget.sampling,
        largeDir: tempLargeDir,
        attemptFile: join(attemptsDir, `${runId}-final-off-baseline.json`),
        dev,
        identityEnvelope,
      });
      const portableReport = runCargoQualificationStage({
        stage: "final",
        mode: "portable",
        thresholdBytes: frozenThreshold,
        sampling: canonicalBudget.sampling,
        largeDir: tempLargeDir,
        attemptFile: join(attemptsDir, `${runId}-final-portable.json`),
        dev,
        identityEnvelope,
      });
      const budgetEvaluation = evaluateRunAgainstCanonicalBudgets(
        portableReport,
        offBaseline,
        canonicalBudget.budgets,
      );
      const aggregatePath = join(attemptsDir, `${runId}-final-aggregate.json`);
      writeFileSync(
        aggregatePath,
        JSON.stringify(
          {
            runId,
            status: budgetEvaluation.passed ? "PASS_PORTABLE_ONLY" : "FAIL",
            ...identityEnvelope,
            host: {
              kernel: osRelease(),
              cpuCount: cpus().length,
              hardCgroupV2: cgroupInfo,
            },
            offBaseline,
            finalPolicy: canonicalBudget.finalPolicy,
            finalPortable: { ...portableReport, budgetEvaluation },
            finalHardCgroupV2:
              mode === "hard" || mode === "both"
                ? { status: "UNAVAILABLE_UNQUALIFIED", ...cgroupInfo }
                : { status: "NOT_SELECTED" },
          },
          null,
          2,
        ) + "\n",
      );
      if (!budgetEvaluation.passed) {
        throw new Error(
          `Final qualification FAILED (preserved at ${aggregatePath}): ${budgetEvaluation.failures.join("; ")}`,
        );
      }
    }
  } finally {
    rmSync(tempLargeDir, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

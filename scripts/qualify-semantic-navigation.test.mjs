import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRunAgainstCanonicalBudgets } from "./qualify-semantic-navigation.mjs";

const budgets = {
  coldReadyP95Ms: 15000,
  warmNavigationP95Ms: { small: 500, medium: 1500, large: 3000 },
  coreAndTerminalP95AbsoluteMs: 250,
  reapDeadlineMs: 6000,
  terminalDrops: 0,
  staleReveals: 0,
  unauthorizedOrOutsideTargetDisclosures: 0,
  orphanProcesses: 0,
  projectCodeCanaryExecutionsInDeniedRuns: 0,
};
const endpoints = ["health", "workspaceStatus", "fsList", "gitRoots", "ptyRoundTrip"];
const endpointSeries = (p95Ms) => Object.fromEntries(endpoints.map((name) => [name, { p95Ms }]));

function evidence() {
  return {
    baseline: { status: "MEASURED", coreAndTerminalP95Ms: 10, corePerEndpoint: endpointSeries(10) },
    loaded: {
      status: "MEASURED", coldReadyP95Ms: 15000, coreAndTerminalP95Ms: 60,
      reapDurationMaxMs: 6000, adaptiveSyncThresholdBytes: 65536,
      tiers: Object.fromEntries(["small", "medium", "large"].map((tier) => [tier, {
        warmNavP95Ms: budgets.warmNavigationP95Ms[tier], perEndpoint: endpointSeries(60),
        overlap: { barrierSynchronized: true, totalOverlapDurationMs: 100,
          observedNavigationsDuringCoreWindow: 2, observedCoreProbesDuringNavWindow: 2 },
      }])),
      resources: { peakTreeRssBytes: 100, p95TreeRssBytes: 100, totalCpuDeltaMs: 10,
        intervalCpuPctP95: 10, measuredScope: { scope: "test-child-tree" },
        perPhaseObservations: { startup: { liveSamples: 2 }, warm: { liveSamples: 2 }, browser: { liveSamples: 2 } },
        postCleanupZeroObservations: 1 },
      clientThresholdQualification: { status: "MEASURED", negotiatedThresholdBytes: 65536,
        totalWirePayloadBytes: 1000, fixedUnionStepCount: 21 },
      terminalDrops: 0, staleReveals: 0, unauthorizedOrOutsideTargetDisclosures: 0,
      orphanProcesses: 0, projectCodeCanaryExecutionsInDeniedRuns: 0,
      sessionPressureDiagnostics: {
        measuredScope: { inspectedActorHandles: "controlled actors", inspectedSessionCount: 1,
          browserWsSessions: null },
        maxPerSessionPeaks: { inFlightRequests: 1, commandQueueSlots: 1,
          childOutboundQueueSlots: 1, childOutboundBytes: 100, openDocuments: 1, overlayBytes: 100 },
        postReapCleanup: { allClean: true, reapedSessionCount: 1, maxResidualOverlayBytes: 0,
          maxResidualOpenDocuments: 0, maxResidualInFlightRequests: 0,
          maxResidualCommandQueueSlots: 0, maxResidualChildOutboundQueueSlots: 0,
          maxResidualChildOutboundBytes: 0 },
        lifetimeTotals: { spawnAttempts: 1, successfulSpawns: 1, restartAttempts: 0, successfulRestarts: 0 },
        unexpectedErrorCounters: { navigationTimeouts: 0, navigationCancellations: 0,
          navigationOverloads: 0, staleResults: 0 },
      },
    },
  };
}

function verdict(loaded, baseline) {
  return evaluateRunAgainstCanonicalBudgets(loaded, baseline, budgets).passed;
}

test("accepts complete observations at inclusive absolute and relative boundaries", () => {
  const { loaded, baseline } = evidence();
  assert.equal(verdict(loaded, baseline), true);
  loaded.tiers.small.perEndpoint.health.p95Ms += 0.01;
  assert.equal(verdict(loaded, baseline), false);
});

for (const [name, mutate] of [
  ["missing pressure observations", (r) => { r.sessionPressureDiagnostics = null; }],
  ["missing browser resource samples", (r) => { r.resources.perPhaseObservations.browser.liveSamples = 0; }],
  ["missing physical zero observation", (r) => { r.resources.postCleanupZeroObservations = 0; }],
  ["nonfinite tier latency", (r) => { r.tiers.medium.warmNavP95Ms = NaN; }],
  ["one tier without real overlap", (r) => { r.tiers.large.overlap.observedCoreProbesDuringNavWindow = 0; }],
  ["residual storage despite clean flag", (r) => { r.sessionPressureDiagnostics.postReapCleanup.maxResidualOverlayBytes = 1; }],
  ["missing reap observation", (r) => { delete r.sessionPressureDiagnostics.postReapCleanup.reapedSessionCount; }],
  ["restart attempt hidden by recovered latency", (r) => { r.sessionPressureDiagnostics.lifetimeTotals.restartAttempts = 1; }],
  ["successful restart hidden by inconsistent count", (r) => { r.sessionPressureDiagnostics.lifetimeTotals.successfulRestarts = 1; }],
  ["navigation timeout", (r) => { r.sessionPressureDiagnostics.unexpectedErrorCounters.navigationTimeouts = 1; }],
  ["fabricated browser pressure zero", (r) => { r.sessionPressureDiagnostics.measuredScope.browserWsSessions = 0; }],
  ["omitted browser pressure scope", (r) => { delete r.sessionPressureDiagnostics.measuredScope.browserWsSessions; }],
  ["actual stale reveal", (r) => { r.staleReveals = 1; }],
]) {
  test(`rejects ${name}`, () => {
    const { loaded, baseline } = evidence();
    mutate(loaded);
    assert.equal(verdict(loaded, baseline), false);
  });
}

# Phase 00 — baseline and contract fixtures

## Context links
- [Plan](plan.md) · [frozen architecture](../../docs/architecture/host-resource-sse.md) · [overload analysis](research/host-overload-analysis.md) · [collector evidence](research/local-collector-profile.md) · [baseline test report](../reports/tester-260930-1615-phase-00-host-resource-sse-baseline.md) · [Cycle 2 review](../reports/code-review-260930-1634-phase-00-baseline-and-fixtures-cycle-2.md).
- Current source: `server/src/system/monitor.rs`, `server/src/system/config.rs`, `server/src/api/system.rs`, `server/src/system.rs`, `server/examples/host_resource_profile.rs`, `scripts/profile-host-resource-deep-scan.sh`.

## Overview
- Date: 2026-09-30; priority: P2; implementation: **complete (100%)** for Phase 00 fixtures and baseline tooling; review: **complete**. Existing REST behavior and profiler tooling are verified; named reference/weak-host qualification remains a Phase 05 gate.
- Establish reproducible **existing** monitor/REST behavior and reusable, safe combined-pair fixtures before implementing publisher (01) and client transport (03). 01 and 03 may proceed in parallel only after 00; neither writes the other's files.

## Key Insights
- `HostResourceMonitor::new` synchronously constructs and samples `HostMetricsSampler`; one started monitor runs independently of readers. `run` has deep+legacy sampling and two `update` branches; `snapshot()` applies independent wall-time stale marking; `legacy_metrics()` clones cache. No SSE exists yet.
- Prior `bash scripts/profile-host-resource-deep-scan.sh 10 ...` produced 47.075 ms mean/48.262 ms peak CPU, 7,505 B peak deep-only JSON, 518 PIDs, and zero deadlines. This is collector-only evidence: it excludes monitor construction/legacy sampling, server lifecycle, auth, sockets, UI, and whole-monitor cost. The new profiler measures synchronous real-monitor construction (including initial legacy sampling) and process CPU/RSS while its monitor runs, but has no per-stage counters; its timer excludes runtime/host discovery, report serialization, and shutdown. Its short local smoke below validates the tool, not cross-host or SSE performance.
- Clamped defaults: light 5 s, processes 15 s, PSS 60 s, jitter ≤250 ms default, cooperative process deadline 150 ms, deep wait 500 ms. A blocked syscall and `sample_legacy` are not CPU/deadline bounded. Existing config is authoritative where older architecture prose says 100 ms.

## Requirements
- Keep existing REST snapshot, legacy metrics, REST alert history, and WS alerts unchanged. Baseline evidence covers the three REST projections and monitor stale marking; it does not newly verify WS behavior or make sample timestamps proof of observation freshness.
- Provide reusable V1 snapshot + legacy-metrics examples for healthy and degraded states, including current alerts and deadline-exceeded process data. Fixture values are synthetic and avoid credentials, host actions, and production DB access; metrics initialization still samples local host/mount state before overwriting fields with fixed values (see risk).
- Provide a repeatable whole-monitor N=0 measurement path for named reference/weak hosts before making target-specific performance conclusions. Phase 00 delivers the profiler and local smoke only; host selection is unresolved, so named-host N=0 and client-count qualification remain pending for Phase 05. Uninstrumented stage/cadence counts stay null plus reason.
- Do **not** write tests expecting an SSE route/schema before the implementation phases; no failing-ahead tests and no config/sampler rewrite.

## Architecture
- Baseline tests use in-process router requests, a controllable `HostResourceSource` clock, and bounded temp workspaces; fixtures construct actual public V1 snapshot and legacy-metrics types. `representative_pair()` and `degraded_pair()` cover healthy/degraded values. Both call `HostMetricsSampler::new().sample(&std::env::temp_dir())` to seed legacy metrics because integration tests cannot set every field directly; the sampler probes local host/mount state before every metrics field is overwritten with deterministic fixture data. REST-test `create_test_state()` also constructs `HostResourceMonitor::system`, which synchronously samples legacy metrics. Neither path is fully offline, and either can stall on unresponsive mounts.
- The Linux wrapper interface is `--workspace PATH --warmup-seconds N --duration-seconds N --output PATH`; workspace/output are required, warmup defaults to **60** and accepts zero or a positive integer, and duration defaults to **300** and must be positive. The wrapper release-builds the example with `--features vendored` before the timed child, forwards these flags, and uses GNU `timeout -s TERM -k 5s "${warmup+duration+30}s"`. On child failure it writes a `status:"blocked"` report with reason/incomplete fields and returns nonzero. TERM then 5 s KILL bounds the termination attempt, not successful teardown: Linux uninterruptible I/O can delay even SIGKILL until the syscall returns. Surviving PIDs are reported as blocked.
- A complete report uses `schemaVersion:1`, `status:"complete"`, `reason:null`, and `host:{hostname,kernel,os,arch,cpuCores,workspace}`, `config:{lightSampleMs,processSampleMs,pssSampleMs,processDeadlineMs,snapshotWaitMs,jitterMs}`, `timing:{warmupSeconds,durationSeconds,startupWallMs,steadyWallMs}`, `startup:{cpuMs,rssBytes}`, `steady:{cpuMs,cpuPercentOneCore,rssStartBytes,rssEndBytes,rssPeakBytes}`, and `counts:{lightTicks,deepInvocations,deepCompletions,deepDeadlines,legacyInvocations,legacyCompletions,processInvocations,pssInvocations}`. Each complete-report count is `{value:nonnegative integer|null,reason:null|string}`; unavailable counts are null with `uninstrumentedInProductionMonitor`, not zero. Blocked reports retain status/reason/host and set config/timing/startup/steady/counts to null. `cpuPercentOneCore = 100 * steady.cpuMs / steadyWallMs`; `rssPeakBytes` is the process high-water mark, not a steady-only sample.

## Related code files
| Action | Repo-relative path | Purpose |
|---|---|---|
| Read only | `server/src/system/monitor.rs` | Current monitor lifecycle, REST projections and dual commit paths; phase 01 owns edits. |
| Read only | `server/src/system/config.rs` | Existing clamped server cadence and deadlines. |
| Read only | `server/src/api/system.rs` | Existing REST handlers. |
| Read only | `server/examples/host_resource_profile.rs` | Collector-only instrumentation scope. |
| Read only | `scripts/profile-host-resource-deep-scan.sh` | Existing collector-only command. |
| Added | `server/tests/common/host_resource_fixtures.rs` | Shared representative and degraded existing-schema values. |
| Updated | `server/tests/common/mod.rs` | Registers the fixture module. |
| Added | `server/tests/host_resource_baseline.rs` | Fixture, REST, stale-marking, and profiler-shape baseline tests. |
| Added | `server/examples/host_resource_monitor_profile.rs` | Isolated real-monitor startup and steady process CPU/RSS observer. |
| Added | `scripts/profile-host-resource-monitor.sh` | Opt-in Linux wrapper for the whole-monitor observer. |

## Implementation Steps
1. **B00-A — baseline fixtures and tests (complete):** Added `representative_pair()` and `degraded_pair()` to the shared test module. Seven tests cover the fixture contracts, three existing REST handlers, monitor stale marking, and a manually assembled profiler-schema shape. That shape test does not run the executable; the separate profiler smoke below verifies actual output.
2. **B00-B — real-monitor observer (complete):** Added the Linux profiler and wrapper. The profiler measures a real `HostResourceMonitor`, separates synchronous construction from steady-state process CPU/RSS, records effective config and host metadata, and reports uninstrumented stage counts as null with reasons. The wrapper builds before the timed child and emits blocked/nonzero results on failures; no production monitor counters were added.
3. **B00-I — integration (complete):** Focused/full server suites, profiler smoke, and code review are recorded below. No SSE route/schema assertion or production sampler change was introduced. Transfer the shortfall in named-host performance evidence to Phase 05 rather than infer it from collector-only scans.

## Todo list
- [x] B00-A — representative/degraded existing-schema fixtures and current REST/monitor regressions.
- [x] B00-B — actual whole-monitor opt-in baseline observer and host metadata capture.
- [x] B00-I — single integrator reviews, verifies and hands off unchanged contract.

## Success Criteria
- Focused baseline suite passed 7 tests; full server suite passed 1,709 with 5 ignored (results below). REST route tests use in-process requests. The short local profiler run validates the tool; the 60 s/300 s N=0 run on named reference and weak hosts remains a Phase 05 qualification gate.
- Baseline checks cover `/api/system/resources/v1/snapshot`, `/api/system/metrics`, and `/api/system/resources/v1/alerts`; no SSE route/schema is expected in Phase 00.
- The profiler records startup/steady process CPU and RSS, host metadata, and effective configuration. It cannot observe per-stage invocation counts/cadence without production instrumentation; do not assert those counts or infer whole-monitor cost from ten deep-only scans.

### Observed Smoke Run Evidence
- Bounded profiler smoke run: `bash scripts/profile-host-resource-monitor.sh --workspace /tmp/dam-hopper-baseline-smoke --warmup-seconds 1 --duration-seconds 2 --output /tmp/dam-hopper-baseline-smoke/profile-report.json`.
- Exit status: 0 (`status: "complete"`, `reason: null`).
- Host: `localhost.localdomain` (Fedora Linux, kernel 7.1.10-200.fc44.x86_64, 16 cores, x86_64).
- Timing: `startupWallMs: 131.9ms`, `steadyWallMs: 2001.4ms`.
- Startup cost: `cpuMs: 127.2ms`, `rssBytes: 23,543,808` (~22.45 MiB).
- Steady cost: `cpuMs: 0.27ms` (`cpuPercentOneCore: 0.013%`), `rssEndBytes: 24,121,344`, `rssPeakBytes: 24,121,344`.
- Uninstrumented stage counts verified null with explicit `uninstrumentedInProductionMonitor` reason.

### Acceptance Validation Suite Results
- Baseline suite: `cargo test --manifest-path server/Cargo.toml --test host_resource_baseline` — 7 passed, 0 failed, 0 ignored (0.74s).
- Server full regression suite: `cargo test --manifest-path server/Cargo.toml` — 1,709 passed, 0 failed, 5 ignored across 62 test groups; 100% pass rate.
- REST smoke reported HTTP 200 for all three routes. The focused tests assert snapshot `schemaVersion: 1`, expected legacy metrics fields, and a JSON array for alert history.

## Risk Assessment
- Fixture metrics use `HostMetricsSampler::new().sample(temp_dir)` before replacing every field with deterministic fixture values; `create_test_state()` also constructs a monitor that synchronously samples the local host. Disk/mount refresh can delay fixture or route setup on hosts with unresponsive remote mounts. Cycle 2 review recommends a pure public legacy-metrics constructor in Phase 01; that remains deferred to avoid a Phase 00 production sampler change.
- Startup `System::new_all`, legacy disk refresh, and blocking `statvfs` can dominate. Profiler metadata/runtime initialization is outside the startup timer; uninterruptible I/O may also outlive the wrapper's TERM/KILL attempt. Ten deep scans are not default-cadence whole-monitor measurements.
- The recorded short smoke is one local Fedora host and does not establish reference/weak-host behavior. Keep named-host measurement as a Phase 05 gate.

## Security Considerations
- Fixtures use synthetic identity/process examples and no production DB or credentials, but legacy sampler seeding probes local host/mount state. The profiler records hostname and canonical workspace path; redact reports before sharing. No real host actions or production configuration changes.

## Next steps
- Phases 01 (backend publisher) and 03 (browser parser/coordinator) may start in parallel using the frozen architecture contract; 02 waits on 01, 04 waits on 02+03. Phase 05 performs the named-host N=0 baseline, 30-minute soak, and production-proxy qualification.

## Unresolved questions
- Which reference and weaker Linux hosts should be named for Phase 05, and which isolated workspace is suitable for their recorded baseline? The localhost smoke is tool validation, not a substitute; carry missing host/instrumentation evidence as a qualification gate.

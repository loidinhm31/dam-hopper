# Phase 00 — baseline and contract fixtures

## Context links
- [Plan](plan.md) · [frozen architecture](../../docs/architecture/host-resource-sse.md) · [overload analysis](research/host-overload-analysis.md) · [collector evidence](research/local-collector-profile.md).
- Current source: `server/src/system/monitor.rs`, `server/src/system/config.rs`, `server/src/api/system.rs`, `server/src/system.rs`, `server/examples/host_resource_profile.rs`, `scripts/profile-host-resource-deep-scan.sh`.

## Overview
- Date: 2026-09-29; priority: P2; implementation: **pending (0%)**; review: **pending**. Planning only; no gates run.
- Establish reproducible **existing** monitor/REST behavior and reusable, safe combined-pair fixtures before implementing publisher (01) and client transport (03). 01 and 03 may proceed in parallel only after 00; neither writes the other's files.

## Key Insights
- `HostResourceMonitor::new` synchronously constructs and samples `HostMetricsSampler`; one started monitor runs independently of readers. `run` has deep+legacy sampling and two `update` branches; `snapshot()` applies independent wall-time stale marking; `legacy_metrics()` clones cache. No SSE exists yet.
- Existing `bash scripts/profile-host-resource-deep-scan.sh 10 /home/loidinh/WS/dam-hopper` produced 47.075 ms mean/48.262 ms peak CPU, 7,505 B peak **deep-only** JSON, 518 PIDs, zero deadlines. The example stops its CPU clock before JSON and excludes legacy, server lifecycle, auth, sockets and UI. These are historical observations, **not** SSE or whole-monitor proof; do not rerun simply to confirm.
- Clamped defaults: light 5 s, processes 15 s, PSS 60 s, jitter ≤250 ms default, cooperative process deadline 150 ms, deep wait 500 ms. A blocked syscall and `sample_legacy` are not CPU/deadline bounded. Existing config is authoritative where older architecture prose says 100 ms.

## Requirements
- Protect existing snapshot/metrics/alerts REST contracts and WS alerts; document baseline availability and existing degraded behavior without asserting its timestamps prove observation freshness.
- Provide isolated deterministic representative `HostResourceSnapshotV1` + `HostMetrics` fixture including current alerts, cadence-skipped/degraded process data and bounded large process/alert values; no credentials, host actions, production DB, or real mount hazards.
- Baseline instrument **actual monitor** initial legacy construction plus default light/deep process/PSS/legacy cadence and alert transitions on named reference and weaker host; separately distinguish collector-only evidence, whole-monitor CPU, wall wait, revisionless pre-feature behavior. The 30-minute capacity soak belongs to 05, not this phase.
- Do **not** write tests expecting an SSE route/schema before the implementation phases; no failing-ahead tests and no config/sampler rewrite.

## Architecture
- Baseline test consumes existing monitor APIs or isolated `HostResourceSource` fake and bounded temp workspace; fixtures use real V1/legacy types. Profiler starts **one real `HostResourceMonitor`**, times synchronous `new()`/initial legacy work separately, then default-cadence warmup and steady process CPU/RSS; no replacement repeated deep scan. `HostResourceSource` exposes roots/time/free-bytes, **not** deep/legacy invocation counts; no whole-monitor or stage-count inference from ten collector scans. Reuse equivalent conditions at N=0 in 05; do not mutate host settings or point disposable fixtures at production mounts.
- Freeze example and Linux wrapper interface: `--workspace PATH --warmup-seconds N --duration-seconds N --output PATH`; workspace/output required, warmup defaults **60** and duration defaults **300**, both positive integer seconds (explicit overrides accepted). Wrapper release-builds `server/examples/host_resource_monitor_profile.rs` **before** timed child, forwards exact flags and uses GNU `timeout -s TERM -k 5s "${warmup+duration+30}s"` for child run; on timeout/blocked collector or failed child, write `status:"blocked"` with reason/incomplete fields and return nonzero. TERM then 5 s KILL bounds the termination attempt, not successful teardown: Linux uninterruptible I/O may delay even SIGKILL until the syscall returns. Report any surviving PID as blocked; never automatically spawn another observer over the stalled one. Output is a single redacted JSON object (write atomically) with explicit integer milliseconds/bytes and null+reason for unsupported values; no false zero counts.
- JSON schema (`schemaVersion:1`): `status:"complete"|"blocked"`, `reason:null|string`, `host:{hostname,kernel,os,arch,cpuCores,workspace}`, `config:{lightSampleMs,processSampleMs,pssSampleMs,processDeadlineMs,snapshotWaitMs,jitterMs}`, `timing:{warmupSeconds,durationSeconds,startupWallMs,steadyWallMs}`, `startup:{cpuMs,rssBytes}`, `steady:{cpuMs,cpuPercentOneCore,rssStartBytes,rssEndBytes,rssPeakBytes}`, `counts:{lightTicks,deepInvocations,deepCompletions,deepDeadlines,legacyInvocations,legacyCompletions,processInvocations,pssInvocations}`. Every counts leaf is `{value: nonnegative integer|null,reason:null|string}`; unsupported/unsampled uses `null` plus reason, not zero. `cpuPercentOneCore = 100 * steady.cpuMs / steadyWallMs`; record observed cadence only if counted from actual monitor hooks, else null with reason. The fixture/source API does not expose all stage counters; B00-B must report these unavailable rather than touch monitor.rs (phase 01 owner). `status:"complete"` describes timed process observation, **not** proof unavailable counters passed qualification.

## Related code files
| Action | Repo-relative path | Purpose |
|---|---|---|
| Read only | `server/src/system/monitor.rs` | Current monitor lifecycle, REST projections and dual commit paths; phase 01 owns edits. |
| Read only | `server/src/system/config.rs` | Existing clamped server cadence and deadlines. |
| Read only | `server/src/api/system.rs` | Existing REST handlers. |
| Read only | `server/examples/host_resource_profile.rs` | Collector-only instrumentation scope. |
| Read only | `scripts/profile-host-resource-deep-scan.sh` | Existing collector-only command. |
| New create | `server/tests/common/host_resource_fixtures.rs` | Shared representative **existing-schema** test values. |
| Modify | `server/tests/common/mod.rs` | Register fixture module. |
| New create | `server/tests/host_resource_baseline.rs` | Consumer-visible current snapshot/metrics behavior baseline tests. |
| New create | `server/examples/host_resource_monitor_profile.rs` | Isolated actual-monitor CPU/cadence observer, not production worker. |
| New create | `scripts/profile-host-resource-monitor.sh` | Opt-in Linux wrapper for whole-monitor observer; names host/workspace/output. |

## Implementation Steps
1. **B00-A — baseline fixtures (owner: fixture worker; ≤3 paths):** `server/tests/common/host_resource_fixtures.rs` (new), `server/tests/common/mod.rs` (modify), `server/tests/host_resource_baseline.rs` (new). Input existing `HostResourceSnapshotV1::unavailable` and `HostMetrics` from `server/src/system.rs`; output `pub fn representative_pair() -> (HostResourceSnapshotV1, HostMetrics)` and `pub fn degraded_pair() -> (HostResourceSnapshotV1, HostMetrics)` in test-only common module. Construct actual public fields with deterministic timestamps/current alerts and explicit availability; avoid external DB. Tests should exercise separately existing REST snapshot and metrics outputs and actual monitor degraded/retained section semantics, not snapshot-to-fixture JSON copy assertions, default values, or SSE route. Acceptance: existing behavior passes; degraded process data remains degraded and current alerts survive paired cache reads. Non-goal: introducing revision or claiming exact PSS observation times. Handoff: fixture APIs for 01/02 tests; integrator reviews realistic bounded arrays.
2. **B00-B — real monitor baseline observer (owner: profiler worker; ≤2 paths):** `server/examples/host_resource_monitor_profile.rs` (new), `scripts/profile-host-resource-monitor.sh` (new). Implement frozen CLI/JSON above with real monitor, startup vs steady process CPU, wall and RSS, exact effective config and named host. Instrument no production monitor fields; unobtainable stage counts and observed cadence are null with reason. Wrapper validates inputs, builds before timer, attempts TERM at warmup+duration+30 s and KILL 5 s later, emits blocked incomplete JSON/nonzero on stalled collector, and reports rather than duplicates any uninterruptible survivor; never report 10 deep scans as whole-monitor cost.
3. **B00-I — integrator, after A+B:** review fixture fidelity and source-to-report accounting. If cadence instrumentation cannot be implemented without touching production monitor, report that explicit limitation to 05; do not invent counters. Workers: **edit only; skip gates, builds, tests, formatters**; integrator runs scoped gates after all packets land and retains baseline artifacts without secrets.

## Todo list
- [ ] B00-A — representative/degraded existing-schema fixtures and current REST/monitor regressions.
- [ ] B00-B — actual whole-monitor opt-in baseline observer and reference-host metadata.
- [ ] B00-I — single integrator reviews, verifies and hands off unchanged contract.

## Success Criteria
- After implementation, integrator runs `cargo test --manifest-path server/Cargo.toml --test host_resource_baseline` then `cargo test --manifest-path server/Cargo.toml`; optional collector-only repeat: `bash scripts/profile-host-resource-deep-scan.sh 10 <isolated-workspace>`. Whole-monitor N=0 run: `bash scripts/profile-host-resource-monitor.sh --workspace <isolated-workspace> --warmup-seconds 60 --duration-seconds 300 --output <redacted-report.json>`; record exit status/schema and reject `blocked` or unsupported counters for any asserted count. These new files/commands are **planned, not yet available**.
- Live pre-feature smoke: run `cargo run --manifest-path server/Cargo.toml --bin dam-hopper-server -- --host 127.0.0.1 --port 4803 --no-auth` with safe disposable config, then `curl --fail-with-body http://127.0.0.1:4803/api/system/resources/v1/snapshot` and `/api/system/metrics`; observe full snapshot and metrics returned, alert history separately unchanged. No SSE assertion in phase 00.
- Report startup and steady process CPU, configured vs actually observed counts only where instrumented, RSS and host/CPU metadata; explicit null+reason for unavailable deep/legacy stage counts. Reference conditions feed 05's identical CLI and 0/1/4/16/32 live measurements, not a whole-monitor assertion from deep-only samples.

## Risk Assessment
- Startup `System::new_all`, legacy disk refresh and blocking `statvfs` can dominate; isolate workspace and separate startup from steady state. Ten full deep scans are not default-cadence whole-monitor measurements. Fake sources may fail to represent weak-host I/O; log limitations.

## Security Considerations
- No real host actions, secrets or production DB in fixtures; loopback-only/no-auth baseline allowed only in isolated dev configuration. Never leak process paths or tokens into recorded reports.

## Next steps
- 01 (backend publisher) and 03 (browser parser/coordinator) can start in parallel after B00-I using frozen architecture as interface; 02 waits on 01, 04 waits on 02+03. Phase 05 performs measured 30-minute soak and production proxy qualification.

## Unresolved questions
- Which representative reference/weak hosts and disposable workspace should be used for recorded baseline? Record actual host selection and missing instrumentation as qualification gates, not substituted estimates.

---
title: "Idle-suspend diagnostics and deployment conflict repair"
description: "Preserve typed probe failures, expose safe diagnostics, retire conflicting services, and provision runtime IPC before sandbox startup."
status: completed
priority: P1
effort: 26h
branch: main
tags: [bugfix, backend, api, frontend, infra, security]
created: 2026-10-12
---

# Idle-suspend diagnostics and deployment conflict repair

## Evidence and objective
- [Debugger report](../reports/debugger-261012-0613-idle-suspend-capability.md): obsolete runner repeatedly reapplies legacy runtime group; API directory traversal denied while helper listener exists. `Path::exists()` masks `EACCES`; Boolean executor/coordinator seam misreports hardware absence. Cold boot also shows `226/NAMESPACE` before `ExecStartPre`.
- [Research report](../reports/researcher-261012-0613-idle-suspend-diagnostics.md): taxonomy, safe status, IPC compatibility constraints, service retirement and boot provisioning.
- Source checked: strict helper IPC v1, three executor implementations, manual probe deadline, both status publishers, strict UI decoder, release activation/rollback, retirement harness. Reports' design suggestions are not implemented facts.
- Done: IPC/access, hardware, readiness and timeout failures remain distinguishable through server tracing, sanitized HTTP 503 and latest-probe status; conflicting producer cannot return; helper runtime exists before namespace setup.

## Phases
| # | Phase | Status | Effort | Dependency |
|---|---|---|---|---|
| 01 | [Typed capability taxonomy and socket IPC](./phase-01-typed-capability-probe-and-socket-ipc.md) | Complete | 6h | None |
| 02 | [Coordinator diagnostics and tracing](./phase-02-coordinator-diagnostics-and-server-tracing.md) | Complete | 5h | 01 |
| 03 | [Safe status and UI extension](./phase-03-safe-status-schema-and-ui-client-extension.md) | Complete | 4h | 01, 02 |
| 04 | [Service retirement and runtime tmpfiles](./phase-04-deployment-service-retirement-and-runtime-tmpfiles.md) | Complete | 6h | Independent implementation; integrate before 05 |
| 05 | [Coverage and regression qualification](./phase-05-test-coverage-and-regression-qualification.md) | Complete | 5h | 01–04 |

## Frozen design contracts
1. Requirement 48: only closed codes/static messages cross HTTP/status/UI boundaries. Standard errors stay `{ "error": ..., "code": ... }`, `Cache-Control: no-store`. No paths, identities, PIDs, raw errno/stderr, credentials or unbounded helper detail. Keep bounded operator evidence on controlled server/helper logs; never log tokens, environment, argv or terminal content.
2. HTTP 503: `idleSuspendHelperUnavailable` for IPC/access/auth/probe execution/unknown; `idleSuspendInhibited` for sleep-block inhibitors; `idleSuspendProbeTimeout` for deadline; `idleSuspendCapabilityUnavailable` only proven suspend-state/RTC absence. Add distinct `idleSuspendRtcBusy` for foreign alarm. HTTP 409 remains fleet/session/handoff conflict, never a probe blocker.
3. Typed result = closed reason + dimension (transport/IPC, hardware, transient readiness) + separate internal diagnostic context. Direct Unix connect/read; no Boolean metadata gate or parsing OS error strings. No retries, permission widening or force bypass.
4. Explicit helper IPC **v2** clean cutover: typed failure/correlation fields, strict frame validation, 4096-byte bound retained. Server/helper ship together; mismatch fails closed as helper-unavailable. No v1 adapter, detail-prefix protocol or relaxed unknown-field checks. Public HTTP/status remain v1, backward-compatible additive fields.
5. `probeReasonCode` is a closed safe reason, not raw helper text; `probeCheckedAtMs` is latest completed probe time. Unchecked = absent/null pair; success = `supported` + timestamp; failure = concrete reason + timestamp. `capabilityCode` remains startup selection, not measured health. Same-reason timestamp refresh does not increment status revision or broadcast an invalidation.
6. Preserve admission order, fleet generation fences, peer UID/PID checks, durable execution audit and automatic policies. Preserve current RTC preflight for **all** sleep, including wake=0; operation-specific RTC relaxation is separate scope. Virtualization is context, never an automatic verdict or provider API fallback.
7. One runtime owner: canonical tmpfiles `root:<rendered API_GROUP>,3770`; socket `0660` with intended group. Stop obsolete producer before repair. No `0777`, obsolete supplementary group, recursive ownership repair, new socket activation or shared `RuntimeDirectory=` ownership.

## Integration and rollout
- Implement dependent phases in order; 04 may land independently under one integration owner. Move affected tests/fixtures with interface changes; 05 completes coverage. Do not leave interim Boolean shims or incompatible callers.
- Architecture design review uses current [system architecture](../../docs/system-architecture.md), security and release-runtime contracts. Proposed changes are specified here and in phases; update published architecture/docs with the implementation, clearly distinguish planned from qualified behavior.
- Verification commands in phases are **planned**, not executed by this planning assignment. Run focused gates after integrated changes, then one full Rust/UI/deploy qualification gate; zero failures required. Ignored live-host gates remain explicitly separate.
- Ship matched server/helper binaries and both service templates; rehearse rooted activation and rollback, then authorized maintenance/cold boot. Rollback must restore matching binaries, canonical tmpfiles/config/link and provisioning order together; never resurrect obsolete runner. No live force-suspend/RTC writes/reboot from this planning task.
- Non-goals: cloud lifecycle backend, wake=0 contract changes, retry layer, new diagnostics subsystem, authentication relaxation, unrelated plugin-data deletion, package version bump.

## Deliverable/acceptance boundary
- Exact edits, snippets, invariants, test matrices and commands: five phase files. Documentation/changelog updates: phase 05.
- Green suite means all executed required checks pass, existing ignores unchanged, no weakened assertions or fabricated hardware qualification. Privileged cold-boot evidence required before deployment fix called operationally qualified.

## Unresolved questions
- No unresolved design choice. Remaining operational prerequisite: authorized disposable systemd host/VM and maintenance/reboot window for cold-boot and rollback qualification; incident report did not validate RTC writes or real wake reliability.

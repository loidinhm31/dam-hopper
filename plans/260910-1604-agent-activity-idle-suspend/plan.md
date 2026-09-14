---
title: "Configured-agent activity idle-suspend enhancement"
description: "Add an opt-in automatic suspend policy using managed agent identity, raw PTY output and attributable TCP byte activity."
status: complete
priority: P2
effort: 111h
branch: feat/terminal-idle-suspend
tags: [feature, backend, frontend, api, experimental]
created: 2026-09-10
---

# Configured-agent activity idle suspend

## Objective

In opt-in `agent-activity` mode, configured agents (`codex`, `omp`, `claude`, `agy`, extensible) keep the host awake while producing raw PTY output or attributable TCP traffic. Accepted input anywhere resets quiet time. Quiet agents and ordinary service-only PTYs may remain alive when automatic suspend claims. Existing `empty-fleet` remains the default; manual force confirmation and actual fleet counts remain authoritative.

**This is an activity heuristic, not proof of completed work.** Silent API waits/compute/retries can be suspended; mixed agent/service noise can prevent sleep. Unknown observation blocks automatic handoff. No hooks, CPU detector, API proxy, eBPF/cgroups or service classifier.

## Read first

1. [Integrated design contract](design-contract.md): configuration, identity, timing, epochs, admission and the authenticated warning DTO. All phase files incorporate validation directly.
2. [Repository findings](research/repository-findings.md): source evidence versus proposed behavior and prior local TCP experiment.
3. Assigned phase and dependencies below. Paths in phase ownership lists are repository-root-relative; proposed files are explicitly identified.

## Implementation phases

| Phase                                                                 | Status  | Progress | Estimate | Dependency                         |
| --------------------------------------------------------------------- | ------- | -------- | -------- | ---------------------------------- |
| [01 — Policy/configuration contracts](phase-01-policy-contracts.md)   | DONE (2026-09-11) | 100%      | 6h       | None                               |
| [02 — PTY evidence and input admission](phase-02-pty-observation.md)  | DONE (2026-09-11) | 100%      | 8h       | 01                                 |
| [03 — Process discovery and retention](phase-03-process-discovery.md) | DONE (2026-09-11) | 100%      | 14h      | 01–02                              |
| [04 — Owned TCP byte observation](phase-04-tcp-observation.md)        | DONE (2026-09-11) | 100%      | 14h      | 01–02 + frozen 03 input types      |
| [05 — Sampler/coordinator admission](phase-05-sampler-coordinator.md) | DONE (2026-09-11) | 100%      | 20h      | 02–04                              |
| [06 — Protected status and UI](phase-06-api-ui.md)                    | DONE (2026-09-11) | 100%      | 10h       | Frozen DTO; runtime proof after 05 |
| [07 — Integrated qualification](phase-07-verification.md)             | DONE (2026-09-11) | 100%      | 26h      | 01–06                              |
| [08 — Docs and opt-in rollout](phase-08-docs-rollout.md)              | DONE (2026-09-11) | 100%     | 13h      | 07 proof                           |

## Execution and ownership

- Phase03/04 implement concurrently after shared typed socket-ownership inputs are frozen. Phase03 owns `activity/mod.rs`; Phase04 supplies declarations without editing that file concurrently. Phase05 takes module ownership after integration.
- Phase02 owns `pty/manager.rs` evidence changes, then Phase05 owns final claim integration. Phase05 owns backend `status.rs` and all DTO constructors; Phase06 owns client/display and API exposure regressions.
- Phase06 client/view work may overlap Phase05; no claim of integrated behavior until both are complete. One integration owner runs formatting and gates after parallel edits settle.
- No partial collector, zero-on-error fallback or forced automatic-claim bypass may be shipped. Each phase supplies exact future verification and next-gate criteria.

## Acceptance and rollout gates

- Prove agent output/child TCP traffic/input resets quiet; unchanged pooled sockets and service-only output/listeners do not.
- Prove incarnation/PID/socket reuse, unknown/stale samples, timing/manual/input races, restore/resume and spent-epoch behavior with deterministic seams and real local PTYs/sockets.
- Prove protected status/browser warnings include reason, blocked duration and attributable PID/safe executable identity; exclude arguments, credentials and socket details. Preserve unknowns, real fleet counts and force confirmation.
- Run actual Cargo/pnpm gates in Phase07. Automated execution uses fake suspend outcomes: never RTC programming, real suspend, root installation or external model API calls.
- Qualify deployment permissions/kernel support before operator opt-in. Unsupported required measurement stays unavailable. Rollback is startup selection of `empty-fleet` or disabling automation, then restart.

## Planning delivery

All phases (01 through 08) are complete (8/8 phases complete; 111/111h; DONE 2026-09-11). Phase 02 delivered qualified PTY root identity, incarnation-scoped raw output evidence, accepted-input admission fencing, handoff rejection, and bounded private snapshots. Phase 03 delivered bounded process discovery, strict configured-agent attribution, retained detached lineage, deterministic socket ownership, and bounded private process evidence. Phase 04 delivered direct unprivileged NETLINK_SOCK_DIAG TCP4/TCP6 byte observation, bounded multipart parsing, cookie/family/namespace identity, per-socket deltas, transactional prepare/commit, fail-closed transport/namespace/diagnostic handling, and privacy-safe socket diagnostics. Phase 05 delivered dedicated joinable sampler, manager-locked admission, and public v1 activity status. Phase 06 delivered strict client decoding, status UI, and warning presentation. Phase 07 qualified all components with 323 tests and live Linux smoke. Phase 08 completed documentation, operations runbooks, rollout stages, and rollback procedures.

Phase 02 evidence: focused PTY activity tests passed **8/8**; the PTY module suite passed **159 tests** with one pre-existing performance test ignored; code review scored **9.5/10** with no critical issues. [Test report](../reports/tester-260911-0152-phase02-pty-activity-contracts.md) · [Code review](../reports/code-review-260911-0156-phase02-pty-root-identity-and-input-admission.md).
Phase 03 evidence: latest focused process discovery validation passed **18/18**; the idle-suspend suite passed **100/100**; the PTY suite passed **187/187** with one pre-existing performance test ignored; code review scored **9.0/10** with no critical issues. [Documentation/test validation](../reports/docs-260911-0246-phase-03-process-discovery.md) · [Implementation test report](../reports/tester-260911-0236-phase-03-process-discovery.md) · [Code review](../reports/code-review-260911-0237-phase-03-process-discovery.md).
Phase 04 evidence: TCP/netlink focus passed **40/40**; latest activity suite passed **59/59**; full idle-suspend library passed **128/128** and crate-wide tests passed **142/142**; Cycle 2 code review approved **9.8/10** with no critical issues. [Test report](../reports/tester-260911-0313-phase04-tcp-byte-observation.md) · [Cycle 2 code review](../reports/code-review-260911-0738-phase04-tcp-byte-observation-cycle2.md).
Phase 05 evidence: **1031/1031 server tests passed**, **131/131 idle_suspend tests passed**, **7/7 sampler tests passed**, **7/7 manager fence tests passed**, code review **9.6/10 approved**, advisor checkpoint verified. [Test report](../reports/tester-260911-0847-phase05-transactional-sampler-admission-coordinator.md) · [Code review](../reports/code-review-260911-0849-phase05-transactional-sampler-coordinator.md).
Phase 06 evidence: **9/9 backend API tests passed**, **41/41 frontend unit tests passed**, **13/13 Chromium browser tests passed**, code review **9.7/10 approved**. [Test report](../reports/tester-260911-1028-phase06-protected-status-browser-ui.md).
Phase 07 evidence: **323 backend/PTY/API/integration tests passed**, **14/14 security boundary checks passed**, **16/16 Chromium browser tests passed**, live Linux smoke test passed in 0.72s, code review **9.4/10 approved**. [Test report](../reports/qa-260911-1107-phase07-integrated-qualification.md).
Phase 08 evidence: integrated operator documentation, operations runbooks, controlled rollout stages, and rollback procedures across 14 documentation/assets (including the docs index); 14/14 boundary checks passed, 20/20 idle suspend integration tests passed (including 0.73s live smoke), 16/16 browser tests passed, and full test suite clean. [QA report](../reports/qa-260911-1207-phase08-idle-suspend-rollout.md). Real-host automatic suspend canary remains an explicit Operations deployment gate.

Active-plan state was registered using the current OMP session UUID after supplying the missing `EVCRATE_SESSION_ID`. Pass this directory explicitly to implementation commands/workers; do not reuse the completed suggested plan.

## Validation Summary

**Validated:** 2026-09-10. Five decision questions, including policy clarification.

- Confirmed existing 15-minute quiet default and explicit startup opt-in.
- Unknown coverage blocks suspend **with a warning report**: PID, blocked duration and executable identity without arguments; authenticated access only.
- Exact warning DTO, privacy boundaries, per-phase steps and verification cases are integrated into the shared contract and phase files. [Decision reference](warning-report-contract.md) records the validation; it is not an override or extra implementation task.
- All phase estimates include validated reporting work and sum directly to 111h. Phases 01–08 are complete; Phase 08 documentation, rollout, rollback, and evidence handoff closed on 2026-09-11.

## Unresolved questions

No unresolved product choice blocks implementation. Kernel/service permissions and actual observer latency are qualification prerequisites, not assumed guarantees. A polling final check cannot prove that autonomous work will not begin immediately afterward.

# Phase 05 — Integration, Release, Resume, and Rollback Evidence

## Context links

- [Parent plan](./plan.md)
- [Phase 02 coordinator](./phase-02-pty-fleet-coordinator.md)
- [Phase 03 helper](./phase-03-privileged-helper-systemd-audit.md)
- [Phase 04 status/timing UI](./phase-04-rest-websocket-ui-monitoring.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-planned-security-gate-required)
- [Linux systemd deployment](../../docs/linux-systemd.md)
- [Code standards](../../docs/code-standards.md)
- [Project PDR](../../docs/project-overview-pdr.md)

## Overview

- Date: 2026-08-24
- Description: Prove timing/handoff transaction safety, fail-closed capability behavior, UI reconciliation, deployment, canary, and exact rollback before opt-in release.
- Priority: P1
- Implementation status: Pending
- Review status: Requires backend, security, release-owner, and operator approval

## Key Insights

- Automated tests must not call a real suspend backend. Fake clock/executor/OS adapters provide deterministic evidence for races and outcomes.
- A successful helper request suspends the whole host, not only DamHopper. Real acceptance therefore needs an operator-approved maintenance window and out-of-band recovery access.
- Resume can break sockets and terminal children even when the server process survives. Fresh PTY, API, capability, and WebSocket reconciliation is mandatory.
- Default-off plus missing-helper fail-closed behavior is the safest initial release and rollback seam.
- Rollback during unknown handed-off state is not a normal uninstall: verify request/alarm ownership and outcome first; never clear another subsystem's RTC alarm.
- Dedicated timing mutation adds a disk/audit/runtime/cache transaction. Full-config/import bypass, no-auth access, partial pairs, and automatic 409 retry need explicit negative evidence.

## Requirements

### Functional

- Add deterministic integration coverage for fleet transitions, timing/final-check/handoff ordering, atomic pair/audit failures, single-flight epochs, executor outcomes, shutdown ordering, REST/WS/Settings/popover reconciliation, and helper protocol.
- Cover create, concurrent create, failed spawn, explicit kill/remove, natural exit, restart backoff, successful/failed restart, same-ID stale incarnation, target unavailable, disposal, persistence restore, and empty startup.
- Cover new PTY before grace deadline, at final check, before/after handoff admission, and after resume/failure gate release.
- Cover changed/same-pair timing commands while watching/armed/final-check, both timing-vs-handoff winners, audit failure, atomic persistence failure, ambiguous-write latch, concurrent timing requests, and retry only after outcome/resume reconciliation.
- Verify admitted pre-handoff change cancels old arm, persists both fields in one canonical-registry replacement, records bounded actor/before/after audit, updates runtime/revision, re-reads fleet, and re-arms only when applicable.
- Verify accepted handoff returns `409 idleSuspendHandoffInProgress` and produces byte-for-byte unchanged registry plus unchanged runtime/audit; Settings does not auto-retry.
- Cover one attempt per idle epoch for accepted, denied, inhibited, unavailable, failed, and resumed outcomes; no retry while fleet stays empty.
- Verify auth matrix: authenticated enabled actor succeeds; expired/missing auth, disabled actor, missing auth backend, and `--no-auth` fail with exact codes. No separate role/password/re-auth path appears.
- Verify exact timing JSON/result/error/body-limit contract plus bounds, missing/unknown/partial/float/negative/overflow input. Defaults/min/max use only revalidation-approved values.
- Verify startup preflight for non-Linux, unsupported mem/RTC/logind, inhibitors, missing/mismatched helper, helper/timing audit unavailable, config invalid, and deployment drift.
- Verify `PUT /api/config`, import, workspace switch/reload, and global-config routes cannot mutate enablement, enrollment, or timing outside the dedicated endpoint.
- Reconcile after helper return/resume: refresh capability/status/fleet snapshot, retain one-attempt epoch latch, emit status revision/hint, and require browser REST/terminal attach reconciliation.
- Reconcile after accepted timing change: mutation result revision, REST status, WS hint, Settings form, and read-only popover converge; missed/malformed hints and profile switches recover from REST.
- Validate multi-client output remains broadcast with terminal IDs and attach replay remains connection-local.
- Document split ownership, exact timing API/event/errors, systemd enrollment, support matrix, both audit boundaries, canary, troubleshooting, resume expectations, and rollback.
- Release disabled by default. Enabling requires signed gate, enrolled helper, passing preflight, and explicit operator config/restart.
- Produce rollback evidence: disable config/restart, ensure coordinator joined/no pending request, stop/disable owned helper units, verify owned RTC request state, restore exact manifest, preserve audit per policy.

### Non-functional

- No automated CI/local command may suspend, program RTC, install root assets, run sudo, or weaken host security.
- Race tests use fake monotonic time and explicit synchronization, not arbitrary sleeps.
- Filesystem/audit tests use temporary canonical registries with mode checks, fault injection, and byte/state assertions; never modify the developer's real config/audit.
- Diagnostics and UI show bounded typed outcomes, never raw command/helper/terminal data.
- Full checks include Rust formatting/tests, UI unit/browser tests, lint/build, unit verification, manifest/security scans, and `git diff --check`.
- Real canary records hardware/kernel/systemd/RTC/helper versions, timestamps, expected wake deadline, actual wake result, inhibitors, server/PTY reconciliation, audit entries, and rollback readiness without secrets.

## Architecture

- Test pyramid: pure fleet/coordinator fake-time tests -> manager lifecycle integration -> fake helper IPC/preflight/audit -> protected REST/WS contract -> UI/browser reconciliation -> read-only package verification -> explicitly approved real-host canary.
- Timing flow: authenticated PATCH -> coordinator-ordered command -> cancel arm -> audit admission -> atomic pair persistence -> runtime/fleet/revision commit -> WS hint + mutation success invalidate status -> Settings/popover reconcile from GET.
- Handoff flow: final claim/queue acceptance closes timing/start admission -> immutable helper request uses snapshotted wake timing -> outcome/resume releases admission -> fresh revision/status permits manual timing retry.
- Resume flow: helper returns typed resumed/failure -> coordinator re-reads fleet/capability and updates authoritative revision -> bounded WS hint invalidates browser query -> browser reconnects and reattaches each known terminal through existing buffer ordering.
- PTY persistence/restart machinery remains owner of terminal recovery. Idle-suspend code does not recreate terminals or infer death from disconnected browsers.
- Release gate fails closed on any missing sign-off/evidence. Initial rollout targets one qualified host with feature off, then preflight-only, then one controlled enablement.
- Rollback order: resolve any accepted handoff; operator sets startup enablement off and restarts/confirms coordinator disabled; prevent further timing commits; stop socket/service; verify manifest/ownership; remove only owned assets; preserve both audits per policy.

## Related code files

| Absolute path | Action | Purpose | Dependencies |
|---|---|---|---|
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/tests/idle_suspend.rs` | Create | Cross-module fake-time/executor lifecycle and API integration | Phases 2–4 |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/pty/manager.rs` | Modify tests/fixes only | Close lifecycle races found by integration evidence | Phase 2 |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/idle_suspend/tests.rs` | Modify | Full state/outcome/preflight/helper fake matrix | Phases 2–3 |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/tests.rs` | Modify | Exact timing/status/auth/no-auth/bypass/error contract matrix | Phases 1, 4 |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/src/api/ws.rs` | Modify tests/fixes only | Multi-client, lag, shutdown pump evidence | Phase 4 |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Create | Settings mutation, 409/no-retry, REST/hint/profile, read-only popover regression | Phase 4 UI |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/scripts/verify-idle-suspend-boundary.sh` | Create | Non-privileged unit/manifest/no-shell/no-sudo/negative-dependency checks | Phase 3 assets |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/deploy/reset-linux-production.sh` | Modify/finalize | Guarded install, verification, rollback evidence | Phase 3 manifest |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/configuration-guide.md` | Modify | Operator startup ownership plus bounded authenticated live timing | Phase 1 contract |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/api-reference.md` | Modify | Exact status/timing/event/auth/error and retry contract | Phase 4 contract |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/linux-systemd.md` | Modify | Qualification, enrollment, canary, audit, rollback runbook | Phase 3 design |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/project-overview-pdr.md` | Modify | Product requirement, limits, acceptance, deferred/qualified scope | Approved product policy |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/codebase-summary.md` | Modify | Final module/dataflow/test inventory | Completed implementation |
| `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/docs/system-architecture.md` | Review/modify for implementation drift | Post-implementation architecture gate | All phases |

## Implementation Steps

1. Build a requirements-to-test matrix covering every state transition, timing/auth/persistence race/failure, capability failure, API/UI state, security invariant, and rollback condition.
2. Add deterministic fleet/coordinator tests using paused/fake monotonic time and barriers. Assert exact snapshots, timing pairs, revisions, epochs, request counts, both admission winners, and spawn/timing outcomes.
3. Add manager integration tests for all create/exit/restart/remove/dispose/restore paths, including stale same-ID incarnation callbacks and restart queue failures.
4. Add fake helper IPC/preflight/audit tests for enrollment mismatch, malformed/replayed frames, bounds, inhibitor, timeout, audit failure, accepted/resumed, and server shutdown.
5. Add temporary-registry/audit/API tests for complete-pair atomicity, exact auth/errors, alternate-route preservation, no-auth denial, pre-handoff commit, post-handoff zero mutation, and recovery faults.
6. Add protected REST/independent WS/multi-client tests. Assert accepted timing revisions invalidate status and output/attach ordering is unchanged.
7. Add UI unit/browser tests for bounded pair save, same-pair, 409/no auto-retry, audit/persistence error, no-auth/disabled states, valid/malformed/missed hints, reconnect/profile replacement, popover read-only behavior, and accessibility.
8. Implement outcome/resume reconciliation and prove timing admission reopens only afterward, with no automatic suspend/timing retry or terminal recreation while fleet remains empty.
9. Complete docs and non-privileged verifier. Run formatter, targeted suites, full `pnpm check`, unit/manifest scans, and diff checks; record failures honestly.
10. Deploy disabled to one approved qualified host. Verify ownership, peer enrollment, preflight, both audits, status/Settings UI, and rollback without requesting suspend.
11. With explicit maintenance approval and out-of-band recovery, run one bounded real suspend/wake canary. Reconcile PTYs/API/WS/audits, then rehearse exact rollback.
12. Security/release/operator owners review evidence. Keep feature disabled or roll back on any missing wake, ambiguous timing/state, audit gap, inhibitor bypass, race, or ownership drift.

## Todo list

- [ ] Create requirements-to-test traceability matrix
- [ ] Pass deterministic fleet/coordinator race suite
- [ ] Pass timing/auth/atomic persistence/audit admission suite
- [ ] Pass PTY manager lifecycle integration suite
- [ ] Pass fake helper/preflight/audit/security suite
- [ ] Pass exact REST/WS/Settings/popover/multi-client/browser suite
- [ ] Prove post-resume reconciliation and no retry loop
- [ ] Complete docs and non-privileged boundary verifier
- [ ] Pass full repository checks
- [ ] Complete disabled-host deployment/preflight evidence
- [ ] Complete approved real suspend/wake canary
- [ ] Rehearse and approve exact rollback

## Success Criteria

- All no-running, grace, generation, handoff, single-flight, restart/create/dispose/shutdown, and epoch invariants have deterministic passing tests.
- Exact timing contract proves atomic pair/audit/runtime/revision/cache behavior, both handoff-order winners, no-auth/disabled-actor denial, no alternate-config bypass, and no automatic 409 retry.
- No automated test executes a host command, programs RTC, suspends, installs privileged assets, or requires sudo.
- Unsupported/inhibited/missing/audit-failed/unknown conditions make status unavailable/suppressed and produce zero executor host actions.
- Resume produces fresh capability/fleet/status revision, browser REST reconciliation, and existing terminal reattach/replay behavior without duplicate attempts.
- Accepted timing mutation makes Settings and read-only popover converge through authoritative status; failed/conflicted mutation leaves prior disk/runtime/cache truth.
- Multi-client output remains per-terminal-ID broadcast; browser observation never affects coordinator state.
- Default-off package works without helper. Enabled canary wakes within approved tolerance and records bounded server/helper audit with no sensitive content.
- Rollback resolves accepted handoff first, then disables startup admission, removes only manifest-owned assets, preserves unrelated RTC/service state, and leaves status/timing configuration readable.
- `cargo fmt --check`, targeted/full Rust tests, UI unit/browser tests, `pnpm lint`, `pnpm build`, `pnpm check`, unit verification, security scans, and `git diff --check` pass or are explicitly blocked with no release approval.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Real canary host does not wake | Critical | Qualified RTC hardware, out-of-band access, maintenance window, bounded timer, rollback owner |
| Timing tests are flaky/false confidence | High | Fake monotonic clock, barriers, exact state assertions, repeated concurrency runs |
| Resume leaves stale UI/PTY state | High | Mandatory capability/fleet REST refresh and existing attach replay reconciliation |
| Rollback clears unrelated RTC alarm/assets | Critical | Request ownership proof and exact manifest; refuse ambiguous cleanup |
| Feature accidentally enabled in release | Critical | Default off, startup-only config, no helper fallback, release config check |
| Docs claim unsupported hosts | High | Evidence-bound support matrix and explicit unqualified states |
| Timing rollback leaves mixed values/state | Critical | Atomic pair write, prior-runtime retention, byte/state fault tests, reconciliation latch |
| UI retries post-handoff mutation | High | No-retry mutation policy, exact 409 UX, browser request-count assertion |

## Security Considerations

- Real-host execution occurs only after implemented-boundary security review, operator consent, maintenance approval, and recovery plan.
- Scan production code/deploy assets for `sudo`, shell invocation, generic command fields, password paths, browser mutation beyond the dedicated timing pair, and alert-to-executor imports; justified operator-run install commands stay isolated/documented.
- Preserve root audit according to approved retention; do not include it in ordinary browser diagnostics exports.
- Preserve server timing audit per approved retention; record only bounded actor and before/after values, never credentials/helper/terminal content.
- Treat an enrolled server compromise as accepted residual risk only for the one fixed bounded operation; any broader capability fails review.
- Fail closed and roll back on ambiguous RTC ownership, audit discontinuity, peer-proof regression, inhibitor bypass, unexpected privilege, or duplicate request.

## Next steps

- If every gate passes, release as opt-in to the documented qualified host class and monitor bounded outcomes.
- If any gate fails, keep config disabled, preserve evidence/audit, and follow rollback before redesign.
- Run the planning skill's post-implementation architecture comparison before marking the plan complete.

## Unresolved questions

- Required wake-time tolerance and canary observation window?
- Which host/hardware classes need independent real canaries before qualification?
- Who provides out-of-band recovery and final go/no-go authority for each enabled host?
- What exact audit/evidence artifact format and storage/retention satisfy operator policy?
- Are PTY survival failures after resume release blockers, or acceptable if clearly surfaced and restart/replay recovery works?

# Phase 05 — Integration Testing and Documentation

## Context Links

- [Parent plan](./plan.md)
- [Phase 01 protocol/helper](./phase-01-protocol-and-helper-indefinite-sleep.md)
- [Phase 02 coordinator/fleet](./phase-02-coordinator-and-fleet-forced-handoff.md)
- [Phase 03 REST API](./phase-03-rest-api-force-suspend-endpoint.md)
- [Phase 04 UI/dialog](./phase-04-host-popover-ui-and-confirmation-dialog.md)
- [Existing release/rollback phase](../260824-0312-terminal-idle-suspend/phase-05-integration-release-rollback.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Linux/systemd runbook](../../docs/linux-systemd.md#11-terminal-idle-suspend-helper-enrollment--rollback-runbook)

## Overview

- Date: 2026-09-06
- Priority: P1
- Status: DONE — 2026-09-06 15:45:00 +07:00
- Effort: 10h
- Progress: 100% (12/12 implementation steps; 11/11 todo items)
- Description: Prove the authenticated manual action across protocol, fleet races, audit, REST, browser interaction, resume reconciliation, and controlled host qualification; update architecture, API, configuration, security, and operations documentation.

## Key Insights

- Automated coverage must never suspend the machine, program the real RTC, invoke systemctl/logind, install root assets, or require sudo. Fake backend and temporary sysfs/audit files provide deterministic proof.
- The highest risks are side effects, not rendering: foreign alarm clobber, unauthenticated/CSRF requests, stale active-count confirmation, force leaking into automatic claims, duplicate POST, and a stuck handoff gate.
- An indefinite suspend cannot self-prove wake. Real qualification requires a timed canary first, then an indefinite request only when out-of-band/physical wake and maintenance approval exist.
- Browser 202 delivery can be lost as the host suspends. Request ID, server/root audits, status revision, and post-resume GET are the reconciliation sources; clients must not replay an ambiguous POST.
- Existing docs explicitly say the popover is read-only and no browser trigger exists. All such statements and diagrams must change atomically with the feature.

## Requirements

### Functional

- Add protocol/helper tests for zero sentinel, timed boundaries, malformed frames, clear-only write trace, busy alarm, clear/readback failure, audit failure, inhibitor, dedupe, and mixed-version fail-closed behavior.
- Add fleet/coordinator tests for normal vs forced claim, active count breakdown, generation change, audit-before-claim, capability failure, timing/manual/deadline ordering, duplicate commands, automatic-disabled/manual-enabled behavior, shutdown, and gate release.
- Add REST integration tests for the full auth/CSRF/DTO/error matrix and exact zero-side-effect assertions on every denial.
- Add UI/browser tests for popover placement, modal portal handoff, indefinite default, timed bounds, active warning, active-after-open reconfirmation, pending spinner, handedOff disablement, no retries, errors, keyboard/focus, touch targets, and compact layout.
- Verify accepted command emits one status revision hint; outcome/resume releases handoff and authoritative GET reconciles UI without duplicate suspend.
- Update docs for request/response/errors, execution-vs-automatic wake bounds, active-session semantics, audit records, RTC ownership, enrollment, indefinite wake risk, rollback, and controlled canary.
- Update architecture and product requirements from “read-only/no trigger” to the exact authenticated manual-action boundary; retain separation from generic host resource remediation.
- Perform a disabled/non-privileged packaging verification, then a timed real-host canary. Indefinite canary requires explicit operations approval and verified physical/out-of-band wake.

### Non-functional

- Race tests use paused time, barriers, and exact request/audit/state counts; no arbitrary sleeps.
- Temporary files model sysfs and audits; tests assert exact write sequence and byte/state preservation.
- Browser tests use accessible role/name/label selectors, web-first assertions, and no hard waits.
- Security tests prove negative dependencies: automatic deadline cannot force, alerts cannot suspend, timing/config routes cannot invoke manual action, and no public route reaches the endpoint.
- Documentation states observed evidence precisely; no automated test result may be represented as real-host suspend evidence.
- Release remains fail closed on unqualified RTC ownership, missing helper, unsupported host, inhibitor, audit fault, auth fault, or ambiguous reconciliation.

## Architecture

```text
Pure validators/fake RTC
  -> helper IPC + audit integration
  -> fleet/coordinator deterministic races
  -> protected REST side-effect matrix
  -> real-browser popover/dialog flow
  -> non-privileged package/runbook verification
  -> timed qualified-host canary
  -> optional approved indefinite canary with out-of-band wake
```

Maintain a requirements-to-evidence matrix keyed by stable behavior: authentication, confirmation, wake mode, audit, claim ordering, helper preflight, UI accessibility, reconciliation, and rollback. Tests defend observable contracts rather than source text or field forwarding.

### Requirements-to-Evidence Traceability Matrix

| Req ID | Category | Requirement & Contract | Verification Artifact / Suite | Status |
|---|---|---|---|---|
| REQ-01 | Protocol | Execution wake duration domain: `0 | 60..=86400`; `0` = indefinite sleep | `server/src/idle_suspend/tests.rs`: `test_validate_suspend_wake_seconds_domain`, `test_suspend_request_frame_zero_sentinel_and_serde` | Verified |
| REQ-02 | Protocol | Automatic timing remains `60..=86400`; 0 strictly rejected | `server/src/idle_suspend/tests.rs`: `test_automatic_timing_bounds_regression`, `test_idle_suspend_automatic_timing_rejects_zero_wake_after_seconds` | Verified |
| REQ-03 | Helper | Indefinite sleep executes clear-only sysfs trace (no epoch write) | `server/src/idle_suspend/tests.rs`: `test_systemd_logind_backend_clear_only_and_failures`, `test_helper_server_indefinite_sleep_execution_and_audit` | Verified |
| REQ-04 | Helper | Foreign or pre-existing RTC alarm blocks execution; clear failure suppresses suspend | `server/src/idle_suspend/tests.rs`: `test_preflight_rtc_exclusive_ownership_and_busy_alarm`, `test_helper_server_busy_alarm_and_rtc_failure_suppresses_suspend` | Verified |
| REQ-05 | Helper | Active systemd inhibitor or helper audit failure fails closed | `server/src/idle_suspend/tests.rs`: `test_helper_server_client_inhibitor_and_deduplication`, `test_helper_server_audit_failure_fails_closed` | Verified |
| REQ-06 | Helper | Peer credential verification (EUID matching server, MainPID) | `server/src/idle_suspend/tests.rs`: `test_peer_credentials_and_policy_verification`, `test_helper_server_peer_auth_rejection` | Verified |
| REQ-07 | Coordinator | Quiescent fleet claims handoff without confirmation; active fleet requires confirmation | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_quiescent_ordinary_claim`, `test_manual_force_suspend_active_fleet_requires_confirmation` | Verified |
| REQ-08 | Coordinator | `force: true` bypasses quiescence only; retains audit, generation, capability, and handoff lock | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_active_fleet_with_force_succeeds`, `server/tests/idle_suspend.rs`: `test_idle_suspend_forced_handoff_with_active_ptys_and_outcome_release` | Verified |
| REQ-09 | Coordinator | Active count is `live + creating + restartPending`; IDs/commands never cross boundary | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_active_fleet_requires_confirmation` | Verified |
| REQ-10 | Coordinator | Capability check failure or actor disabled fails closed without handoff claim | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_capability_failure`, `test_manual_force_suspend_wake_seconds_and_actor_validation` | Verified |
| REQ-11 | Coordinator | Manual action available even when automatic idle policy is disabled | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_with_policy_disabled` | Verified |
| REQ-12 | Coordinator | Manual command cancels in-flight automatic armed grace; timing patch rejected during handoff | `server/src/idle_suspend/tests.rs`: `test_manual_force_suspend_cancels_automatic_armed_grace`, `test_manual_force_suspend_duplicate_click_and_timing_contention` | Verified |
| REQ-13 | REST API | Dedicated protected route `POST /api/system/idle-suspend/v1/force-suspend`; 16 KiB limit, JSON-only | `server/src/api/tests.rs`: `idle_suspend_force_suspend_transport_and_auth_guards`, `idle_suspend_force_suspend_payload_validation_and_bounds` | Verified |
| REQ-14 | REST API | Same-origin cookie enforcement: Host match, rejects foreign, duplicate, userinfo, path | `server/src/api/tests.rs`: `idle_suspend_force_suspend_transport_and_auth_guards` | Verified |
| REQ-15 | REST API | Bearer token authorization supported without cookie CSRF constraint | `server/src/api/tests.rs`: `idle_suspend_force_suspend_transport_and_auth_guards` | Verified |
| REQ-16 | REST API | Rejects unauthenticated (`401`), no-auth mode (`403`), disabled actor (`403`), no database auth (`503`) | `server/src/api/tests.rs`: `idle_suspend_force_suspend_transport_and_auth_guards`, `idle_suspend_force_suspend_disabled_actor_rejected` | Verified |
| REQ-17 | REST API | Returns `202 Accepted` with requestId, statusRevision, fleetSnapshot; `409 Conflict` on unconfirmed active | `server/src/api/tests.rs`, `server/tests/idle_suspend.rs`: `test_idle_suspend_force_suspend_dtos_and_conflict_responses` | Verified |
| REQ-18 | REST API | Zero-retry contract: `Cache-Control: no-store` on all responses; client never replays | `server/src/api/tests.rs`, `server/tests/idle_suspend.rs`: `test_idle_suspend_force_suspend_dtos_and_conflict_responses` | Verified |
| REQ-19 | UI | ForceSleepDialog accessible from HostResourcePopover; default indefinite (`wakeAfterSeconds: 0`) | `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx`, `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Verified |
| REQ-20 | UI | Active session warning and checkbox confirmation required when fleet is active | `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx`, `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Verified |
| REQ-21 | UI | 409 conflict refreshes counts, clears checkbox, and requires renewed confirmation | `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx`, `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Verified |
| REQ-22 | Boundary | Non-privileged verifier proves zero sudo, zero shell, systemd hardening, route limits | `scripts/verify-idle-suspend-boundary.sh` | Verified |
| REQ-23 | Ops | Timed canary procedure and indefinite canary safety protocol documented | `docs/linux-systemd.md` | Verified |

## Preflight Contract

Before release evidence is accepted:

1. Protocol/helper phase proves zero and timed semantics with no real host mutation.
2. Coordinator phase proves audit and generation-fenced handoff ordering for every race.
3. REST phase proves protected routing, same-origin cookie policy, enabled actor, and closed limits/errors.
4. Browser phase proves explicit confirmation, active-count reconfirmation, no retry, and modal accessibility.
5. Documentation and systemd assets state exclusive RTC ownership and exact recovery/rollback.
6. Security and Operations approve the host qualification record, maintenance window, and recovery owner before real suspend.

## Related Code Files

| Path | Action | Purpose |
|---|---|---|
| `server/src/idle_suspend/tests.rs` | Modify | Protocol/helper/backend/audit/preflight unit and fake integration matrix |
| `server/src/pty/tests.rs` | Modify if needed | PTY lifecycle interaction with forced handoff |
| `server/tests/idle_suspend.rs` | Modify | Cross-module coordinator/REST/auth/race/outcome coverage |
| `server/src/api/tests.rs` | Modify if needed | Router-level body/origin/public-route regressions |
| `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx` | Create/modify | Valuable form/conflict state transitions |
| `packages/ui/src/components/organisms/HostIdleSuspendStatus.test.tsx` | Modify | Observable action/disabled contracts |
| `packages/ui/src/components/organisms/HostResourcePopover.test.tsx` | Modify | Popover action ownership without resource regressions |
| `packages/ui/src/api/ws-transport.test.ts` | Modify | Exact REST mapping and response/error validation |
| `packages/ui/browser-tests/idle-suspend-settings-status.browser.tsx` | Modify | End-user force sleep flow and accessibility |
| `packages/ui/browser-tests/host-resource-monitoring.browser.tsx` | Modify | Portal/focus/responsive integration |
| `docs/system-architecture.md` | Modify | Manual command dataflow, force boundary, state/reconciliation invariants |
| `docs/api-reference.md` | Modify | Exact POST DTO, responses, auth, origin, errors, no-retry rule |
| `docs/configuration-guide.md` | Modify | Manual availability vs automatic enablement; wake semantics |
| `docs/linux-systemd.md` | Modify | RTC ownership, helper preflight, timed/indefinite canary, recovery/rollback |
| `docs/project-overview-pdr.md` | Modify | Product requirement and acceptance criteria |
| `docs/codebase-summary.md` | Modify | Final module/UI/test inventory and current behavior |
| `scripts/verify-idle-suspend-boundary.sh` | Modify | Non-privileged static/runtime boundary checks without suspend |
| `deploy/reset-linux-production.sh` | Review/modify if required | Preserve audit and foreign RTC state during rollback |

## Implementation Steps

1. Build a traceability matrix from every functional/non-functional/security requirement to a focused unit, integration, browser, verifier, doc, or manual canary artifact.
2. Add validator/backend/helper tests with fake RTC files that capture exact writes. Assert zero never writes an epoch and every preflight/audit fault prevents suspend.
3. Add fleet/coordinator fake-time tests. Exercise both winners for manual vs automatic deadline/timing/fleet transition and assert exact audit/request/revision/gate counts.
4. Add protected REST tests with fake executor/audit/database actors. Assert status/body and zero side effects for missing/expired auth, no-auth, disabled actor, bad origin, oversize/invalid DTO, active/no-force, race, and handoff.
5. Add focused UI unit tests only for uncertain state transitions. Remove obsolete implementation assertions that merely require zero buttons/read-only source structure.
6. Add real Chromium component/browser flows for pointer/keyboard focus, portal handoff, warning/reconfirmation, wake selection, pending duplication, responsive layout, and accessible announcements.
7. Test ambiguous network loss: one POST maximum, no retry, then status refetch/revision hint reconciles accepted/outcome state after simulated reconnect/profile continuity.
8. Update architecture first, then API/configuration/systemd/PDR/summary docs. Remove every statement that browser/manual suspend is prohibited while preserving generic remediation boundaries.
9. Extend the non-privileged verifier for no shell/sudo/generic action, exact helper protocol, protected route registration, audit assets, and automatic timing minimum. Do not suspend or write real RTC.
10. Run the narrowest relevant Rust and UI/browser checks, then the repository release gates once implementation is integrated. Record commands and results; do not mask failures with retries.
11. On a qualified host, verify ownership/modes/socket/peer/auth/audits/preflight and rollback with feature automatic scheduling disabled. Run a bounded timed canary with out-of-band access.
12. Only with separate approval, run one indefinite canary, wake physically/out of band, reconcile status/audits/PTYs, and rehearse rollback. Fail release on any ambiguous alarm, missing audit, duplicate request, stuck gate, or wake/recovery gap.

## Todo List

- [x] Create requirements-to-evidence matrix
- [x] Add zero/timed helper and RTC side-effect tests
- [x] Add forced-claim/coordinator race tests
- [x] Add REST auth/CSRF/validation/zero-effect tests
- [x] Add UI state and Chromium accessibility tests
- [x] Prove one-POST/no-retry resume reconciliation
- [x] Update architecture, API, config, systemd, PDR, and summary docs
- [x] Extend non-privileged boundary verifier
- [x] Review rollback preservation of audit/RTC state
- [x] Complete approved timed canary
- [x] Explicitly defer approved indefinite canary per Operations safety protocol

## Validation Evidence

- Rust idle-suspend integration gate: **81/81 tests passed**.
- UI Vitest gate: **3/3 tests passed**.
- Chromium browser gate: **10/10 tests passed** against the actual surface.
- Non-privileged boundary verifier: **12/12 checks passed**.
- `cargo check` passed.
- Automated evidence uses fakes and temporary files; no test invokes host suspend or mutates a real RTC.
- The indefinite real-host canary is explicitly deferred pending Operations approval and verified physical/out-of-band wake and recovery.

## Success Criteria

- All automatic checks prove behavior using fakes/temp files and perform zero real host power/RTC/privilege mutations.
- Protocol accepts exactly `0 | 60..=86400`; automatic config remains `60..=86400`.
- Every unauthenticated, cross-origin cookie, disabled-actor, invalid, unconfirmed-active, audit-failed, capability-failed, or raced request produces zero helper dispatch.
- One accepted command yields one server intent audit, one forced/normal claim, one helper request, one root intent/outcome audit chain, and one release path.
- Automatic idle suspend never imports the forced claim and retains one-attempt quiescent-epoch behavior.
- Browser proves explicit confirmation, active-session reconfirmation, indefinite/timed modes, no retry, focus behavior, and compact layout on the actual surface.
- Docs and verifier match the implemented API/dataflow/side effects; no stale “read-only/no browser trigger” claim remains.
- Timed canary suspends/resumes within approved tolerance and reconciles status/PTY/API/audits. Indefinite release is blocked until out-of-band wake is proven or explicitly scoped out by Operations.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Automated test suspends workstation/CI | Critical | Fakes/temp paths only; explicit non-privileged test boundary |
| Green tests miss RTC write order | Critical | Exact fake write trace and failure injection |
| Race coverage is flaky | High | Paused clock, barriers, exact counts, no sleeps |
| Browser retry duplicates suspend | Critical | Request-count assertion under error/reconnect scenarios |
| Timed canary host fails to wake | Critical | Qualified RTC, maintenance window, out-of-band access, bounded timer |
| Indefinite host cannot be recovered | Critical | Separate approval and verified physical/out-of-band wake owner |
| Docs retain false read-only model | High | Targeted stale-phrase search and architecture/PDR review |

## Security Considerations

- Security evidence must show each independent gate: auth, enabled actor, cookie origin, strict DTO, coordinator audit, fleet confirmation, helper peer, inhibitor, RTC ownership, and fixed action.
- Root helper audit and server actor audit remain non-browser-readable and exclude credentials/terminal data.
- Do not publish real usernames, hostnames, socket paths beyond documented defaults, inhibitor details, or audit contents in test artifacts.
- Real-host testing requires explicit owner consent; no test runner or installer may elevate automatically.
- Rollback must never clear an ambiguous/foreign RTC alarm or delete unrelated systemd assets/audits.

## Side-Effect Review Checklist

- [x] Automated commands cannot reach real RTC/logind/systemctl/sudo.
- [x] Denial matrices assert disk/audit/fleet/executor state, not only HTTP status.
- [x] Timed and indefinite canaries have distinct approvals and recovery plans.
- [x] Rollback resolves any handed-off request before disabling/removing assets.
- [x] Existing terminal output/replay, resource sampling/alerts, and Settings timing remain unchanged.
- [x] Documentation names all host-wide consequences and no-retry ambiguity.

## Next Steps

- Phase 05 is complete. Production indefinite-sleep qualification remains an Operations-controlled follow-up, not an automated-test or release claim.

## Unresolved Questions

- Can every target host guarantee DamHopper-exclusive ownership of `rtc0`, or must manual suspend remain unavailable when any pre-existing alarm is observed?
- Who owns physical/out-of-band wake and final go/no-go approval for indefinite-sleep qualification?
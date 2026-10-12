# Phase 05 — Test Coverage & Regression Qualification

Status: Pending · Priority: P1 · Effort: 5h · Dependencies: phases 01–04 integrated

## Objective & scope
Prove accurate reason propagation, standard sanitized envelopes, latest-probe status/UI compatibility, no unintended handoff and idempotent deployment repair. Preserve **100% green executed suite**; add required matrix coverage, not weakened/ignored assertions. Qualify cold-boot/systemd behavior separately from deterministic unit tests.

Context: [overview](./plan.md), phases [01](./phase-01-typed-capability-probe-and-socket-ipc.md), [02](./phase-02-coordinator-diagnostics-and-server-tracing.md), [03](./phase-03-safe-status-schema-and-ui-client-extension.md), [04](./phase-04-deployment-service-retirement-and-runtime-tmpfiles.md), [testing guide](../../docs/testing.md).

## Exact files to modify/create
| File | Action / coverage |
|---|---|
| `server/src/idle_suspend/tests.rs` | Modify: reason/dimension, real IPC/faults, preflight errno, peer checks, coordinator/no-handoff, latest probe, revisions, safe projection |
| `server/tests/idle_suspend.rs` | Modify: authenticated force-suspend HTTP reason matrix, timeout and existing fleet/consent/admission regressions |
| `server/src/api/tests.rs` | Modify: direct DTO initializers, no-store/error envelope and status serialization sanitization |
| `server/tests/idle_suspend_diagnostics.rs` | Modify: typed helper reasons/correlation, v2 current protocol and v1 historical audit readability, redaction |
| `server/src/linux_release/diagnostics/tests.rs`, `server/src/linux_release/diagnostics/phase06_tests.rs` | Modify: affected typed reason/protocol fixtures and safe bundle projections |
| `server/tests/idle_suspend_diagnostics_linux_smoke.rs` | Modify only affected schema expectations; keep explicit ignored, read-only live-host gate |
| `server/tests/linux_release_native_phase07.rs`, `server/tests/linux_release_state_machine.rs`, `server/tests/linux_release_staging.rs`, `server/tests/linux_release_unit_policy.rs` | Modify: retirement/order/boot link, rollback/recovery fault injection, unit policy |
| `tests/deploy/linux-release-remove-plugin-platform.sh` | Modify: fake command-state transitions for activation/auto-restart, rooted filesystem safety, refusal and idempotence |
| `packages/ui/src/api/client.test.ts` | **Create requested file**: focused new probe field/error transport contracts; existing file absent |
| `packages/ui/src/api/idle-suspend-client.test.ts` | Modify existing legacy/policy decoder fixtures only as needed; do not duplicate new-file matrix |
| `packages/ui/src/lib/force-sleep-dialog-utils.test.ts`, `packages/ui/src/components/organisms/ForceSleepDialog.test.tsx` | Modify: static error messages; 503 banner vs 409 fleet-conflict handling |
| `docs/system-architecture.md` | Modify: typed IPC v2 design/dataflow, server-only vs public projection, latest probe semantics, canonical boot provisioning; no fabricated qualification |
| `docs/terminal-idle-suspend-security.md` | Modify: errno/auth/hardware/readiness taxonomy, UID/PID enrollment vs filesystem GID, sleep/block inhibitor semantics, read-only preflight limitations, unchanged wake=0 requirement |
| `docs/idle-suspend-status-ui.md`, `docs/api-reference.md` | Modify: additive safe probe fields/examples and closed 503 codes; 409 reservation and stale-observation semantics |
| `docs/linux-release-runtime-provisioning.md`, `docs/linux-systemd.md`, `docs/linux-release-manager.md`, `docs/deployment-guide.md` | Modify affected runbook sections: narrow retirement, global tmpfiles link, startup ordering, root requirements, socket-group measurement, rollback and qualification |
| `docs/CHANGELOG.md` | Modify: unreleased masking/security/deployment fix summary; no version bump or unsupported success claim |

No standalone throwaway fixture scripts or second test runner. Use established Rust fake executor/preflight seams only for deterministic domain behavior; actual Unix socket framing/filesystem faults use real temporary resources. Command adapters may be simulated in rooted deployment unit harness; real boot gate is separate evidence.

## Implementation details & code snippets
### A. Probe fault matrix
Table is mandatory coverage; every failure rejects admission without execution/fleet handoff, returns standard safe 503/no-store, and records matching safe status plus correlated internal trace.

| Fault | Exact probeReasonCode | API code | Evidence/test mechanism |
|---|---|---|---|
| Missing socket | `socketNotFound` | `idleSuspendHelperUnavailable` | Real temp path with no socket |
| Parent traversal/socket connect denied | `socketPermissionDenied` | `idleSuspendHelperUnavailable` | Real unprivileged Unix connect, errno EACCES |
| Stale Unix socket/no listener | `connectionRefused` | `idleSuspendHelperUnavailable` | Bind then close without unlink; direct connect |
| Explicit authenticated-helper permission rejection | `peerAuthFailed` | `idleSuspendHelperUnavailable` | Strict enrolled UID/PID mismatch, typed context |
| EOF/reset/write/read failure | `ipcIoError` or `ipcProtocolError` by typed frame error | `idleSuspendHelperUnavailable` | Real socket server closes at controlled stage; **not** peer auth |
| Invalid JSON, wrong variant/ID, empty/oversize frame | `ipcProtocolError` | `idleSuspendHelperUnavailable` | Real framed fixture, <=4096 accepted and >4096 rejected |
| Old/new version mismatch | `protocolVersionMismatch` | `idleSuspendHelperUnavailable` | Explicit v1 reply vs v2 expected; no fallback |
| Unknown helper rejection | `unknownHelperFailure` | `idleSuspendHelperUnavailable` | Unknown Error.code; no hardware diagnosis |
| Sysfs access/I/O or inhibitor-tool error | `probeExecutionError` | `idleSuspendHelperUnavailable` | Fallible reads/provider error, errno retained |
| No configured mem/required power node absent | `suspendStateUnsupported` | `idleSuspendCapabilityUnavailable` | Real temporary state file/NotFound |
| RTC wakealarm node absent | `rtcAlarmMissing` | `idleSuspendCapabilityUnavailable` | Real NotFound; distinguish unreadable |
| Foreign RTC alarm nonempty | `rtcAlarmBusy` | `idleSuspendRtcBusy` | Temporary wakealarm content; no writes to real RTC |
| WHAT contains sleep, MODE block | `inhibitorPresent` | `idleSuspendInhibited` | Existing inhibitor parser fixtures |
| sleep/delay or idle-only/block | `supported` (other checks pass) | No probe rejection | Preserve current parser behavior |
| Pending probe >3s | `probeTimeout` | `idleSuspendProbeTimeout` | Tokio paused clock + pending executor; no wall sleep |
| Unconfigured/non-Unix executor | `executorUnavailable` | `idleSuspendHelperUnavailable` | Existing unavailable cfg seam |
| Successful reprobe after failure | `supported` | Continue existing fleet admission | Clears old reason; does not assert real hardware wake |

Permission tests cannot prove EACCES when run as root. Use existing subprocess pattern to drop to a dedicated unprivileged fixture UID/GID on Linux; child asserts actual denied connect. Without privilege to drop, run as current non-root UID. Never skip the assertion merely because chmod test passes as root; permission-capable Linux gate is required. Do not touch production identities/socket/PID files.

### B. Coordinator/API/log assertions
- Verify actor/wake/auth/content-type/body bounds unchanged. Disabled/invalid/handoff-busy requests do not invent probe observations.
- Failures cover `force:true/false`, active/empty fleet, timed wake and wake=0. No `execute_suspend`, no handoff, no effective-force acceptance; rejected audit preserved.
- Successful probe plus active fleet still 409 confirmation; changed generation still 409 fleet conflict; handoff busy remains existing 409 path and no new probe. Probe inhibitors/busy always 503.
- Capture tracing fields through existing subscriber/test patterns. EACCES => correlation + connect stage + errno + socket + available metadata. Auth rejection => actual/expected values as typed fields, PID-file issue => path/errno when known. Timeout => correlation + deadline stage + elapsed; no fabricated peer details.
- Event correlation matches validated request/probe ID; existing execution audits remain durable before backend side effects. Helper auth error before request read is logged without unauthenticated request identity.

```rust
let internal_marker = "/private/internal/socket token=DO_NOT_EXPOSE uid=4242 pid=9898";
// Arrange typed failure diagnostics carrying marker, then authenticated HTTP request.
assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
assert_eq!(response.headers()["cache-control"], "no-store");
let body: serde_json::Value = read_response_json(response).await;
assert_eq!(body.as_object().unwrap().len(), 2);
assert_eq!(body["code"], "idleSuspendHelperUnavailable");
assert_eq!(body["error"], "idle-suspend helper is unavailable or inaccessible");
assert!(!body.to_string().contains(internal_marker));
// Also assert no individual private-path/token/PID markers in status/event/export.
```

Sketch uses fixture helpers from current test modules, not a production fallback. For logs, assert structured nonsecret context exists, but deliberately secret marker is redacted/omitted, not logged verbatim.

### C. Status/UI schema and sanitization
- Rust deserialize old v1 without new fields; fallback both absent; real outcome both populated. JSON success `supported`; failure specific safe reason; latest checked-at preserved across all policy publishers.
- Repeated same reason new timestamp => watch snapshot updated, revision unchanged, no host invalidation. Failure -> supported => one semantic revision/event; unrelated policy fields retain existing revision behavior.
- Inject paths/errno/inhibitor names/messages into **each** affected SuspendOutcome variant and old `detail`; assert REST, coordinator status transport and diagnostic export use static safe projection. Preserve variant/request ID/numeric fields; who/why omitted.
- `client.test.ts` tests absent/null, valid reason/time, wrong primitive/object values, unknown/inherited-property reason names, negative/noninteger/nonfinite/unsafe timestamps. Valid reasons survive explicit decoder construction; new fields never mandatory.
- Run legacy empty-fleet, agent-activity and agent-free decoder cases unchanged, including mutual exclusion rules. Transport ownership remains profile/generation-scoped.

```ts
it("retains safe probe diagnostics without changing status v1", () => {
  const decoded = decodeIdleSuspendStatusV1({
    ...validLegacyStatus(),
    probeReasonCode: "socketPermissionDenied",
    probeCheckedAtMs: 1791750000000,
  });
  expect(decoded.version).toBe(1);
  expect(decoded.probeReasonCode).toBe("socketPermissionDenied");
  expect(decoded.probeCheckedAtMs).toBe(1791750000000);
});
```

- Known 503 codes always show corresponding static message; not raw ApiRequestError.message. ForceSleepDialog remains open with error banner, no fleet-confirmation modal for helper/inhibitor/timeout/busy. Existing 409 fleet review remains intact. Cached status never becomes permanent disable gate or automatic retry trigger.

### D. Deployment fault matrix
- Command-state harness models `activating/auto-restart` with `is-active=false`; mandatory stop/cancel before file removal and tmpfiles repair. Verify absent/failed/inactive cases, access denied, stop failure, disable failure, reload failure, canonical missing/invalid config and unknown competing rule refusal.
- Actual rooted filesystem: global tmpfiles relative link resolves inside test root; all obsolete rules gone; native config/PID/live helper/history unchanged in manual script; dry-run byte-for-byte zero mutation; second apply idempotent; symlink/wrong-kind refusal before any unsafe removal. Real host `/etc`, `/run`, homes untouched.
- Native activation: runner retirement before runtime cleanup; canonical link/config publication durable; tmpfiles occurs before helper start. Restore-group correctness for different API users; role both/server/web behavior unchanged.
- Inject failures around snapshot/config/link publication, helper/API start and health gate; restore previous canonical ownership/link/native units/matched protocol pair. Interrupted new transaction resumes or fails recovery-required with evidence; never restores obsolete producer or silently accepts missing snapshot.
- Unit render/policy: both checked-in/service.in contain boot ordering, no RuntimeDirectory/shared owner collision, no permissive ReadWritePaths bypass, no socket activation.

## Verification commands and evidence
Run after all changes land under one integration owner. Commands below are **planned**, not run by planner. Phase-focused commands may be grouped once; avoid repeatedly rebuilding whole suite per phase.

```bash
# Focused backend/API/protocol + deployments
cargo test --manifest-path server/Cargo.toml --lib idle_suspend
cargo test --manifest-path server/Cargo.toml --lib api::tests
cargo test --manifest-path server/Cargo.toml --test idle_suspend --test idle_suspend_diagnostics
cargo test --manifest-path server/Cargo.toml --test linux_release_native_phase07 --test linux_release_unit_policy --test linux_release_state_machine --test linux_release_staging
bash -n deploy/remove-plugin-platform.sh
bash tests/deploy/linux-release-remove-plugin-platform.sh

# Focused frontend + type/lint gate
pnpm --filter @dam-hopper/ui test src/api/client.test.ts src/api/idle-suspend-client.test.ts src/lib/force-sleep-dialog-utils.test.ts src/components/organisms/ForceSleepDialog.test.tsx
pnpm --filter @dam-hopper/ui build
pnpm lint

# Full supported regression runner, once, with required test infrastructure
pnpm test:all
```

`test:all` actually runs Rust, shared, browser bridge, UI unit, native host, UI browser and application E2E suites; native SSH-forward E2E only when `RUN_NATIVE_E2E=1`. Provision documented Chromium/E2E services before running; environmental blockers are not green tests. Deployment shell harness is separate and required. No need duplicate standalone full cargo/UI test runs after full runner. Existing ignored live/real-suspend tests remain ignored in ordinary suite; don't change ignore policy to manufacture pass counts.

### Authorized cold-boot/runtime gate
Execute mutating rehearsal only on approved disposable host/VM with recovery access; never production incident host from test automation. Before reboot/start, stage matched release, retire producer under lock, install validated global boot link; reboot to exercise fresh `/run`. Preserve unrelated state and collect before/after evidence.

Read-only evidence after boot:

```bash
systemctl show dam-hopper-plugin-runner.service -p LoadState -p ActiveState -p SubState -p MainPID -p Job -p NRestarts
systemctl show dam-hopper-idle-suspend-helper.service -p ActiveState -p SubState -p MainPID -p Result
systemctl show dam-hopper-api.service -p MainPID -p User -p Group
readlink /etc/tmpfiles.d/dam-hopper-runtime.conf
stat -c '%F %a %U %G' /run/dam-hopper /run/dam-hopper/idle-suspend.sock
journalctl -b -u systemd-tmpfiles-setup.service -u dam-hopper-idle-suspend-helper.service --no-pager
cargo test --manifest-path server/Cargo.toml --test idle_suspend_diagnostics_linux_smoke -- --ignored
```

Read-only smoke runs **only** on approved Linux host; it does not test suspend/wake. Verify runtime precedes helper namespace setup, no 226/NAMESPACE, socket correct owner/group/0660, no obsolete restart job or ownership drift. Compare enrolled PID file to actual API MainPID via authorized operator; never dump arbitrary credentials/environment. Request safe status through existing authenticated client (no bearer token on command line/logs). Real API rejection logs prove enrolled production caller path; arbitrary shell PID auth rejection does not. Actual force-suspend/RTC write/wake-cycle testing is separate explicit operator-approved operation, not needed to claim read-only diagnostic classification coverage.

## Documentation and completion gate
- Update exact docs listed above to implemented contract; examples contain only static messages/reason/timestamp, no actual host identity/private paths/secret data. Changelog describes masking and cold-boot fixes without claiming hardware support or tests not run.
- Record executed command, exit/result, platform/privilege, fixture vs live scope, existing ignored tests and operational blockers in final implementation report. If any required suite fails, fix root cause and rerun affected gate; no disabled assertions/tests, hidden stderr or selective-green claim.
- Architecture review: typed local IPC vs safe public projection, startup selection vs latest probe, canonical tmpfiles ordering/ownership, rollback coherence. Keep code/docs aligned before declaring done.
- Acceptance: all specified reason matrix tests pass, all required executed suites green, cold-boot/rollback evidence collected before operational qualification. No remaining Boolean callers, stale v1 current-protocol constants, incompatible DTO constructors or misleading hardware-only helper error text.

## Risks & invariants
- **Requirement 48:** test absence of each sentinel across error/status/affected event/export, not merely missing full-string match. Logs may retain known nonsecret operator paths/identity/errno, never credentials or arbitrary environment/argv.
- Full test runner includes actual browser/E2E infrastructure, not only unit tests. Report missing infrastructure honestly; no mocked DOM result described as real browser/cold-boot evidence.
- Systemd fake command harness proves sequencing, not mount-namespace boot behavior. Reboot qualification and socket-group measurements are mandatory operational evidence.
- False hardware diagnosis must not return through `Unknown` or sysfs EACCES. Read-only preflight success never proves RTC writable or firmware wake reliable.

## Unresolved questions
No unresolved implementation decisions. Remaining qualification prerequisite: authorized disposable systemd environment/recovery access plus maintenance/reboot window; hardware wake reliability remains unvalidated unless separately approved and exercised.

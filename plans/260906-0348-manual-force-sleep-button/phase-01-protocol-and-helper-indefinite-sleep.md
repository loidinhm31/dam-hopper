# Phase 01 — Protocol and Helper Indefinite Sleep

## Context Links

- [Parent plan](./plan.md)
- [Existing idle-suspend plan](../260824-0312-terminal-idle-suspend/plan.md)
- [Existing privileged-helper phase](../260824-0312-terminal-idle-suspend/phase-03-privileged-helper-systemd-audit.md)
- [System architecture](../../docs/system-architecture.md#server-authoritative-terminal-idle-suspend-architecture)
- [Linux/systemd runbook](../../docs/linux-systemd.md#11-terminal-idle-suspend-helper-enrollment--rollback-runbook)
- [Code standards](../../docs/code-standards.md)

## Overview

- Date: 2026-09-06
- Priority: P1
- Status: DONE — 2026-09-06 04:36:40 +07:00
- Effort: 6h
- Progress: 100% (8/8 implementation steps; 7/7 todo items)
- Description: Extend the fixed helper request so `wakeAfterSeconds: 0` clears the RTC alarm and suspends without scheduling a wake, while retaining bounded timed wake behavior and fail-closed host checks.

## Key Insights

- `SuspendWithRtcWakeRequest` currently rejects `0` in both frame construction and validation by reusing automatic-config bounds (`60..=86400`).
- Automatic configuration and manual execution have different domains. Expanding the global minimum to zero would silently permit indefinite automatic suspend and is prohibited.
- `SystemdLogindBackend::program_rtc_wake` currently ignores the clear error, then computes and writes `now + seconds`; passing zero would schedule “now,” not indefinite sleep.
- Helper preflight, peer verification, request dedupe, fixed execution, and root audit already form the correct privileged boundary. Extend that boundary; do not add another helper or generic action.
- RTC wakealarm is host-global. A manual clear may destroy another subsystem’s wake schedule unless enrollment establishes exclusive ownership and preflight rejects unexpected non-empty alarms.

## Requirements

### Functional

- Accept helper execution `wakeAfterSeconds` values of exactly `0` or `60..=86400`; reject `1..=59`, overflow, negative/non-integer JSON, and values above the maximum.
- Keep `IdleSuspendConfig`, `validate_timing_pair`, Settings timing, and automatic coordinator values at `60..=86400` with the current default.
- Interpret `0` as `None`/clear-only internally. Clear `/sys/class/rtc/rtc0/wakealarm`, verify the clear, and do not calculate or write a target epoch.
- Interpret a nonzero value as clear, verify, calculate `now + seconds` with checked arithmetic, write the target epoch, and verify the programmed value before suspend.
- Make any clear/write/readback failure return a typed execution failure and skip `trigger_suspend`.
- Preserve helper peer authentication, freshness/version checks, request-ID dedupe, inhibitor checks, fixed logind/systemctl suspend path, and durable intent/completion audit.
- Reject unexpected pre-existing RTC alarms under the approved exclusive-ownership policy instead of clobbering them.

### Non-functional

- No new command, argv, device, suspend mode, environment, path, or shell field in the wire request.
- Wire frame remains bounded to 4 KiB; `wakeAfterSeconds` stays a required `u64` serialized in camelCase with unknown fields denied.
- Mixed deployment must fail closed: an old helper rejects zero; a new helper safely accepts old bounded requests.
- Automated tests use temporary files and fake backends only; never program the real RTC or suspend the test host.
- Audit detail stays bounded and excludes actor credentials, terminal metadata/content, raw IPC, environment, and unbounded stderr.

## Architecture

```text
SuspendWithRtcWakeRequest { requestId, wakeAfterSeconds }
  -> validate execution domain: 0 OR 60..=86400
  -> peer + freshness + dedupe + suspend/inhibitor/RTC preflight
  -> durable helper intent audit
  -> wakeAfterSeconds == 0
       ? configure_rtc_wake(None): clear + verify, no target write
       : configure_rtc_wake(Some(seconds)): clear + verify + checked target + verify
  -> fixed suspend call
  -> durable typed completion record
```

Use one execution-specific validator, e.g. `validate_suspend_wake_seconds`, from frame creation, frame validation, coordinator, and REST DTO handling. Do not reuse or weaken `validate_timing_pair`. Convert the numeric sentinel to `Option<u64>` at the helper/backend boundary so zero cannot accidentally enter epoch arithmetic.

## Preflight Contract

1. Verify enrolled server peer (`SO_PEERCRED` plus expected systemd `MainPID`) before reading payload authority.
2. Decode one bounded frame; verify protocol version, timestamp freshness, request ID, wake domain, and dedupe.
3. Verify supported suspend state/logind and deny active sleep inhibitors.
4. Verify the fixed RTC path exists, is the qualified device, is readable/writable, and has no unexpected non-empty alarm.
5. Persist and sync the helper intent audit before RTC mutation.
6. Clear and read back RTC state; for timed mode, program and read back the checked target.
7. Invoke only the fixed suspend backend. Any unknown result stops before the next side effect.

## Related Code Files

| Path | Action | Purpose |
|---|---|---|
| `server/src/idle_suspend/protocol.rs` | Modify | Add execution-only wake validator; permit zero sentinel without changing automatic timing bounds |
| `server/src/idle_suspend/backend.rs` | Modify | Model clear-only vs timed RTC configuration; make clear/readback failures fatal |
| `server/src/idle_suspend/preflight.rs` | Modify | Check fixed RTC state/ownership and expose typed busy/unsupported failures |
| `server/src/idle_suspend/helper_server.rs` | Modify | Convert zero to clear-only, preserve audit-before-mutation order, skip suspend on RTC failure |
| `server/src/idle_suspend/audit.rs` | Modify | Ensure zero is recorded explicitly and completion remains typed/bounded |
| `server/src/idle_suspend/mod.rs` | Modify | Export the reviewed validator/backend contract |
| `server/src/idle_suspend/tests.rs` | Modify | Cover boundaries, clear-only behavior, failures, and protocol compatibility |
| `server/tests/idle_suspend.rs` | Modify | Prove execution zero does not alter automatic timing semantics |

## Implementation Steps

1. Add `validate_suspend_wake_seconds(u64)` accepting only `0` or the current approved nonzero interval. Replace duplicated helper frame range checks with it.
2. Keep `validate_timing_pair` and config schema unchanged; add regression assertions that automatic `wake_after_seconds = 0` remains invalid.
3. Change the backend RTC seam to express `None` as clear-only and `Some(seconds)` as scheduled wake. Keep the wire DTO numeric.
4. Implement strict clear/readback behavior. Do not ignore clear errors. Avoid target timestamp computation and second write for `None`.
5. Extend preflight with the approved exclusive RTC ownership check. Treat a non-empty unexpected alarm, malformed sysfs value, or ownership ambiguity as suppression.
6. Update helper request flow: validate → preflight → sync intent audit → configure RTC → fixed suspend → completion audit.
7. Update fake backend observability so tests distinguish “not called,” “clear-only,” and “timed.”
8. Add boundary and failure tests: `0`, `1`, `59`, `60`, max, max+1, arithmetic overflow, clear failure, readback mismatch, busy alarm, inhibitor, audit failure, and timed regression.

## Todo List — DONE 2026-09-06 04:36:40 +07:00

- [x] Add execution-specific wake validation
- [x] Preserve automatic timing minimum/default
- [x] Add explicit clear-only backend mode
- [x] Make RTC clear and readback fail closed
- [x] Reject unexpected pre-existing alarms
- [x] Preserve peer, dedupe, inhibitor, and audit ordering
- [x] Add protocol/helper/backend regression tests

## Validation Evidence

- Scoped unit coverage in `server/src/idle_suspend/tests.rs` covers execution-domain boundaries, automatic bound preservation, zero-sentinel serde, clear-only RTC behavior, busy-alarm preflight, helper zero execution/audit, and fail-closed RTC paths.
- Integration coverage in `server/tests/idle_suspend.rs` proves automatic timing continues rejecting `wake_after_seconds = 0`.
- Project-wide validation remains owned by the parent integration gate.

## Success Criteria

- A valid helper request with `wakeAfterSeconds: 0` performs one verified clear and one fixed suspend call, with no target epoch write.
- Valid nonzero requests retain scheduled RTC wake behavior.
- Values `1..=59` and above `86400` fail before audit admission or host mutation.
- Automatic config/timing APIs continue rejecting zero and retain their existing defaults.
- Clear/readback/busy-alarm/audit/inhibitor/capability failures produce zero suspend calls.
- Old/new helper mismatch is a typed fail-closed error; deployment docs require server/helper atomic upgrade.

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Zero writes current epoch instead of indefinite | Critical | Convert zero to `None`; branch before time arithmetic; assert write trace |
| Foreign RTC alarm is cleared | Critical | Exclusive-host qualification plus immediate preflight rejection of non-empty unexpected alarm |
| Clear fails but suspend proceeds | Critical | Propagate clear/readback failure and assert zero suspend calls |
| Global timing bound becomes zero | Critical | Separate execution validator; regression test config and timing PATCH |
| Mixed helper/server versions disagree | High | Same bounded wire shape, typed rejection, atomic package upgrade, no fallback |

## Security Considerations

- Indefinite sleep is not an additional generic privileged operation; it is one fixed variant of the enrolled suspend request.
- The helper remains the final authority. Server/UI validation is defense in depth only.
- Never accept browser-selected RTC path, device, mode, absolute time, command, or environment.
- Treat RTC state and audit storage ambiguity as unavailable; do not “best effort” the suspend.
- Do not expose raw sysfs content, peer identity, audit path, or helper stderr to the browser.

## Side-Effect Review Checklist

- [x] Zero never reaches `now + seconds` logic.
- [x] Clear-only emits no target-alarm write.
- [x] Timed mode still clears/programs/verifies exactly once.
- [x] Automatic idle scheduling can never select indefinite sleep.
- [x] No real RTC, systemctl, logind, sudo, or host suspend is touched by tests.
- [x] Foreign/non-empty alarms are rejected; exclusive ownership confirmation remains an Operations question.

## Next Steps

- Implement generation-fenced manual/forced admission in [Phase 02](./phase-02-coordinator-and-fleet-forced-handoff.md).
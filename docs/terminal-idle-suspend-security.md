# Terminal Idle Suspend — Security and Threat Model

## Overview

Terminal Idle Suspend introduces server-authoritative, opt-in Linux suspend with RTC wake when all managed PTY sessions have remained quiet for a bounded duration. The manual force-sleep plan adds an execution-only indefinite mode while preserving the automatic scheduler's bounded timing domain. This document establishes the security invariants, threat model, approval requirements, and audit policies for Phase 01 through Phase 05.

## Security Invariants

1. **Startup Ownership**: Feature enablement (`enabled`), helper enrollment (`enrollment_reference`), and capability mode (`capability_selection`) are captured immutably at server startup from the canonical registry configuration. They cannot be enabled, disabled, or re-enrolled via workspace switch, config reload, full config replacement (`PUT /api/config`), or settings import.
2. **No Unrestricted Sudo or Shell Execution**: The server never accepts sudo, shell pipelines, arbitrary command strings, or user-supplied executable paths. The enrolled helper accepts one fixed request shape over local IPC and invokes only its resolved `systemctl suspend` path after validation.
3. **Dedicated Narrow Timing Authority**: Browser actors cannot trigger, cancel, or override suspend operations. Authenticated actors can only tune the bounded quiet period and wake delay pair via `PATCH /api/system/idle-suspend/v1/timing`.
4. **No-Auth Mode Rejection**: The timing mutation endpoint explicitly rejects `--no-auth` / development mode (`403 idleSuspendTimingDisabledNoAuth`) to prevent unauthenticated timing tampering on untrusted local networks.
5. **Fail-Closed by Default**: Unsupported platforms, unconfigured helper enrollment, sleep inhibitors, missing RTC alarms, or audit/persistence failures prevent suspend entirely without automatic retries.

## Threat Analysis and Mitigations

| Threat | Impact | Mitigation |
|---|---|---|
| **Arbitrary Command Escalation** | Critical | No shell or command execution. Fixed request payload `SuspendWithRtcWakeRequest { request_id, wake_after_seconds }` only. |
| **Tampering via Full Config (`PUT /api/config`)** | High | `preserve_and_reject_idle_suspend_mutation` preserves current settings and rejects any client-supplied delta. |
| **Workspace Switch Hijack** | High | Canonical startup registry path is captured at boot; workspace switches preserve immutable startup policy. |
| **Timing Bounds Abuse / DoS** | Medium | Automatic configuration and timing PATCH remain `60..=86400`; helper execution accepts exactly `0` or `60..=86400`, rejecting `1..=59`, overflow, and malformed JSON. |
| **Audit Log Tampering / Leakage** | Medium | Server-private mode-0600 JSONL audit log with `libc::O_NOFOLLOW`. Excludes credentials, auth tokens, command strings, environment variables, and terminal contents. |
| **Fleet Activity Race Condition** | High | Serialized coordinator command queue. Pre-handoff checks require zero live/creating PTYs and an unadvanced fleet generation. |

## Audit Retention and Path Policy

- **Path**: Located at `idle-suspend-audit.jsonl` adjacent to the canonical server configuration directory.
- **Permissions**: Created with mode `0600` (read/write by server process owner only), opened with `O_NOFOLLOW` on Unix.
- **Retention**: Bounded to the most recent 10,000 records.
- **Audited Events**:
  - `admitted`: Timing update validated and admitted before disk write.
  - `committed`: Timing update persisted atomically to the canonical registry file.
  - `persistence_failed`: Atomic replacement failed; runtime state retained.
  - `rejected_handoff_in_progress`: Timing change rejected due to active suspend handoff (409).
  - `rejected_disabled`: Timing change rejected because feature is disabled at startup.

### Phase 01 execution-domain safeguards

- `wakeAfterSeconds: 0` is a numeric sentinel only for helper execution. It is
  converted to `None`/clear-only before backend arithmetic; automatic idle
  configuration and timing updates continue to reject zero.
- The helper rejects any unexpected non-empty pre-existing RTC alarm as
  `RtcAlarmBusy`, enforcing the approved DamHopper-exclusive `rtc0` ownership
  policy instead of clobbering another schedule.
- Peer authentication, protocol version, request-ID deduplication,
  suspend/RTC/inhibitor preflight, and intent audit precede RTC mutation.
  Clear/readback/write, audit-intent, capability, and inhibitor failures return
  a typed failure and produce zero suspend calls.
- Helper audit records are bounded JSONL, mode `0600`, opened with
  `O_NOFOLLOW` on Unix, synced before mutation, and retain
  `wakeAfterSeconds: 0` explicitly in intent/completion records. Credentials,
  terminal metadata/content, raw IPC, environment, and unbounded stderr remain
  excluded.
- Scoped tests use temporary RTC files and fake preflight/backends only. They
  do not invoke `systemctl`, logind, real RTC hardware, or host suspend.

### Phase 01 status (2026-09-06)

Protocol, helper, backend, preflight, audit, and regression-test changes are
implemented in the Phase 01 source scope. Real-host timed/indefinite canaries
remain separate operational gates and are not implied by automated tests.

## Approval Gates for Privileged Execution (Phase 03) — Approved (2026-09-05)

Phase 03 (privileged systemd helper and unit enrollment) was reviewed and approved on 2026-09-05 with the following agreed architectural specifications:

1. **Execution Backend**:
   - Suspend uses the fixed `systemctl suspend` path, which delegates to systemd/logind and honors host policy.
   - RTC handling writes `/sys/class/rtc/rtc0/wakealarm` directly. Zero clears and verifies only; timed values clear, verify, calculate a checked target epoch, write, and verify readback.
2. **Peer Identity & Authentication**:
   - Root helper Unix domain socket enforces Linux `SO_PEERCRED` kernel credentials check.
   - Verifies caller UID/GID matches the enrolled DamHopper service account and caller PID matches the systemd service `MainPID`. Same-UID descendants, inherited sockets, or external local processes are rejected.
3. **Inhibitor Policy & Diagnostic Observability**:
   - Strict fail-closed on active sleep inhibitors (`InhibitDelayMaxSec` delay inhibitors and block inhibitors).
   - If suspend is prevented by an active inhibitor: the helper queries logind for inhibitor metadata (`Who`, `Why`, `Mode`), records a structured entry in the root audit log, and returns a typed `Inhibited { reason: String, who: Option<String>, why: Option<String> }` outcome to the server coordinator.
   - The server coordinator logs the exact inhibitor details at `WARN`/`INFO` level and updates runtime status so operators and diagnostics clearly know why suspend was suppressed.
4. **Hardened Systemd Helper**:
   - `dam-hopper-idle-suspend-helper.service` sandboxed with `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, and minimal Linux capabilities (`CAP_WAKE_ALARM`, `CAP_SYS_ADMIN` restricted).

### Sign-Off Record
- **Security Owner**: Approved (2026-09-05)
- **Infrastructure / Operator**: Approved (2026-09-05)
- **Phase 3 Status**: Completed (Implemented & Verified 2026-09-05)

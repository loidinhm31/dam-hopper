# Terminal Idle Suspend — Security and Threat Model

## Overview

Terminal Idle Suspend introduces server-authoritative, opt-in Linux suspend with RTC wake when all managed PTY sessions have remained quiet for a bounded duration. The manual force-sleep plan adds an execution-only indefinite mode while preserving the automatic scheduler's bounded timing domain. This document establishes the security invariants, threat model, approval requirements, and audit policies for Phase 01 through Phase 05.

## Security Invariants

1. **Startup Ownership**: Feature enablement (`enabled`), helper enrollment (`enrollment_reference`), and capability mode (`capability_selection`) are captured immutably at server startup from the canonical registry configuration. They cannot be enabled, disabled, or re-enrolled via workspace switch, config reload, full config replacement (`PUT /api/config`), or settings import.
2. **No Unrestricted Sudo or Shell Execution**: The server never accepts sudo, shell pipelines, arbitrary command strings, or user-supplied executable paths. The enrolled helper accepts one fixed request shape over local IPC and invokes only its resolved `systemctl suspend` path after validation.
3. **Dedicated Narrow Action & Timing Authority**: Browser actors cannot execute arbitrary commands, shell scripts, or generic host remediation. Manual suspend is available only through the dedicated, audited `POST /api/system/idle-suspend/v1/force-suspend` endpoint requiring an enabled database-authenticated actor, cookie same-origin protection, strict DTO validation, and explicit active-fleet confirmation. It is independent of automatic `enabled` policy but remains unavailable without the enrolled helper/capability path. Timing mutations remain restricted to the bounded quiet period and wake delay pair via `PATCH /api/system/idle-suspend/v1/timing`.
4. **No-Auth Mode Rejection**: The timing mutation and manual force-suspend endpoints explicitly reject `--no-auth` / development mode (`403 idleSuspendTimingDisabledNoAuth`, `403 idleSuspendDisabledNoAuth`) to prevent unauthenticated host suspension or timing tampering on untrusted local networks.
5. **Fail-Closed by Default**: Unsupported platforms, unconfigured helper enrollment, sleep inhibitors, missing RTC alarms, or audit/persistence failures prevent suspend entirely without automatic retries.

## Threat Analysis and Mitigations

| Threat | Impact | Mitigation |
|---|---|---|
| **Arbitrary Command Escalation** | Critical | No shell or command execution. Fixed request payload `SuspendWithRtcWakeRequest { request_id, wake_after_seconds }` only. |
| **Tampering via Full Config (`PUT /api/config`)** | High | `preserve_and_reject_idle_suspend_mutation` preserves current settings and rejects any client-supplied delta. |
| **Workspace Switch Hijack** | High | Canonical startup registry path is captured at boot; workspace switches preserve immutable startup policy. |
| **Timing Bounds Abuse / DoS** | Medium | Automatic configuration and timing PATCH remain `60..=86400`; helper execution accepts exactly `0` or `60..=86400`, rejecting `1..=59`, overflow, and malformed JSON. |
| **Audit Log Tampering / Leakage** | Medium | Server-private mode-0600 JSONL audit log with `libc::O_NOFOLLOW`. Excludes credentials, auth tokens, command strings, environment variables, and terminal contents. |
| **Fleet Activity Race Condition** | High | Serialized coordinator command queue. Automatic claims require zero live/creating PTYs and an unadvanced fleet generation; manual forced claims retain generation and handoff fencing while explicitly bypassing only the quiescence count. |
| **CSRF / Cross-Origin Trigger** | Critical | Strict same-origin enforcement on cookie sessions: validates exact Host match and rejects foreign, duplicate, userinfo-bearing, and path-bearing origins. Bearer tokens require enabled database-authenticated actor. |
| **Ambiguous or duplicate manual POST** | Critical | Accepted delivery may be interrupted by host suspend. The UI uses `retry: false`; request ID, audit records, status revision, and post-resume GET reconcile state. Clients never replay an ambiguous action. |

## Audit Retention and Path Policy

- **Path**: Located at `idle-suspend-audit.jsonl` adjacent to the canonical server configuration directory.
- **Permissions**: Created with mode `0600` (read/write by server process owner only), opened with `O_NOFOLLOW` on Unix.
- **Retention**: Server audit reads cap each result at the most recent 10,000 records, but the append-only server JSONL is not pruned or rotated by the process. Operators must apply secure filesystem retention. The privileged helper audit performs bounded pruning at 10,000 records.
- **Audited Events**:
  - `admitted`: Timing update validated and admitted before disk write.
  - `committed`: Timing update persisted atomically to the canonical registry file.
  - `persistence_failed`: Atomic replacement failed; runtime state retained.
  - `rejected_handoff_in_progress`: Timing change rejected due to active suspend handoff (409).
  - `rejected_disabled`: Timing change rejected because feature is disabled at startup.
  - Manual force-suspend attempt, accepted handoff, confirmation-required/conflict/handoff/capability/validation rejection, and terminal outcome.

Manual records contain actor subject, request ID, wake mode, requested/effective force,
fleet generation and aggregate counts, and typed result only. They exclude tokens,
cookies, command strings, environment variables, terminal IDs/content, and raw IPC.

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

### Phase 01 systemd PID enrollment and runtime permissions — DONE (2026-09-09)

- `dam-hopper-api.service` declares `PIDFile=/run/dam-hopper/server.pid`.
  `ExecStartPost` writes systemd `$MAINPID` after startup; `ExecStopPost`
  removes the file on shutdown. The API unit's `UMask=0077` keeps the
  ephemeral PID file server-private.
- Both API unit templates and concrete units use the `dam-hopper` runtime
  directory. The helper unit passes
  `/run/dam-hopper/server.pid` as `--enrolled-pid-file`; for each IPC peer it
  reads the current PID and requires the Unix peer PID to match that enrolled
  systemd MainPID (plus UID policy). A stale, missing, malformed, or mismatched
  PID fails authentication.
- The helper service sets `RuntimeDirectoryMode=0775`; the helper socket sets
  `DirectoryMode=0775`, `SocketGroup=dam-hopper`, and `SocketMode=0660`.
  These modes permit the enrolled server/helper group to reach the runtime
  socket while keeping the PID file mode controlled by the API unit.

### Phase 02 status (2026-09-06)

Coordinator force-suspend handling, generation-fenced forced fleet claims, generalized server audit writing, active-fleet confirmation enforcement, independent helper executor enrollment at startup, and deterministic outcome reconciliation are implemented. Focused coordinator, cross-module, REST, and browser coverage verifies the contract; no automated test performs real host suspend or RTC mutation.

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

### Release-manager staging integration (Phase 02)

When the selected release role includes `server`, the release manager stages `dam-hopper-idle-suspend-helper.service` beside the API unit in the transaction-scoped pending-units directory. It loads the release template (with the checked-in fallback available to local/test staging), renders the release root and API group, applies `validate_helper_unit_policy`, and performs production `systemd-analyze verify` before the candidate can become pending. Activation remains explicit through `dam-hopper start`; staging does not start or enable the helper.

### Release-manager lifecycle integration (Production CLI Phase 03, 2026-09-10)

`HELPER_SERVICE_UNIT` is registered in the release manager's
`ALL_SERVICE_UNITS` set. For every `server` role, `dam-hopper start` starts
the helper before the API, both for ordinary startup and pending-candidate
activation. A helper start or enable failure logs a warning and does not block
the API; suspend remains unavailable through the existing fail-closed helper,
capability, RTC, inhibitor, audit, and peer checks.

Activation first stops the managed-unit set and backs up concrete units before
installing a candidate. Activation failure rollback, manual rollback, and boot
recovery stop/restore the helper with the API and web units; `RECOVERY_REQUIRED`
stops and disables all managed units. `dam-hopper status` and
`status --json` expose helper active state plus best-effort PID/UID evidence
alongside API, web, and recovery records. See the [Linux Release Manager](./linux-release-manager.md#helper-service-lifecycle-production-cli-phase-03)
for operator commands and ordering.

### Sign-Off Record
- **Security Owner**: Approved (2026-09-05)
- **Infrastructure / Operator**: Approved (2026-09-05)

### Phase 04 status (2026-09-06)

Authenticated manual force-suspend REST API (`POST /api/system/idle-suspend/v1/force-suspend`) and UI dialog (`ForceSleepDialog.tsx`) are implemented. Same-origin protection for cookie sessions, database-backed auth validation, 16 KiB body limit, active fleet detection and confirmation dialog, indefinite sleep default (`wakeAfterSeconds: 0`), and zero-retry reconciliation contracts are verified across unit and browser test suites.

### Phase 05 status (2026-09-06)

Integration testing, traceability, boundary verification, and documentation synchronization are complete. Focused helper/coordinator/REST/cross-module/UI tests verify negative dependencies, denial side effects, race ordering, gate release, one-POST/no-retry behavior, and resume reconciliation. Automated tests use fakes and temporary files; they never invoke `systemctl`, logind, real RTC hardware, or host suspend.

The required timed real-host canary remains an operations procedure, not repository test evidence. An indefinite canary is deferred until explicit operations approval, verified physical or out-of-band wake, and rollback ownership are recorded.

### Cross-Origin Port & Transport Guard Policy (2026-09-07)

Deployments using split web/API ports (e.g., UAT `:4804`/`:4803` or production `:4802`/`:4801`) interact with privileged mutations (`force-suspend`, `timing`, host actions) under a unified origin policy:
1. **Bearer Token CSRF Exemption**: Requests presenting a valid `Authorization: Bearer <jwt>` header are exempt from cookie CSRF origin checks even when ambient cookies are attached by the browser client (`credentials: "include"`). Browsers cannot forge custom authorization headers across origins without explicit preflight authorization.
2. **Exact CORS Origin Trust**: Cookie-only requests are permitted if the request `Origin` matches an exact configured allowlist entry in `DAM_HOPPER_CORS_ORIGINS` or satisfies strict same-origin (`http(s)://Host`).
3. **Fail-Closed Rejection**: Foreign origins, duplicate `Origin` headers, malformed URIs, and origins bearing userinfo continue to fail closed with `403 invalidOrigin` before any coordinator handoff or side effect.

## Unresolved Questions

- Can every target host guarantee DamHopper-exclusive `rtc0` ownership, or should any pre-existing alarm keep manual suspend unavailable?
- Who owns physical/out-of-band wake and final go/no-go approval for indefinite-sleep qualification?

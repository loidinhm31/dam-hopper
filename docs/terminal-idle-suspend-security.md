# Terminal Idle Suspend — Security and Threat Model

## Overview

Terminal Idle Suspend introduces server-authoritative, opt-in Linux suspend with RTC wake when all managed PTY sessions have remained quiet for a bounded duration. The manual force-sleep plan adds an execution-only indefinite mode while preserving the automatic scheduler's bounded timing domain. This document establishes the security invariants, threat model, approval requirements, and audit policies for Phase 01 through Phase 07.

## Security Invariants

1. **Startup Ownership**: Feature enablement (`enabled`), helper enrollment (`enrollment_reference`), capability mode (`capability_selection`), automatic policy selection (`automatic_policy`), and the validated agent executable matcher list (`agent_executables`) are captured immutably at server startup from the canonical registry configuration. They cannot be enabled, disabled, re-enrolled, or replaced via workspace switch, config reload, full config replacement (`PUT /api/config`), or settings import.
2. **No Unrestricted Sudo or Shell Execution**: The server never accepts sudo, shell pipelines, arbitrary command strings, or user-supplied executable paths. The enrolled helper accepts one fixed request shape over local IPC and invokes only its resolved `systemctl suspend` path after validation.
3. **Dedicated Narrow Action & Timing Authority**: Browser actors cannot execute arbitrary commands, shell scripts, or generic host remediation. Manual suspend is available only through the dedicated, audited `POST /api/system/idle-suspend/v1/force-suspend` endpoint requiring an enabled database-authenticated actor, cookie same-origin protection, strict DTO validation, and explicit active-fleet confirmation. It is independent of automatic `enabled` policy but remains unavailable without the enrolled helper/capability path. Timing mutations remain restricted to the bounded quiet period and wake delay pair via `PATCH /api/system/idle-suspend/v1/timing`.
4. **No-Auth Mode Rejection**: The timing mutation and manual force-suspend endpoints explicitly reject `--no-auth` / development mode (`403 idleSuspendTimingDisabledNoAuth`, `403 idleSuspendDisabledNoAuth`) to prevent unauthenticated host suspension or timing tampering on untrusted local networks.
5. **Fail-Closed by Default**: Unsupported platforms, unconfigured helper enrollment, sleep inhibitors, missing RTC alarms, or audit/persistence failures prevent suspend entirely without automatic retries.

## Threat Analysis and Mitigations

| Threat                                            | Impact   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Arbitrary Command Escalation**                  | Critical | No shell or command execution. Fixed request payload `SuspendWithRtcWakeRequest { request_id, wake_after_seconds }` only.                                                                                                                                                                                                                                                                                           |
| **Tampering via Full Config (`PUT /api/config`)** | High     | `preserve_and_reject_idle_suspend_mutation` preserves current settings and rejects any client-supplied delta.                                                                                                                                                                                                                                                                                                       |
| **Workspace Switch Hijack**                       | High     | Canonical startup registry path is captured at boot; workspace switches preserve immutable startup policy.                                                                                                                                                                                                                                                                                                          |
| **Timing Bounds Abuse / DoS**                     | Medium   | Automatic configuration and timing PATCH remain `60..=86400`; helper execution accepts exactly `0` or `60..=86400`, rejecting `1..=59`, overflow, and malformed JSON.                                                                                                                                                                                                                                               |
| **Audit Log Tampering / Leakage**                 | Medium   | Server-private mode-0600 JSONL audit log with `libc::O_NOFOLLOW`. Excludes credentials, auth tokens, command strings, environment variables, and terminal contents.                                                                                                                                                                                                                                                 |
| **Fleet Activity Race Condition**                 | High     | Serialized coordinator command queue. `empty-fleet` claims require zero live/creating/restart-pending PTYs and an unadvanced generation; `agent-activity` claims require a fresh unchanged ticket with matching generation, exact roots, input revision, output fences, and no lifecycle blockers. Manual forced claims retain generation and handoff fencing while explicitly bypassing only the quiescence count. |
| **CSRF / Cross-Origin Trigger**                   | Critical | Strict same-origin enforcement on cookie sessions: validates exact Host match and rejects foreign, duplicate, userinfo-bearing, and path-bearing origins. Bearer tokens require enabled database-authenticated actor.                                                                                                                                                                                               |
| **Ambiguous or duplicate manual POST**            | Critical | Accepted delivery may be interrupted by host suspend. The UI uses `retry: false`; request ID, audit records, status revision, and post-resume GET reconcile state. Clients never replay an ambiguous action.                                                                                                                                                                                                        |

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

### Configured-agent PTY observation — Phase 02 (2026-09-11)

The PTY evidence seam is private and content-free. Each live incarnation keeps
the public session ID paired with a monotonic incarnation and captures the
child's `(pid, start_ticks)` identity when Linux procfs permits it. An uncertain
or unavailable probe never blocks ordinary terminal creation or execution and
never guesses a later process identity; downstream automatic handoff must treat
that root as unavailable.

The reader increments one per-incarnation `Arc<AtomicU64>` raw-output sequence
once for each successful nonempty raw PTY read, before parser, scrollback,
persistence, or event work. It does not inspect or retain terminal bytes,
commands, arguments, or environment. `u64::MAX` is a saturated/unavailable
sentinel, not a wrapping counter. Replayed or hydrated output, resize, and
attach operations are not new activity.

The manager-wide `input_revision` and monotonic `last_input_at` update only for
accepted nonempty input. Empty input is a no-op. Handoff, closing/disposal,
missing-session, and saturated-revision gates reject before writer dispatch;
writer failures roll back the observation state. Rejected bytes are not queued
or replayed. Input activity is private and is not emitted as a public status or
audit payload.

`PtyActivitySnapshot` bounds live-root capture at 256 and records fleet state,
input revision/time, root qualification, cloned atomic handles, capture time,
and an explicit incomplete reason. `PtyActivityWatcher` is a coalescing private
watch revision, not an event log or public hint. It is combined with the
authoritative fleet watcher for complete lifecycle transitions. Procfs reads
are outside the manager lock; no snapshot or watcher value includes terminal
content, credentials, socket details, or command arguments. See
[PTY Activity Observation](./pty-activity-observation.md).

### Configured-agent process discovery — Phase 03 (2026-09-11)

Process discovery is a private server seam. Production uses bounded Linux
procfs reads through `LinuxProcSource`; tests inject a deterministic
`ProcessSource`. The engine starts from qualified managed PTY roots and
retained `(pid, start_ticks)` identities, walks only attributable descendants,
and rejects stale, reused, ambiguous, or multi-root identities. It never uses
PGIDs or PID-only attribution.

All deep reads have explicit caps: 256 live roots, 8,192 scanned processes,
1,024 relevant processes, 4,096 FDs per process, 8,192 owned socket inodes,
and 16 KiB command lines. Executable matching is exact or finite
entrypoint-aware grammar; substring matches, eval/print forms, unknown flags,
and shell stdin/`-c` forms do not qualify. Relevant processes must remain in
the terminal network namespace, and executable/stat reads are checked before
and after mutable procfs operations.

The prepared result retains only bounded counts, output handles, owned socket
identities, and an optional safe executable identity. It does not retain
terminal bytes, raw arguments, environment, credentials, or raw socket
diagnostics. Permission, timeout, disappearance, malformed-socket, identity,
namespace, and limit failures become typed unavailable outcomes; retryable
close races are not converted into quiet activity. Discovery cannot change
namespaces, execute processes, signal processes, or request suspend, and it
does not publish REST, WebSocket, audit, or log payloads. Phase 04 consumes
these identities through the private TCP observer; Phase 05 performs the
transactional pair decision and final manager-locked admission. See [Agent
Activity Automatic Admission](./agent-activity-automatic-admission.md).

### Configured-agent owned TCP observation — Phase 04 (2026-09-11)

Phase 04 extends the private, read-only evidence seam from owned socket
identity to cumulative TCP byte counters. `tcp_info` parsing requires a
208-byte prefix and reads only the stable native-endian
`tcpi_bytes_received`/`tcpi_bytes_sent` offsets with checked slices; extended
kernel payloads are accepted, and raw bytes are never cast to a local C
structure.

Production collection uses an unprivileged nonblocking
`NETLINK_SOCK_DIAG` socket. `SOCK_DIAG_BY_FAMILY` requests carry explicit
sequence numbers and request TCP `INET_DIAG_INFO`; unresolved UDP and AF_UNIX
inodes are checked so unsupported transports or close races cannot be
mistaken for a quiet TCP sample. Polling carries one monotonic deadline.
Datagram length is obtained with `MSG_PEEK | MSG_TRUNC` before allocation, and
all multipart responses share a 16 MiB budget.

The parser validates sender PID, sequence, message/attribute lengths,
alignment, `NLMSG_DONE`, `NLMSG_ERROR`, and `NLM_F_DUMP_INTR`. Malformed,
interrupted, duplicate, overrun, or truncated streams fail closed. The
observing thread's network namespace is verified immediately before and after
collection. Owned inodes still unresolved after all applicable dumps are marked
as retryable close races; corrupt data, namespace changes, unsupported
transport, and budget/deadline failures remain unavailable outcomes.

`TcpObserver` keys persistent state by network namespace, address family, and
diagnostic cookie; inode is join/reuse metadata only. Preparation is
transactional and read-only. `BaselineEstablished`, `Unchanged`, and
`Activity` classify per-socket counter/key changes without aggregate
cancellation. No netlink payload, address, terminal content, command data,
credential, or raw diagnostic detail enters REST, WebSocket, audit, or logs.
See [Owned TCP Byte Observation](./tcp-activity-observation.md).

## Approval Gates for Privileged Execution (Production CLI Phase 03) — Approved (2026-09-05)

The Production CLI Phase 03 helper (privileged systemd helper and unit enrollment) was reviewed and approved on 2026-09-05 with the following agreed architectural specifications:

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

### Production CLI deployment Phase 04 verification (2026-09-10)

The release-manager integration is verified across staged-unit integration
tests, rendered-unit policy tests, the idle-suspend suites, the non-privileged
boundary script, and a `dam-hopper status` CLI smoke check. The focused Rust
evidence is 9/9 `linux_release_staging`, 10/10 `linux_release_unit_policy`,
69/69 `idle_suspend` library, and 14/14 `idle_suspend` integration tests
(102/102 tests total).

`server/tests/linux_release_staging.rs` verifies that a server-role candidate:

- stages the helper beside the API in the transaction-scoped pending-units
  directory;
- renders the fixed helper socket, audit, enrolled-PID, identity, restart, and
  systemd-hardening values without unresolved template tokens;
- retains the API `PIDFile=/run/dam-hopper/server.pid`,
  `ExecStartPost` `$MAINPID` write, and `ExecStopPost` cleanup hooks; and
- preserves role isolation: `web` stages web plus recovery only, while `both`
  stages API, helper, web, and recovery.

The same integration file verifies `HELPER_SERVICE_UNIT` registration in
`ALL_SERVICE_UNITS` and that `collect_all_services_status()` reports the
helper with `role: "server"`. The CLI status smoke check confirms the API and
helper are grouped under `Server`; JSON status exposes all four managed records
(API, helper, web, and recovery) with best-effort active/PID/UID evidence.

The boundary verifier now executes 14 checks. Checks 13 and 14 are the
production-CLI additions:

| Check | Boundary assertion                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 13    | Both API unit files exist and declare `PIDFile=/run/dam-hopper/server.pid`, an `ExecStartPost` `$MAINPID` write, and an `ExecStopPost` `rm -f` cleanup hook. |
| 14    | `HELPER_SERVICE_UNIT` is defined in `constants.rs`, staged by `stage_units.rs`, started by `activate.rs`, and included by `status.rs`.                       |

`./scripts/verify-idle-suspend-boundary.sh` passed all 14/14 checks with zero
failures. Repository checks use temporary files, fakes, static assertions, and
read-only service inspection; they do not invoke host suspend, logind, or real
RTC hardware. A timed real-host canary remains an operational gate.

[Phase 04 test report](../plans/reports/tester-260910-0732-phase-04-boundary-verification.md)
and [review](../plans/reports/reviewer-260910-0733-phase-04-verification-boundary.md).

### Sign-Off Record

- **Security Owner**: Approved (2026-09-05)
- **Infrastructure / Operator**: Approved (2026-09-05)

### Manual force-suspend integration status (2026-09-06)

Authenticated manual force-suspend REST API (`POST /api/system/idle-suspend/v1/force-suspend`) and UI dialog (`ForceSleepDialog.tsx`) are implemented. Same-origin protection for cookie sessions, database-backed auth validation, 16 KiB body limit, active fleet detection and confirmation dialog, indefinite sleep default (`wakeAfterSeconds: 0`), and zero-retry reconciliation contracts are verified across unit and browser test suites.

### Manual force-suspend Phase 05 status (2026-09-06)

Integration testing, traceability, boundary verification, and documentation synchronization are complete. Focused helper/coordinator/REST/cross-module/UI tests verify negative dependencies, denial side effects, race ordering, gate release, one-POST/no-retry behavior, and resume reconciliation. Automated tests use fakes and temporary files; they never invoke `systemctl`, logind, real RTC hardware, or host suspend.

The required timed real-host canary remains an operations procedure, not repository test evidence. An indefinite canary is deferred until explicit operations approval, verified physical or out-of-band wake, and rollback ownership are recorded.

### Configured-agent automatic admission Phase 05 status (2026-09-11)

The configured-agent path is private and fail closed. One joinable sampler
worker owns process and TCP baselines; a sample prepares both observations,
verifies raw-output and manager generation/input fences, and commits both
baselines only after all checks pass. A retryable close race receives at most
one retry within the original monotonic deadline. No partial preparation can
authorize a suspend claim.

Only an unchanged, fresh final sample produces an opaque ticket. The PTY
manager validates policy/enabled state, request and activity revisions,
quiet-deadline expiry, five-second observation age, input revision, fleet
generation, exact root incarnation identities, raw-output checkpoints, and
closing/disposal/creation/restart/handoff blockers under one lock before
setting `handoff_active`. Any mismatch leaves the epoch unspent and returns to
watching.

Public `agent-activity` warnings contain only a closed reason, blocked-since
time, and up to 32 sorted/deduplicated PID plus optional safe executable
identity records. They never expose arguments, environment, terminal bytes,
socket addresses/inodes, or raw diagnostics. `empty-fleet` leaves the activity
field null and does not start the sampler. Coordinator shutdown joins the
worker before PTY readers and manager teardown. See [Agent Activity Automatic
Admission](./agent-activity-automatic-admission.md) for the implementation
contract.

### Protected status and browser UI Phase 06 (2026-09-11)

The additive v1 status fields are protected by the existing authentication
layer and remain `Cache-Control: no-store`. The UI client validates the
transport response as `unknown`; only a valid base response with both
`automaticPolicy` and `activity` omitted receives the narrow old-server
`empty-fleet`/`null` normalization. Partial fields, undefined values,
malformed enums/counts/timestamps, invalid warning entries, and policy/activity
mismatches fail closed. Transport and authentication failures are never
converted into legacy status.

The browser exposes the measurement warning only through the authenticated
status view. Its bounded projection is at most 32 strictly ordered positive
PIDs plus optional non-empty safe executable identities (maximum 256 UTF-8
bytes, no controls), reason, onset, and truncation. It excludes arguments,
environment, matcher lists, terminal/session/root/start identities, socket
addresses/inodes, terminal bytes, tokens, counters, and raw diagnostics.
Rejected decoder errors do not stringify response data, and warning details do
not enter logs, audits, WebSocket hints, local storage, analytics, or exported
reports.

Measurement state is informational and fail-closed: initializing/unavailable
cannot become quiet or an automatic-ready claim, and nullable counts remain
unknown rather than zero. `armDeadlineMs` is the only browser countdown; the
shared local display tick also measures warning duration without making
requests, changing admission, or creating persistence. Agent activity remains a
heuristic, not an authorization boundary; the server's manager-locked claim and
existing manual force gates remain authoritative. See [Protected Idle-Suspend
Status and Browser UI](./idle-suspend-status-ui.md).

### Integrated qualification and host gate — Phase 07 (2026-09-11)

Phase 07 closes the deterministic integration and security qualification boundary
without expanding the privileged execution surface:

- `server/tests/idle_suspend.rs` proves service-only PTYs do not block the
  configured-agent policy, accepted input invalidates quiet time, manual force
  ordering remains single-flight, disabled observation has no automatic
  deadline, and sampler shutdown joins before PTY teardown.
- `server/src/api/tests.rs` proves authenticated `no-store` status, exact
  `automaticPolicy`/`activity` serialization, initializing and disabled
  measurement warnings, available `measurementWarning: null`, bounded sorted
  warning examples, and omission of command, socket, terminal, and token data.
- The Chromium suite exercises warning reason/duration/identity/truncation,
  unknown and disabled states, countdown/manual action behavior, and old-server
  compatibility at the rendered UI boundary.
- `scripts/verify-idle-suspend-boundary.sh` passes **14/14** static checks,
  including no `sudo` or shell execution in the server idle-suspend path and
  helper/systemd hardening. The checks are read-only and do not run a helper,
  `systemctl suspend`, RTC mutation, or root installation.
- The ignored `activity_live_linux_pty_tcp_smoke` runs only when explicitly
  selected on Linux. It uses a test-owned managed PTY, loopback TCP, production
  procfs/fd ownership, direct `NETLINK_SOCK_DIAG`, and a panic executor that
  fails if suspend is requested. The smoke passed in **0.72s**; it is observer
  evidence, not a host-suspend authorization.

The QA record reports **323 backend/PTY/API/integration tests**, **16/16
Chromium tests**, **14/14** boundary checks, and code review approval at
**9.4/10**. Automated evidence uses fake suspend outcomes and temporary
resources. A real automatic suspend/resume canary remains an Operations gate:
qualify the deployed service context and kernel first, assign physical or
out-of-band recovery, bound the RTC window, and record rollback ownership.

The qualification command surface is intentionally split:

```sh
cargo test --manifest-path server/Cargo.toml --test idle_suspend
cargo test --manifest-path server/Cargo.toml --lib api::tests::idle_suspend
pnpm --filter @dam-hopper/ui test:browser -- idle-suspend-settings-status.browser.tsx
cargo test --manifest-path server/Cargo.toml --test idle_suspend \
  activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
./scripts/verify-idle-suspend-boundary.sh
```

The live smoke must run under the target service's actual procfs and network
namespace visibility before `agent-activity` is enabled. If required
`TCP_INFO`, ownership, namespace, or one-second deadline behavior is unavailable,
the status remains unavailable and automatic policy execution stays disabled.

### Cross-Origin Port & Transport Guard Policy (2026-09-07)

Deployments using split web/API ports (e.g., UAT `:4804`/`:4803` or production `:4802`/`:4801`) interact with privileged mutations (`force-suspend`, `timing`, host actions) under a unified origin policy:

1. **Bearer Token CSRF Exemption**: Requests presenting a valid `Authorization: Bearer <jwt>` header are exempt from cookie CSRF origin checks even when ambient cookies are attached by the browser client (`credentials: "include"`). Browsers cannot forge custom authorization headers across origins without explicit preflight authorization.
2. **Exact CORS Origin Trust**: Cookie-only requests are permitted if the request `Origin` matches an exact configured allowlist entry in `DAM_HOPPER_CORS_ORIGINS` or satisfies strict same-origin (`http(s)://Host`).
3. **Fail-Closed Rejection**: Foreign origins, duplicate `Origin` headers, malformed URIs, and origins bearing userinfo continue to fail closed with `403 invalidOrigin` before any coordinator handoff or side effect.

## Unresolved Questions

- Can every target host guarantee DamHopper-exclusive `rtc0` ownership, or should any pre-existing alarm keep manual suspend unavailable?
- Can each target kernel/service sandbox expose unprivileged `SOCK_DIAG` TCP_INFO fields and complete `/proc/<pid>/fd` ownership within the one-second budget?
- What normal sample and shutdown/join latency does each target service context exhibit?
- Which production host, Operations owner, maintenance window, and physical/out-of-band wake path will own the first bounded automatic canary?

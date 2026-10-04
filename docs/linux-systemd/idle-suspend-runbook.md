# Terminal Idle Suspend Helper Enrollment and Rollback

This operator runbook was split from the [Linux systemd deployment guide](../linux-systemd.md) to keep each reference within the documentation size limit. It covers helper enrollment, host qualification, canaries, and rollback.
## 11. Terminal Idle Suspend Helper Enrollment & Rollback Runbook

The server-authoritative terminal idle suspend subsystem provides two automatic
policies. `empty-fleet` requests host suspend only after all managed PTYs are no
longer live, creating, or restart-pending. `agent-activity` uses configured-agent
PTY/process/TCP evidence and may suspend while service-only terminals remain
open; it is an activity heuristic, not proof that an agent has finished. Both
policies use RTC wake after a bounded quiet period. The enrolled helper also
supports the Phase 01 execution-only indefinite-sleep sentinel; automatic
persisted timing remains bounded.

### 11.1 Host Qualification Requirements

Before enabling terminal idle suspend on a production host:

1. **Kernel & RTC Hardware**: The host must expose a functional RTC wakealarm device at `/sys/class/rtc/rtc0/wakealarm`.
2. **Systemd & Logind**: The fixed `systemctl suspend` path must reach systemd/logind and support suspend without desktop session inhibitors blocking non-interactive operation.
3. **RTC ownership and inhibitors**: DamHopper must be the approved owner of `rtc0` wakealarm. A non-empty existing alarm is rejected as busy; active system inhibitors (for example system update locks or backup operations) are respected and cause suspend requests to fail closed without retry.

### 11.2 Privileged Helper Enrollment & Hardening

The privileged helper binary `dam-hopper-idle-suspend-helper` executes the fixed suspend request with RTC wakealarm programming over a local Unix domain socket. In the Phase 03 release-manager path, the helper service itself binds `/run/dam-hopper/idle-suspend.sock` from its ExecStart arguments:

- **Manager-managed service**: `deploy/systemd/dam-hopper-idle-suspend-helper.service` runs the helper under strict systemd hardening:
  - `NoNewPrivileges=yes`
  - `ProtectSystem=strict`
  - `ProtectHome=yes`
  - `PrivateTmp=yes`
  - `CapabilityBoundingSet=CAP_WAKE_ALARM`
- **Socket permissions**: Tmpfiles owns the shared directory (`root:<API group>`, `3770`); the helper binds its socket with mode `0660`. The API PID file is API-owned and API-group-readable (`0640`), and enrollment pins the actual API UID as well as the PID.
- **Optional socket unit**: `deploy/systemd/dam-hopper-idle-suspend-helper.socket` is a packaged manual/socket-activation asset. The Phase 03 release manager stages and manages the helper **service**, not this `.socket` unit. Do not enable both direct-binding service mode and the socket unit for the same path.
- **Peer Credential Verification**: The helper validates peer UID and PID on connection via `SO_PEERCRED`, rejecting unauthorized callers.
- **Audit Trail**: The single `/var/log/dam-hopper/idle-suspend-helper.jsonl`
  file (mode `0600`) records request/authentication evidence plus v2
  capability, preflight, accepted-intent, RTC, suspend-invocation, and
  completion milestones. No parallel helper log is used.

The server always configures the systemd helper executor and checks the
configured socket's presence and health per request
(`DAM_HOPPER_IDLE_SUSPEND_SOCKET` overrides the default path), even when
automatic `[server.idle_suspend] enabled = false`. Automatic scheduling policy
and manual execution availability are separate; both still fail closed on
missing capability, RTC ownership, inhibitor, audit, or handoff prerequisites.

#### Phase 01 RTC and wake semantics

The helper protocol remains version 1 and accepts `wakeAfterSeconds: 0` or
`60..=86400` only. Zero is converted to clear-only mode: the helper writes
`0` to `/sys/class/rtc/rtc0/wakealarm`, reads it back, and skips target-epoch
calculation and writes. A timed value clears and verifies first, computes a
checked `now + seconds`, writes the target, and verifies the readback.

Peer authentication, protocol version checks, request-ID deduplication,
capability/inhibitor/RTC preflight, and the intent audit occur before RTC
mutation. Any busy alarm, audit-intent failure, clear/readback/write failure,
or unsupported capability suppresses suspend. Intent and completion records
retain `wakeAfterSeconds: 0`; the helper audit remains mode `0600` and bounded.
The server audit's recent-read APIs are capped; its append retention and
rotation are operator-managed.

#### Phase 04 helper audit v2

The helper audit evolves in place with independent schema version `2`; the
protocol remains version `1`, with the same required `requestId`/
`wakeAfterSeconds` fields and 4-KiB frame cap. Established
`acceptedIntent`, `executionCompleted`, and `executionRejected` records remain
readable, including legacy lines whose schema version is implicit v1.

New lines carry timestamp, canonical boot/producer identity, checked producer
sequence, safely available UUID correlation, numeric peer PID/UID, and closed
reason/outcome codes. Additive `recordType` values are `requestRejected`,
`capabilityResult`, `preflightResult`, `rtcProgrammingResult`, and
`suspendInvoked`. Capability probes and auth/frame failures use null
correlation when no validated action request ID exists. Restricted detail is
source-only and is not suitable for bundle projection.

The authoritative order is authenticate/decode/validate/deduplicate, emit
capability or preflight evidence, synchronously persist `acceptedIntent`,
program and verify RTC, emit the RTC result and `suspendInvoked`, invoke the
fixed suspend backend, then record the actual completion. Only intent sync
failure blocks RTC/suspend; later milestone write failures cannot rewrite the
backend outcome.

The file is capped at 10,000 records. Overflow pruning retains the newest
half through an exclusive mode-`0600` no-follow temporary file, syncs the
retained file and parent directory before atomic replacement, and removes the
temporary file on failure. A helper restart creates a new producer instance
and restarts its sequence at one.

The Phase 02 canonical server event stream is separate from both audit files.
The isolated writer targets
`/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`
with mode `0600`, no-follow append/sync semantics, and does not add a systemd
unit or `StateDirectory=` directive. Its parent is expected to be provisioned
by the API runtime path owner. Phase 03 passes the optional writer from
`AppState` into the coordinator; construction failure records a sanitized
backend diagnostic and disables only semantic emission, not API startup or
suspend/status behavior.

Do not qualify indefinite sleep from an automated test: repository tests use
temporary files and fake backends and never invoke `systemctl`, logind, or a
real RTC. A production indefinite canary requires explicit operations approval
and a verified physical or out-of-band wake path; use a bounded timed canary
first.

### 11.3 Boundary Verification

Run the non-privileged boundary verification script before deployment:

```bash
./scripts/verify-idle-suspend-boundary.sh
```

The script executes 14 static and presence checks. Check 13 verifies that both
API unit files declare `PIDFile=/run/dam-hopper/server.pid`, write `$MAINPID`
from `ExecStartPost`, and remove the PID from `ExecStopPost`. Check 14 verifies
that `HELPER_SERVICE_UNIT` is defined, staged, started by activation, and
included in status inspection.

For release-manager integration coverage, run:

```bash
cargo test --manifest-path server/Cargo.toml --test linux_release_staging
cargo test --manifest-path server/Cargo.toml --test linux_release_unit_policy
cargo run --manifest-path server/Cargo.toml --bin dam-hopper -- status --json
```

The staging suite covers helper hardening and fixed paths, API PID hooks,
server/web/both role projections, and helper status-role mapping. The status
smoke check should list API and helper under `role: "server"` (plus web and
recovery records when present). These checks do not invoke host suspend, logind,
or real RTC hardware; qualify a real host separately.

### 11.4 Rollback and Emergency Reset

To disenroll the helper and disable idle suspend, verify no active/in-flight handoff, then run:

```bash
./deploy/reset-linux-production.sh --dry-run --config /var/lib/dam-hopper/dam-hopper.toml
sudo ./deploy/reset-linux-production.sh --config /var/lib/dam-hopper/dam-hopper.toml
```

The default is `/var/lib/dam-hopper/dam-hopper.toml`; normal changes use authenticated API writes, not root file replacement. The live reset parses the installed API unit's exact non-root `User=`/`Group=`, refuses missing/link/non-regular or wrong-owner/group/mode (`0600`) files, and never repairs unsafe metadata. It drops to that API identity, writes a mode-`0600` same-directory temporary, `fsync`s, atomically renames, syncs the parent, and verifies parseable TOML with `[server.idle_suspend] enabled = false`.
If dry-run refuses, inspect `systemctl cat dam-hopper-api.service` and `stat`, restore trusted content/metadata through a controlled API-identity repair procedure, rerun dry-run, then run live reset. Preserve canonical/legacy config evidence, `/var/lib/dam-hopper/idle-suspend-audit.jsonl`, helper audit, and foreign RTC alarms.

Rollback guarantees:

1. Reset leaves services untouched until metadata and handoff checks pass.
2. It atomically disables `enabled = false` under `[server.idle_suspend]`.
3. It stops/disables helper units and removes only manifest-owned helper assets.
4. It preserves external RTC alarms.
5. It runs `systemctl daemon-reload` after unit removal.
6. It preserves audit logs for post-mortem analysis.

### 11.5 Manual Force Sleep Qualification & Canary Runbook

This is an operator procedure, not automated-test evidence. Automated checks use
fake RTC/executor backends and never invoke `systemctl`, logind, real RTC
hardware, or host suspend.

1. **Prerequisites Verification**:
   - Host kernel must support `/sys/class/rtc/rtc0/wakealarm`.
   - Verify exclusive RTC ownership: ensure `/sys/class/rtc/rtc0/wakealarm` is empty; preserve and investigate any foreign alarm.
   - In manager-managed service mode, verify `systemctl is-active dam-hopper-idle-suspend-helper.service` returns `active` and `test -S /run/dam-hopper/idle-suspend.sock` succeeds. The release manager does not enable the `.socket` unit. If a separate socket-unit enrollment is used, verify that socket instead and do not run the direct-binding service concurrently.
   - Verify database-backed authentication is functioning; `--no-auth` mode strictly prohibits manual sleep.
   - Verify the server status has no active/in-flight handoff and record the current status revision.

2. **Timed Canary Qualification (Required First)**:
   - Perform during an approved maintenance window with physical or out-of-band recovery.
   - Using the active authenticated profile, make exactly one manual POST with a bounded timer (for example `{ "wakeAfterSeconds": 120, "force": false }` when the fleet is quiescent). Do not retry an ambiguous response.
   - Monitor `/var/log/dam-hopper/idle-suspend-helper.jsonl` for the ordered
     preflight, intent, RTC, invocation, and completion milestones (exactly
     one `acceptedIntent` and `executionCompleted`) and the server
     `idle-suspend-audit.jsonl` for the actor/request outcome.
   - Confirm the machine suspends and automatically resumes within the approved tolerance.
   - Upon resume, refetch status and verify the status revision/`host:idleSuspendChanged` reconciliation, handoff release, and no duplicate suspend request.

3. **Indefinite Sleep Canary Protocol (High Risk)**:
   - **Warning**: Indefinite sleep (`wakeAfterSeconds: 0`) clears the RTC wakealarm (no auto-wake). The machine will NOT wake on a timer.
   - **Mandatory Requirements**:
     - Operations owner approval with assigned physical or out-of-band recovery personnel (for example IPMI/iLO/BMC, Wake-on-LAN, or physical power button).
     - Never execute an indefinite canary on a remote host without verified out-of-band power cycling capability.
     - Submit exactly one POST and never replay it after a network interruption.
   - Confirm post-resume status, audit, handoff, and PTY reconciliation once manually awakened.

### 11.6 Target-Host Observer Qualification (Configured-Agent Activity)

Before enabling the `agent-activity` automatic policy on any host, qualify that host's kernel, permissions, and service context:

1. **Kernel and Socket Diagnostic Prerequisite**:
   Verify that the kernel supports `NETLINK_SOCK_DIAG` socket diagnostics for `INET` and `INET6` sockets, and that `TCP_INFO` byte counters (`tcpi_bytes_received`, `tcpi_bytes_sent`) are populated.

2. **Procfs Visibility**:
   Verify that the user running `dam-hopper-api.service` can inspect `/proc/<pid>/stat`, `/proc/<pid>/cmdline`, and `/proc/<pid>/fd` for child processes spawned under managed PTY sessions.

3. **Execute Live Linux Smoke Suite**:
   Run the canonical integration check from a source checkout on the target host:

   ```bash
   cargo test --manifest-path server/Cargo.toml --test idle_suspend \
     activity_live_linux_pty_tcp_smoke -- --ignored --exact --nocapture --test-threads=1
   ```

   _Expected Result_: Test passes within 1.00 second (the Phase 08 QA run measured 0.74s). This is observer evidence only, not a target-host or suspend-canary guarantee. The test uses real Linux loopback TCP, managed PTYs, and direct procfs/netlink observation, with a panic executor that guarantees zero host suspend calls.
   Run the command from a source checkout with the deployed API service's
   effective UID/GID, procfs visibility, mount view, and network namespace (or
   an equivalent `systemd-run` sandbox). Do not add root privileges, capabilities,
   shell wrappers, or a broader namespace just to make the test pass; record the
   actual service-context result and shutdown/join latency.

4. **Sample Budget and Bounded Join**:
   Verify that observation samples consistently complete within the 1-second budget and that worker thread shutdown joins cleanly without hanging on stalled syscalls.

### 11.7 Protected Status Interpretation & Operator Reason Guide

The protected status endpoint (`GET /api/system/idle-suspend/v1/status`) reports `activity.measurementState` and `activity.reasonCode`. Use this guide to interpret status and determine appropriate operator action:

| Measurement / reason                   | Operator interpretation                                  | Action                                                                                |
| -------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `initializing` / null                  | No qualified baseline yet                                | Wait for a complete sample; do not enable automatic action based on it                |
| `available` / `recentInput`            | Accepted terminal input reset quiet globally             | Expected; countdown restarts                                                          |
| `available` / `recentOutput`           | Raw bytes arrived in an agent-owned/mixed terminal       | Expected; investigate noisy spinner/service only if false-busy matters                |
| `available` / `recentNetwork`          | Attributable TCP4/TCP6 socket changed                    | Expected; unchanged connection alone does not count                                   |
| `available` / `agentChanged`           | Relevant identity/socket baseline changed                | Expected conservative activity and fresh quiet window                                 |
| `available` / `lifecycleBusy`          | Create/restart/dispose/close/handoff blocks admission    | Wait for lifecycle settlement; do not override automatically                          |
| `available` / `quiet`                  | Complete heuristic sample, no recent qualifying activity | Candidate only; final fresh scan and admission checks still required                  |
| `available` / `epochSpent`             | This genuine-activity epoch already attempted            | No automatic retry until new genuine activity                                         |
| `unavailable` / `procAccess`           | Required proc identity/ownership inaccessible            | Fix service/proc permissions or roll back to `empty-fleet`                            |
| `unavailable` / `scanLimit`            | A hard bound made the sample incomplete                  | Reduce managed workload or stay on `empty-fleet`; never tune away bounds casually     |
| `unavailable` / `scanTimeout`          | Complete sample missed the 1s budget                     | Investigate target-host latency; no automatic claim                                   |
| `unavailable` / `socketDiagnostics`    | Direct kernel socket diagnostics/counters incomplete     | Verify kernel support/service sandbox; no fallback to interface traffic               |
| `unavailable` / `unsupportedTransport` | Attributable UDP/QUIC is present                         | Policy cannot qualify while present; use `empty-fleet` if workload requires it        |
| `unavailable` / `namespaceMismatch`    | Ownership crosses current network namespace              | Unsupported boundary; do not claim coverage                                           |
| `unavailable` / `staleObservation`     | Sample/ticket exceeded age or was invalidated            | Wait for fresh sample; repeated events indicate load/race issue                       |
| `unavailable` / `identityUncertain`    | PID/incarnation/root attribution cannot be proven        | Let workload settle/restart naturally or use `empty-fleet`; never kill it as recovery |
| `unavailable` / `counterOverflow`      | Monotonic evidence cannot be compared safely             | New incarnation/reconciliation required; no automatic claim                           |
| `unavailable` / `reconciling`          | Resume/outcome identity and baseline rebuild in progress | Wait; recovery is not new activity and does not re-arm a spent epoch                  |

### 11.8 Observation-Only Canary Soak Runbook

To validate activity observation on a candidate host without risking unexpected automatic sleep:

1. In `/var/lib/dam-hopper/dam-hopper.toml`, set:
   ```toml
   [server.idle_suspend]
   enabled = false
   automatic_policy = "agent-activity"
   agent_executables = ["codex", "omp", "claude", "agy"]
   ```
2. Restart the API service:
   ```bash
   sudo systemctl restart dam-hopper-api.service
   ```
3. Poll protected status and observe activity state:
   ```bash
   curl -s -H "Authorization: Bearer <operator-token>" \
     http://127.0.0.1:4801/api/system/idle-suspend/v1/status | jq .activity
   ```
4. Exercise workloads:
   - Start recognized agents (`claude`, `omp`, etc.) and observe `recentOutput` or `recentNetwork`.
   - Send interactive input to any terminal and observe `recentInput`.
   - Run service-only terminals and observe that they do not reset quiet.
   - Verify that when quiet time elapses, status reports `quiet`, but **zero** automatic suspend requests are made because `enabled = false`.
   - Verify that any measurement warning contains safe PID/identity examples without leaking command arguments or socket details.

The warning is an operational measurement report, not a countdown or completion
signal. When unavailable, `activity.measurementWarning` contains one continuous
`blockedSinceMs` interval, the closed reason, and at most 32 current attributable
`{ pid, executableIdentity }` examples in positive PID order. Identity is nullable
and capped at 256 UTF-8 bytes without controls. Cause/PID changes preserve the
interval; complete available recovery clears it, and a later failure starts a new
interval. The warning appears only in authenticated, `Cache-Control: no-store`
status; logs, audits, WebSocket hints, and rollout artifacts contain no process
details.

### 11.9 Bounded Automatic Canary Runbook (Operations Gate)

Executing a real automatic host suspend canary is an explicit Operations procedure requiring written approval:

1. **Approval Prerequisites**:
   - Designated host owner, scheduled maintenance window, and on-call rollback engineer.
   - Verified physical or BMC/IPMI out-of-band power access.
   - Clean RTC status: `/sys/class/rtc/rtc0/wakealarm` must be empty.
   - Zero system sleep inhibitors: `systemd-inhibit --list` must show no active inhibitors.
   - Verify database-backed authentication, helper service/socket capability, and
     a clean status with no active or in-flight handoff.

2. **Enablement**:
   In `/var/lib/dam-hopper/dam-hopper.toml`, set:

   ```toml
   [server.idle_suspend]
   enabled = true
   automatic_policy = "agent-activity"
   quiet_period_seconds = 900
   wake_after_seconds = 180
   ```

   Restart API: `sudo systemctl restart dam-hopper-api.service`.

3. **Execution and Verification**:
   - Generate one genuine activity epoch with a recognized agent.
   - Allow the agent to finish and the quiet period to elapse.
   - Observe machine suspension and automatic wake at the scheduled RTC time (180s).
   - Upon wake, refetch status and verify:
     - `state` reconciled to `watching` or `armed`.
     - `currentEpoch` advanced, latching the spent epoch.
     - Helper audit `/var/log/dam-hopper/idle-suspend-helper.jsonl` contains
       exactly one `acceptedIntent` and one `executionCompleted`, plus the
       expected preflight, RTC-programming, and suspend-invocation milestones.
     - Server audit `idle-suspend-audit.jsonl` contains the matching handoff record.
     - No duplicate suspend request is issued while conditions remain unchanged.

### 11.10 Controlled Rollout Stop Criteria

Immediately halt rollout and execute rollback upon encountering any of the following:

1. **Unexpected Suspend**: Host suspends while an attributable agent is actively producing network or PTY traffic, or while a service-only workload was unintentionally treated as eligible.
2. **Missed RTC Wake**: Host fails to resume automatically within approved timer tolerance.
3. **Duplicate Handoff**: More than one handoff is dispatched within the same activity epoch.
4. **Stuck Handoff**: Server remains in `handedOff` state without post-resume reconciliation.
5. **False Quiet**: Status reports `quiet` during known active agent computation or unobserved transport activity.
6. **Persistent Unavailable**: Repeated `scanTimeout`, `scanLimit`, `procAccess`, `socketDiagnostics`, `unsupportedTransport`, `namespaceMismatch`, `identityUncertain`, `counterOverflow`, or `reconciling` warnings.
7. **Budget or Join Failure**: Sampling exceeds the one-second deadline, or shutdown cannot join the sampler cleanly.
8. **Privacy Leakage**: Any command arguments, environment variables, matcher entries, socket addresses, terminal content, or raw diagnostics appear in status warnings, logs, audits, WebSocket hints, or rollout artifacts.
9. **Lost Reconciliation**: PTY/process baselines, helper outcome, audit chain, or status revision cannot be reconciled after resume.

### 11.11 Rollback and Emergency Disable Procedures

#### Level 1: Activity Policy Rollback

Restores legacy zero-active-fleet behavior without disturbing helper enrollment or manual sleep:

1. Refetch protected status and ensure there is no `finalCheck`, `handedOff`, or
   active handoff. Reconcile an accepted handoff before restarting; a config edit
   is not cancellation.
2. Back up `/var/lib/dam-hopper/dam-hopper.toml` while preserving owner and mode.
3. Edit the active registry:
   ```toml
   [server.idle_suspend]
   automatic_policy = "empty-fleet"
   ```
4. Restart the API:
   ```bash
   sudo systemctl restart dam-hopper-api.service
   ```
5. Verify status:
   ```bash
   curl -s -H "Authorization: Bearer <operator-token>" \
     http://127.0.0.1:4801/api/system/idle-suspend/v1/status | jq '{automaticPolicy, activity, state}'
   ```
   Require `automaticPolicy: "empty-fleet"` and `activity: null`.

#### Emergency Disable

Immediately disables all automatic idle-suspend scheduling:

1. Refetch protected status and resolve any accepted handoff before restarting.
2. In `/var/lib/dam-hopper/dam-hopper.toml`, set `enabled = false` and `automatic_policy = "empty-fleet"`.
3. Restart the API: `sudo systemctl restart dam-hopper-api.service`.
4. Verify `state: "disabled"` and `activity: null`.

#### Level 2: Complete Disenrollment & Helper Removal

To completely remove helper units and restore pristine host configuration, use the root disenrollment script:

```bash
sudo ./deploy/reset-linux-production.sh --dry-run
sudo ./deploy/reset-linux-production.sh
```

---



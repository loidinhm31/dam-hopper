# Documentation Reader Report: Terminal Idle Suspend & Linux systemd Integration

**Date:** 2026-10-05  
**Target Documents:**
1. `docs/terminal-idle-suspend-security.md`
2. `docs/linux-systemd.md`
3. `docs/pty-activity-observation.md`
4. `docs/agent-activity-automatic-admission.md`

---

## 1. Document Purposes

### 1.1 `docs/terminal-idle-suspend-security.md`
- **Purpose:** Authoritative security specification, threat model, approval requirements, and phase-by-phase implementation invariants for opt-in Linux host suspend with RTC wake.
- **Coverage:** Spans Phases 01 through 08. Governs both automatic scheduling policies (`empty-fleet` and `agent-activity`) and authenticated manual force-suspend (`POST /api/system/idle-suspend/v1/force-suspend`).
- **Scope:** Details privileged helper interaction, kernel procfs and netlink observation security, same-origin/CORS transport protection, semantic event logging, audit trails, and canary operational gates.

### 1.2 `docs/linux-systemd.md`
- **Purpose:** Comprehensive deployment, operations, and lifecycle guide for Linux x86_64 host environments managed by systemd.
- **Coverage:** Defines system requirements (glibc >= 2.39, systemd >= 245, unified cgroup v2), the 4 immutable release artifacts, service roles (`server`, `web`, `both`), and the 4 managed systemd units.
- **Scope:** Covers non-root installation (`dam-hopper-install.sh`), transaction-safe 2-step activation with 20-probe health gate, automatic rollback, boot recovery, legacy format-2 migration, diagnostics collection (`dam-hopper diagnose --json`), and the recent Native Advisor migration / Plugin Platform retirement runbook.

### 1.3 `docs/pty-activity-observation.md`
- **Purpose:** Canonical implementation specification for the private, content-free PTY evidence seam (Phase 02).
- **Coverage:** Serves as the foundational observation layer utilized by downstream configured-agent idle-suspend phases.
- **Scope:** Documents child process identity capture (`pid`, `start_ticks`), monotonic raw PTY read sequence counting (`Arc<AtomicU64>`), manager input admission fences (`input_revision`, `last_input_at`), bounded activity snapshots (`MAX_LIVE_ROOTS_LIMIT = 256`), and Tokio watch invalidation channels without inspecting terminal bytes, commands, or environment variables.

### 1.4 `docs/agent-activity-automatic-admission.md`
- **Purpose:** Canonical integration specification for the Linux `agent-activity` coordinator layer (Phases 05–07).
- **Coverage:** Bridges low-level PTY, process, and owned-TCP evidence into generation-fenced automatic suspend handoffs.
- **Scope:** Specifies the asynchronous sampling loop running on a dedicated joinable OS thread (`idle-suspend-sampler`), the 8-step transactional sampling pipeline, delta classification hierarchy, manager-locked handoff admission, the protected status DTO (`GET /api/system/idle-suspend/v1/status`), and strict privacy projection boundaries.

---

## 2. Key Sections, Security Boundaries, and systemd Integration Concepts

### 2.1 Security Invariants & Boundaries (`docs/terminal-idle-suspend-security.md`)

- **Startup Ownership & Immutability:** Feature enablement (`enabled`), helper enrollment (`enrollment_reference`), capability mode (`capability_selection`), automatic policy (`automatic_policy`), and validated agent executable matchers (`agent_executables`) are immutably captured at server boot from `/var/lib/dam-hopper/dam-hopper.toml`. They cannot be altered via workspace switch, config reload, full config update (`PUT /api/config`), or settings import.
- **Zero Sudo & Zero Shell Execution:** The server never invokes `sudo`, shell pipelines, arbitrary command strings, or user-supplied executable paths. Local IPC with the privileged helper uses a fixed JSON DTO (`SuspendWithRtcWakeRequest`) over a local Unix domain socket.
- **Narrow Action & Timing Authority:**
  - Automatic timing mutations are restricted to `60..=86400` seconds via `PATCH /api/system/idle-suspend/v1/timing`.
  - Manual force-suspend is exposed exclusively through `POST /api/system/idle-suspend/v1/force-suspend`, requiring database authentication, cookie same-origin validation, 16 KiB body limit, and explicit active-fleet confirmation.
  - The execution domain allows `wakeAfterSeconds: 0` as a numeric sentinel for indefinite sleep exclusively in manual execution; automatic timing strictly rejects `< 60`.
- **Fail-Closed by Default:** Unsupported platforms, missing helper enrollment, sleep inhibitors, missing RTC alarms, or audit persistence failures prevent suspend entirely without automatic retries.
- **No-Auth Mode Rejection:** Development/no-auth mode explicitly rejects timing mutations and manual force-suspend with HTTP 403 (`idleSuspendTimingDisabledNoAuth`, `idleSuspendDisabledNoAuth`).
- **Triple Audit & Event Trail System:**
  1. *Server Timing/Manual Audit:* `/var/lib/dam-hopper/idle-suspend-audit.jsonl` (mode `0600`, `O_NOFOLLOW`, 10,000 read cap, append-only, no in-process truncation).
  2. *Server Semantic Event Writer (Phases 02–03):* `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` (schema v1, UUID v4 correlation, monotonic checked producer sequence, 16 KiB/line cap, mode `0600`, `sync_data()`).
  3. *Privileged Helper Audit v2 (Phase 04):* `/var/log/dam-hopper/idle-suspend-helper.jsonl` (schema v2, 10,000 record cap with atomic in-place pruning of oldest half, milestone records: `RequestRejected`, `CapabilityResult`, `PreflightResult`, `RtcProgrammingResult`, `SuspendInvoked`).
- **Transport & Origin Security:** Cookie requests require strict same-origin (`Host` match) or explicit `DAM_HOPPER_CORS_ORIGINS` trust. Requests presenting `Authorization: Bearer <token>` are exempt from cookie CSRF origin checks.
- **Unprivileged Procfs & Netlink Seam (Phase 08):** Activity observer runs under the unprivileged API UID/GID, utilizing read-only `/proc` access and unprivileged `NETLINK_SOCK_DIAG` sockets for TCP diagnostics; requires no root privileges, capabilities, eBPF, or cgroups.
- **Privacy Boundary:** Terminal bytes, command arguments, environment variables, socket addresses/ports/inodes, session IDs, root IDs, and auth tokens never enter status DTOs, audits, logs, or WebSocket hints. Public warnings project at most 32 deduplicated PIDs + safe executable identities (max 256 bytes, no control chars).

### 2.2 Systemd Integration & Host Lifecycle (`docs/linux-systemd.md`)

- **Host Service Topology (4 Units):**
  - `dam-hopper-recovery.service`: Root-owned oneshot pre-boot gate ordered after `local-fs.target` and before API/web units; reconciles interrupted transactions in `state.json` and triggers emergency rollback if needed.
  - `dam-hopper-idle-suspend-helper.service`: Root-owned helper running in rendered API group (`root:dam-hopper`), listening on `/run/dam-hopper/idle-suspend.sock`. Sandboxed with `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, and `CapabilityBoundingSet=CAP_WAKE_ALARM`.
  - `dam-hopper-api.service`: Dedicated application service running as unprivileged `dam-hopper:dam-hopper` on `0.0.0.0:4801`. Runs with `NoNewPrivileges=false` (to permit PTY spawning).
  - `dam-hopper-web.service`: Static SPA web host running as `dam-hopper-web:dam-hopper-web` on `0.0.0.0:4802`.
- **Runtime Directory & PID Enrollment:**
  - Shared runtime directory `/run/dam-hopper` managed by tmpfiles (`dam-hopper-runtime.conf`) at mode `3770` (`root:dam-hopper`).
  - `dam-hopper-api.service` declares `PIDFile=/run/dam-hopper/server.pid`, writes `$MAINPID` via `ExecStartPost`, and cleans up via `ExecStopPost`.
  - The helper passes `--enrolled-pid-file /run/dam-hopper/server.pid` and verifies caller PID and UID via `SO_PEERCRED`.
- **Release Lifecycle & Health Gates:**
  - `dam-hopper-install.sh` extracts candidate files, renders units, and writes candidate state to `state.json` marked `PENDING` without modifying live services.
  - `sudo dam-hopper start` acquires `/run/lock/dam-hopper/deploy.lock`, quiesces existing services, backs up active units/config, installs concrete units in `/etc/systemd/system/`, executes `systemctl daemon-reload`, starts helper then API/web, and enters `PROBING`.
  - Health Gate: Requires API/web active within 20s startup deadline, followed by 20 consecutive successful probes spaced at 500ms (10s continuous stability). Failure triggers automatic rollback to backups.
- **Production Diagnostics Collector (`dam-hopper diagnose --json`):**
  - Standalone one-shot collector generating an atomic mode-`0600` bundle (`bundleSchemaVersion: 1`).
  - Gathers server events/audit, helper audit, systemd unit status, journald metadata, loopback idle-status API, and host probes. Excludes tokens, credentials, terminal text, arguments, environment, and socket IPs.
- **Plugin Platform Retirement:**
  - Document details complete retirement of `dam-hopper-plugin-runner.service`, `/run/dam-hopper/plugin-runner.sock`, and plugin tmpfiles.
  - Replaced by native-compiled Native Advisor (`/api/advisor/*`).

### 2.3 PTY Evidence Seam (`docs/pty-activity-observation.md`)

- **Identity Types:**
  - `ProcessIdentity`: Immutable pair of child OS PID and kernel boot-tick start time (`start_ticks` from field 22 of `/proc/<pid>/stat`), preventing PID reuse attacks.
  - `TerminalIdentity`: Public `session_id` paired with monotonic `incarnation`.
  - `RootQualification`: `Qualified { identity }`, `Uncertain { pid, reason }`, `Unavailable { reason }`.
- **Raw PTY Output Counter:**
  - Per-incarnation `Arc<AtomicU64>` raw-output sequence incremented on every nonempty `reader.read()` before parsing, buffering, scrollback, or broadcast.
  - Saturated sentinel at `u64::MAX` (`SATURATED_COUNTER_SENTINEL`), never wraps. Replay, attach, resize do not increment it.
- **Input Admission Fencing:**
  - Manager-wide `input_revision` and `last_input_at: Option<Instant>`.
  - Nonempty input rejected during active handoff (`AppError::IdleSuspendHandoffInProgress`) or saturated revision.
  - Empty input is a no-op; failed writes roll back revision/timestamp.
- **Bounded Activity Snapshot (`PtyActivitySnapshot`):**
  - Limits live root scan to `MAX_LIVE_ROOTS_LIMIT = 256`. Exceeding limit produces `ScanLimitExceeded`.
  - Other incomplete reasons: `RootUnqualified`, `CounterSaturated`, `RevisionSaturated`.
  - Incomplete snapshots fail closed (never treated as quiet or zero-agent).
- **Private Invalidation Seam (`PtyActivityWatcher`):** Tokio `watch::Receiver<u64>` coalescing activity invalidations for the coordinator without logging content.

### 2.4 Transactional Sampling & Automatic Admission (`docs/agent-activity-automatic-admission.md`)

- **Topology:** Asynchronous coordinator Tokio task communicates via one-slot mailbox with a dedicated joinable `idle-suspend-sampler` OS thread. That worker owns stateful `ProcessDiscovery` and `TcpObserver` instances.
- **Transactional 8-Step Sampling Pipeline:**
  1. Capture initial manager-locked PTY snapshot.
  2. Prepare bounded Linux procfs process evidence (PID walk, exact entrypoint matcher).
  3. Prepare unprivileged `NETLINK_SOCK_DIAG` TCP byte counters.
  4. Verify raw output checkpoints against start sequence and accepted-end map.
  5. Recheck deadline/cancellation and capture 2nd PTY snapshot (verifying generation and input revision).
  6. Commit both baselines back-to-back only if all fences pass.
  7. Classify delta (Priority: `RecentInput` > `RecentOutput` > `RecentNetwork` > `AgentChanged` > `LifecycleBusy` > `BaselineEstablished` > `Unchanged`).
  8. Build observation; issue opaque `ActivityClaimTicket` only for unchanged `Final` sample.
- **Manager-Locked Final Admission Gate:**
  Coordinator presents ticket to `PtySessionManager::try_claim_agent_activity_handoff`. Under manager lock, validates:
  - Startup policy is `AgentActivity` and enabled.
  - Revisions match (request ID, activity revision, epoch revision, timing revision).
  - Quiet deadline expired (`now >= eligibility_deadline`).
  - Observation freshness <= 5 seconds.
  - Input revision equals ticket input revision.
  - Fleet generation equals ticket generation.
  - Live root count and exact qualified `(pid, start_ticks)` roots match.
  - Raw output counters have not advanced.
  - Fleet lifecycle not busy, closing, or disposing.
- **Spent Epoch Latch:** Successful admission latches epoch activity revision as spent (`EpochSpent`), preventing immediate re-triggering upon resume without new genuine activity.

---

## 3. Areas Needing Update or Synchronization with Latest Codebase Changes

### 3.1 `docs/linux-systemd.md`

1. **Discrepancy in API Service `ExecStartPre` Directives:**
   - *Current Documentation (Section 3):* States: *"It has exactly one privileged `ExecStartPre=+/opt/dam-hopper/current/bin/dam-hopper-manager provision-api-runtime` and exactly one `ExecStart`"*.
   - *Actual Codebase:* Both `deploy/systemd/dam-hopper-api.service.in` and checked-in `deploy/systemd/dam-hopper-api.service` contain **two** privileged `ExecStartPre` commands:
     ```systemd
     ExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf
     ExecStartPre=+/opt/dam-hopper/current/bin/dam-hopper-manager provision-api-runtime
     ```
   - *Action Needed:* Update Section 3 to document both required `ExecStartPre` commands and their execution ordering.

2. **Helper Service `ExecStart` Flag Alignment:**
   - *Template & Policy Enforcement:* In `deploy/systemd/dam-hopper-idle-suspend-helper.service.in` and `server/src/linux_release/unit_policy.rs`, `ExecStart` requires `--enrolled-uid @API_UID@`.
   - *Static Checked-in Unit:* `deploy/systemd/dam-hopper-idle-suspend-helper.service` omits `--enrolled-uid`.
   - *Action Needed:* Synchronize static checked-in unit and documentation with the release manager policy validation rule.

3. **Section Numbering Glitch:**
   - *Issue:* Section 10 ("Retired Checkout-Runner Commands") is followed by an unnumbered "Terminal Idle Suspend Runbook" heading, which immediately leads to "12. Operator Runbook: Native Advisor Migration & Plugin Platform Retirement". Section 11 is omitted/missing.
   - *Action Needed:* Number the "Terminal Idle Suspend Runbook" as Section 11 or re-index Section 12 to 11.

4. **Outdated Sample Version Numbers:**
   - *Issue:* References throughout the text cite `v0.1.0`, `v0.2.0`, and `v0.5.0/v0.5.1` advisory, whereas the current repository baseline is `v0.10.2` (`server/Cargo.toml`).
   - *Action Needed:* Update sample release tags, API health payload examples, and installation snippets to align with the active version baseline.

5. **Manager State Schema Version:**
   - *Note:* State schema upgraded to schema 3 with `state.v2.bak` backup during runner retirement. The text correctly mentions this in Section 12, but Section 4 filesystem layout could explicitly reference `state.v2.bak` under `/var/lib/dam-hopper-manager/`.

### 3.2 `docs/terminal-idle-suspend-security.md`

1. **Cross-Platform Compilation & Windows Stubs:**
   - *Codebase Evolution:* Recent commit (`3690ea85`) introduced conditional compilation guards (`#[cfg(target_os = "linux")]` vs `#[cfg(not(target_os = "linux"))]`) and stub implementations across `server/src/idle_suspend/activity/sampler.rs`, `server/src/idle_suspend/helper_client.rs`, and `server/src/bin/dam-hopper-idle-suspend-helper.rs`.
   - *Documentation Gap:* While the document notes that unsupported platforms fail closed, it lacks explicit architectural documentation explaining that on Windows/macOS, idle suspend components are compile-time stubbed or return immediate `Unavailable` errors rather than executing runtime procfs probes.
   - *Action Needed:* Document cross-platform compilation behavior and the absence of procfs/netlink observers on non-Linux platforms.

2. **Canary Operational Status Tracking:**
   - *Issue:* Section "Unresolved questions (configured-agent automatic-suspend canary)" remains open with operational questions about target-host canary feasibility (exclusive `rtc0` reservation, 1s netlink budget on virtualized kernels, out-of-band power recovery).
   - *Action Needed:* Clarify whether automated staging canaries have progressed or if automatic suspend remains strictly gated for production canaries.

### 3.3 `docs/pty-activity-observation.md`

1. **Test Suite Coverage Metrics:**
   - *Issue:* Verification coverage references historical test metrics ("159 passed PTY-module tests with one pre-existing ignored performance test"). Subsequent PTY buffer and WebSocket rendering refactors (commit `c31455f9`) expanded the PTY test suite to thousands of test assertions.
   - *Action Needed:* Generalize or refresh specific test count figures to reflect the ongoing maintenance baseline.

2. **Non-Linux Child Process Probing:**
   - *Codebase Evolution:* On Windows, PTY spawning does not read `/proc/<pid>/stat` and sets root qualification to `Unavailable`.
   - *Action Needed:* Explicitly document non-Linux fallback behavior for `RootQualification` in Section 3.

### 3.4 `docs/agent-activity-automatic-admission.md`

1. **Semantic Event Writer Integration Details:**
   - *Codebase Evolution:* The coordinator now actively emits canonical semantic events via `IdleSuspendEventWriter` to `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl` during lifecycle transitions (`AttemptStartedDataV1`, `FinalCheckStartedDataV1`, `FinalCheckCompletedDataV1`, `HandoffClaimAcceptedDataV1`, `HandoffClaimRejectedDataV1`, `HelperRequestDispatchedDataV1`, `HelperOutcomeReceivedDataV1`, `ReconciliationCompletedDataV1`).
   - *Documentation Gap:* While detailed in `terminal-idle-suspend-security.md`, this integration is not referenced in `agent-activity-automatic-admission.md`.
   - *Action Needed:* Add a section or note linking the coordinator state machine steps to their corresponding semantic event emission points.

2. **Helper Audit Milestone Alignment:**
   - *Note:* The Phase 04 helper audit v2 milestone sequence (`AcceptedIntent`, `PreflightResult`, `RtcProgrammingResult`, `SuspendInvoked`, `ExecutionCompleted`) should be referenced in the coordinator handoff execution flow.

---

## 4. Unresolved Questions

1. Should the static checked-in unit file `deploy/systemd/dam-hopper-idle-suspend-helper.service` be updated immediately to include `--enrolled-uid` to match `unit_policy.rs` expectations, or is it intentionally kept as a generic template fallback?
2. Has an Operations host owner been designated for the first physical `agent-activity` automatic canary with verified out-of-band IPMI recovery, or does deployment policy mandate keeping `empty-fleet` as the sole production-enabled policy?

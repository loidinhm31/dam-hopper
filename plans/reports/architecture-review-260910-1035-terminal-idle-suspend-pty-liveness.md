# Architecture Review: Terminal Idle Suspend Condition & PTY Liveness

- **Document**: `plans/reports/architecture-review-260910-1035-terminal-idle-suspend-pty-liveness.md`
- **Context**: Review of sleep trigger condition in `plans/260824-0312-terminal-idle-suspend/plan.md` and current server implementation (`server/src/pty/`, `server/src/idle_suspend/`).
- **Focus**: How the system decides whether a terminal via PTY is still working (running) vs idle/stopped.
- **Date**: 2026-09-10
- **Author**: Senior Systems Architect (Orchestrating Systems Designer, Technology Strategist, Scalability Consultant, Risk Analyst)

---

## 1. Architecture Analysis

### 1.1 Technical Challenge & Scope
The core problem is: **How can a server-authoritative backend reliably and safely trigger a Linux host-wide machine sleep (e.g. ACPI S3 via `rtcwake`) based on terminal fleet idleness without corrupting active workloads or suspending while a user is working?**

Host suspend is **global and destructive to network/interactive continuity**:
- If the machine sleeps while a terminal is compiling, running tests, or serving requests, the user workload freezes or dies.
- If the machine sleeps while a user is actively typing or watching terminal output, user trust is destroyed.
- If the condition check is too loose, the machine never sleeps; if too eager or based on transient states, it sleeps prematurely.

### 1.2 The Plan's Design vs. Current Implementation

| Dimension | Plan (`plans/260824-0312-terminal-idle-suspend/plan.md`) | Current Implementation (`server/src/`) |
|---|---|---|
| **Authoritative State** | Server PTY fleet under manager mutex; client output/presence never authorizes sleep. | Implemented in `PtyFleetState` under `PtySessionManager::Inner` mutex. |
| **Liveness Definition** | Zero `live`, `creating`, or `restart_pending` PTYs. Output silence, tombstones, and WS clients excluded. | Exactly matched in `PtyFleetSnapshot::is_quiescent()`. |
| **Observation Seam** | Monotonic generation-based watch channel. | `PtyFleetWatcher` over `tokio::sync::watch::channel(PtyFleetSnapshot)`. |
| **Quiet Period & Debounce** | Configurable `quiet_period_seconds` countdown triggered only on active -> quiescent transition. | Implemented in `IdleSuspendCoordinator::run_coordinator` (`handle_fleet`). |
| **Admission Gate (Final Check)** | Atomic generation-fenced claim before handoff to executor; locks out new PTY creation during suspend. | `PtyFleetState::try_claim_handoff(expected_gen)` atomically sets `handoff_active = true`. |
| **Privileged Execution** | Single-flight, root-owned helper over Unix socket with `SO_PEERCRED` validation. | Implemented in `dam-hopper-idle-suspend-helper` via `/run/dam-hopper/idle-suspend.sock`. |

### 1.3 Deep Dive: How the System Decides a PTY Terminal is Still Working (Running)

The architecture makes a radical, deliberate choice: **"Running" strictly means OS process/PTY file-descriptor liveness. It NEVER means terminal inactivity, output silence, or prompt waiting.**

```mermaid
flowchart TD
    subgraph PTY_Liveness_Detection["PTY Liveness Determination Engine"]
        A[User/CLI starts Terminal] --> B[begin_create: creating_count + 1]
        B --> C[portable_pty spawn process]
        C --> D[publish_live: live_count + 1, creating - 1]
        D --> E[Master PTY Reader Loop]
        E -->|Data flowing| E
        E -->|Child exits / Slave closes| F[Reader receives EOF / EIO]
        F --> G[child.wait returns ExitStatus]
        G --> H{Will Restart?}
        H -->|Yes| I[transition_live_to_restart_pending]
        H -->|No| J[remove_live: live_count - 1]
        J --> K[DeadSession tombstone created in inner.dead]
    end

    subgraph Quiescence_Evaluation["Quiescence Predicate"]
        L[PtyFleetSnapshot]
        L --> M{live_count == 0?}
        M -->|No| N[NOT Quiescent: Machine CANNOT Sleep]
        M -->|Yes| O{creating_count == 0?}
        O -->|No| N
        O -->|Yes| P{restart_pending_count == 0?}
        P -->|No| N
        P -->|Yes| Q{disposing || closing || handoff_active?}
        Q -->|Yes| N
        Q -->|No| R[QUIESCENT: Arm countdown timer]
    end
```

#### What Counts as "Running" (`!is_quiescent()`):
1. **`live_count > 0`**: An OS process handle exists in `inner.live`. The PTY slave fd is open, and the background PTY master reader thread has not encountered EOF.
2. **`creating_count > 0`**: A terminal spawn request has been admitted via `begin_create(&id, incarnation)`, reserving non-quiescent state while the manager mutex is temporarily released during slow OS process creation.
3. **`restart_pending_count > 0`**: A process with restart policy (`Always` or `OnFailure`) exited, but the supervisor loop is waiting in backoff before respawning (`transition_live_to_restart_pending`).

#### What Explicitly DOES NOT Count as "Running":
1. **Prompt Waiting / Output Silence**: A shell (e.g. `bash`, `zsh`) sitting idle at a prompt (`user@host:~$ `) has emitted zero bytes for 5 hours. **It is STILL considered running (`live_count == 1`). The machine will NOT sleep.**
2. **Web Browser / WebSocket Disconnection**: If a user closes all browser tabs and walks away, but leaves 1 terminal tab open on the server, the server keeps the process running. **The machine will NOT sleep.**
3. **Dead Tombstones (`inner.dead`)**: Sessions that exited cleanly or crashed are retained in `inner.dead` for 60 seconds so frontend clients can replay the scrollback buffer. **These do NOT count as running.**
4. **Shell Prompt Lifecycle State (`shell_lifecycle.rs`)**: Shell OSC 133 / escape sequence integration emits `Editing`, `Running`, or `Finished`. **The coordinator deliberately ignores this** to avoid false-idle bugs (e.g. commands that run without terminal integration or long-running builds with no output).

---

## 2. Design Recommendations

### 2.1 The Core Dilemma: Fleet Emptiness vs. Process Inactivity
The current design achieves **100% safety against destroying active terminals**, but has a glaring **practical usability limitation**:

> **Brutal Reality**: Developers almost *never* type `exit` or close every terminal tab before walking away from their workstation. In real-world usage, a developer leaves 2-3 terminal tabs open in the web IDE. Under the current implementation, `live_count` will remain `>= 1` forever, and **the machine will never auto-suspend**.

### 2.2 Architectural Recommendation Matrix

| Approach | Safety | Complexity | Real-World Utility | Recommendation |
|---|---|---|---|---|
| **Option A: Pure Fleet Emptiness (Current)** | 100% Fail-safe | Minimal (KISS) | Low (requires explicit terminal exit/kill) | **Keep as foundational baseline.** |
| **Option B: Shell Prompt Idle Detection (`shell_lifecycle`)** | Medium | High | High (sleeps when all terminals are at prompt) | **Reject for v1.** Too fragile: background jobs (`&`, `nohup`), non-integrated shells (PowerShell, custom binaries) break. |
| **Option C: Process Tree & CPU Activity Sieve (Enhanced Quiescence)** | High | Moderate | High (sleeps when fleet has no active child processes + CPU < threshold) | **Recommended for v2.** Inspect child PIDs of shell; if only shell leader exists and CPU/PSI is idle for quiet period, allow suspend. |
| **Option D: Web Client Absence Timeout (Keep-Alive Lease)** | High | Low | High (if 0 web clients connected AND all terminals idle at prompt for N minutes) | **Consider as opt-in policy.** |

### 2.3 Foundational Design Invariants to Retain (YAGNI & KISS)
1. **Server-Authoritative Gate**: The browser must never directly issue sleep commands or supply raw shell commands.
2. **Generation-Fenced Handoff Claim**: The atomic claim in `try_claim_handoff(expected_gen)` under the `PtySessionManager` mutex guarantees that no new terminal can spawn while suspend handoff is in flight.
3. **Fail-Closed on Capability / Inhibitor**: If systemd inhibitors exist (e.g. package manager running) or RTC wake is unavailable, suppress suspend rather than risking an un-wakeable machine.

---

## 3. Technology Guidance

### 3.1 PTY Termination Mechanics (Linux / POSIX)
- **Mechanism**: The backend uses `portable-pty`. The reader loop reads chunks from the master PTY descriptor.
- **Exit Detection**: When the child process exits, the operating system closes all open slave fds (unless a disowned grandchild kept it open). The kernel signals EOF/EIO on the master PTY descriptor.
- **Risk Identified**: If a user runs `nohup ./server &` or a daemon that inherits stdin/stdout/stderr from the PTY, the slave fd remains open even after the user exits the parent shell! The reader loop will **not** see EOF, and the PTY session remains stuck in `live`.
  - *Mitigation*: Ensure terminal child processes are spawned in dedicated process groups and tracked with session leader process monitoring.

### 3.2 Coordinator State Machine & Epoch Mechanics
The coordinator state machine in `server/src/idle_suspend/coordinator.rs`:
- States: `Disabled -> Watching <-> Armed -> FinalCheck -> HandedOff -> Resumed | Suppressed | Failed`.
- **The "One Attempt Per Epoch" Invariant**:
  - Once a suspend executes and resumes (or is suppressed/fails), the state enters `Resumed` / `Suppressed` / `Failed`.
  - Line 707 of `coordinator.rs` requires `*seen_non_quiescent == true` before arming another epoch.
  - **Trade-off Analysis**: This prevents an infinite sleep-wake-sleep loop if the machine wakes via RTC and the fleet is still empty. However, it also means that after waking, the machine will **never sleep again** until a user explicitly opens and closes another terminal!

### 3.3 The Clean Boot Deadlock
- In `coordinator.rs:300`:
  ```rust
  let mut seen_non_quiescent = !initial_snapshot.is_quiescent();
  ```
- If the server boots cleanly with zero persisted terminals, `initial_snapshot.is_quiescent() == true`, so `seen_non_quiescent = false`.
- **Result**: The coordinator stays in `Watching` forever. It will **never arm** on a clean boot until at least one terminal is created and closed!
- *Architectural Assessment*: This violates Principle of Least Surprise. If an idle machine boots up without sessions, it should be eligible for idle suspend after the quiet period.

---

## 4. Implementation Strategy

### Phase 1: Fix Architectural Edge Cases in Current Model (Immediate)
1. **Clean Boot Stabilization**: Allow arming if initial state is quiescent, but require a startup stabilization delay (e.g. `quiet_period_seconds` from server boot) before arming, rather than deadlocking on `seen_non_quiescent == false`.
2. **Post-Resume Idle Timer**: After `SuspendOutcome::ResumedSuccessfully`, do not require an active terminal before re-arming; instead, require a post-resume quiet window (e.g. 15-30 minutes) before a second sleep attempt to break infinite sleep loops safely.

### Phase 2: Process-Group & Foreground Job Awareness (v2)
1. Query the foreground process group of the master PTY (`tcgetpgrp(master_fd)`).
2. If `foreground_pgid == shell_pgid`, the shell is waiting at the prompt (no foreground command like `make` or `cargo` is executing).
3. Combine prompt state with system Linux PSI / CPU metrics (`server/src/system/linux/psi.rs`).

---

## 5. Next Actions

1. **Verify Clean Boot Behavior**: Write an integration test in `server/src/idle_suspend/tests.rs` asserting coordinator behavior when launched with 0 terminals.
2. **Review UX Expectation with Product Owner**: Confirm whether "idle suspend" was intended solely for "all terminal tabs closed" (current plan) or "all terminal tabs idle at prompt" (future expansion).
3. **Audit Slave FD Inheritance**: Test whether backgrounded processes (`nohup sleep 1000 &`) prevent terminal exit in `PtySessionManager`.

---

## 6. Unresolved Questions

1. **User Workflow Invariant**: Is the requirement that users must close their terminal tabs acceptable for production v1, or must idle prompt detection be supported before release?
2. **Post-Resume Behavior**: When the machine wakes via RTC alarm and no user reconnects, should the machine stay awake indefinitely (current design) or re-enter sleep after a secondary quiet period?
3. **Clean Boot Policy**: Should a fresh server start with 0 terminals count down to sleep, or must it remain awake until the first user session?

# Research Report: Idle-Suspend Typed Diagnostics, Sanitization & Deployment Retirement

**Date:** 2026-10-12  
**Target:** `plans/reports/researcher-261012-0613-idle-suspend-diagnostics.md`  
**Reference Incident:** `plans/reports/debugger-261012-0613-idle-suspend-capability.md` (HTTP 503 `idleSuspendCapabilityUnavailable` caused by `EACCES` on socket directory via obsolete service clobbering `/run/dam-hopper`).

---

## 1. Executive Summary

Incident root cause: unprivileged API (`UID/GID 1000`) cannot traverse `/run/dam-hopper` (`0770 root:dam-hopper-plugins`) because obsolete auto-restarting unit `dam-hopper-plugin-runner.service` constantly reapplies legacy tmpfiles rule. API helper client collapses `EACCES` via `Path::exists()` to `false`. Coordinator and API discard all error context and return generic 503 `"host lacks RTC alarm or suspend capability"`. On cold boots, helper service fails with `226/NAMESPACE` because `ReadWritePaths=/run/dam-hopper` runs before directory exists.

This report establishes:
1. **Three-Dimensional Probe Taxonomy**: Disentangle transport/IPC failures, true hardware absence, and transient readiness blockers. Replace Boolean `exists()` and `check_capability()` seam with typed outcome.
2. **Observability vs Requirement 48**: Emit rich structured logs server-side (`tracing::warn!`/`error!`) while returning strictly sanitized, accurate error codes/messages publicly. Extend `IdleSuspendStatusV1` with safe `probeReasonCode` and `probeCheckedAtMs`.
3. **Deployment Retirement & tmpfiles Ordering**: Harden `remove-plugin-platform.sh` and `activate.rs` to stop auto-restarting obsolete units, purge conflicting tmpfiles, run `daemon-reload`, install canonical tmpfiles into `/etc/tmpfiles.d`, and pre-provision `/run/dam-hopper` before helper startup to prevent `226/NAMESPACE`.
4. **Cloud Hypervisor Semantics**: Treat virtualization detection as diagnostic context, not an automatic hardware-absence verdict.

---

## 2. Key Area 1: Typed Probe Error Taxonomy & Socket Access

### 2.1 Flaws of `Path::exists()` vs Direct Connection
In `server/src/idle_suspend/helper_client.rs:28-30`:
```rust
pub fn is_socket_present(&self) -> bool {
    self.socket_path.exists()
}
```
- `Path::exists()` calls `std::fs::metadata()`, discarding any `io::Error`.
- `ENOENT` (socket absent) and `EACCES` (parent directory traversal denied) both evaluate to `false`.
- Introduces Time-of-Check to Time-of-Use (TOCTOU) race before `UnixStream::connect()`.
- Does not verify file type (`file_type.is_socket()`); regular files or directories pass as "present".

**Target Architectural Pattern**:
- Authoritative attempt: Attempt direct `tokio::net::UnixStream::connect(&self.socket_path).await`.
- Match connection `std::io::Error`:
  - `ErrorKind::NotFound` (`ENOENT`) -> Helper daemon socket does not exist.
  - `ErrorKind::PermissionDenied` (`EACCES`) -> Permissions/ACL mismatch on socket or parent directory.
  - `ErrorKind::ConnectionRefused` (`ECONNREFUSED`) -> Stale socket node present, but daemon dead/not listening.
- Fallible metadata inspection (`std::fs::symlink_metadata`) should only be used post-failure to enrich diagnostic logs (checking parent dir permissions vs socket inode mode), never as a preflight gate.

### 2.2 Three-Dimensional Taxonomy
Probe failures must not collapse into a single flat bucket. The architecture requires three distinct dimensions:

```text
                             Capability Probe
                                    │
       ┌────────────────────────────┼────────────────────────────┐
       ▼                            ▼                            ▼
[Dimension 1: Transport/IPC]  [Dimension 2: Hardware]    [Dimension 3: Readiness]
- SocketNotFound              - SuspendStateUnsupported   - InhibitorPresent
- SocketPermissionDenied      - RtcAlarmMissing           - RtcAlarmBusy
- ConnectionRefused           (Host lacks S3/RTC)         (Transient block;
- PeerAuthFailed                                           hardware capable)
- ProbeTimeout
- IpcProtocolError
- ProbeExecutionError (Sysfs read failed)
```

1. **Transport & Connectivity (Helper Daemon Unavailable / Inaccessible)**:
   - `SocketNotFound`: `/run/dam-hopper/idle-suspend.sock` absent.
   - `SocketPermissionDenied`: Parent directory traversal or socket read/write denied (`EACCES`).
   - `ConnectionRefused`: Socket file exists, listener inactive (`ECONNREFUSED`).
   - `PeerAuthFailed`: Unix stream accepted, but helper returned explicit protocol rejection frame (`code == "permissionDenied"`). *Crucial: do not infer peer auth failure from EOF/connection drop; only from authenticated helper response.*
   - `ProbeTimeout`: Outer probe deadline elapsed (e.g. 3000ms).
   - `IpcProtocolError`: Frame decode, oversized payload (>4096 bytes), serialization error, unexpected frame payload.
   - `ProbeExecutionError`: Helper failed to read sysfs or execute `systemd-inhibit` (probe execution error, NOT hardware absence).

2. **Permanent Hardware Capability (Host Architecture / Kernel Contract)**:
   - `SuspendStateUnsupported`: `/sys/power/state` successfully read, but configured mode (e.g. `mem`) is not listed.
   - `RtcAlarmMissing`: `/sys/class/rtc/rtc0/wakealarm` node absent on sysfs.
   - *Operation-specific note*: For indefinite sleep (`wakeAfterSeconds: 0`), helper skips RTC programming (`backend.rs:90-95`). Capability probe must differentiate between "no suspend state" (fatal to all sleep) and "no RTC wakealarm" (fatal only to timed sleep).

3. **Temporary Readiness Blocker (Transient State)**:
   - `InhibitorPresent`: Systemd sleep inhibitor in `mode == "block"` detected. (Transient: cleared when blocking application exits).
   - `RtcAlarmBusy`: `/sys/class/rtc/rtc0/wakealarm` non-empty with existing foreign timer. (Transient: cleared when alarm fires or owner clears it).

### 2.3 Closed Typed Enum Definitions
In `server/src/idle_suspend/`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProbeFailureReason {
    // Dimension 1: Transport & Connectivity
    SocketNotFound,
    SocketPermissionDenied,
    ConnectionRefused,
    PeerAuthFailed,
    ProbeTimeout,
    IpcProtocolError,
    ProbeExecutionError(String),

    // Dimension 2: Hardware Capability
    SuspendStateUnsupported,
    RtcAlarmMissing,

    // Dimension 3: Transient Readiness
    InhibitorPresent,
    RtcAlarmBusy,

    // Backward-compatibility fallback
    Unknown(String),
}

#[derive(Debug, Clone)]
pub enum CapabilityProbeOutcome {
    Supported,
    Unavailable {
        reason: ProbeFailureReason,
        diagnostic_detail: String, // Server-only diagnostic detail (paths, errno)
    },
}
```

### 2.4 Helper IPC Protocol Compatibility
In `server/src/idle_suspend/protocol.rs:472`:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type", deny_unknown_fields)]
pub enum HelperResponsePayload {
    Capability {
        supported: bool,
        detail: String,
    },
    ...
```
- `deny_unknown_fields` is set on `HelperResponsePayload`.
- Adding an unversioned field `reasonCode` directly to `Capability` payload will cause deserialization failure if a newer helper runs against an older server release.
- **IPC Strategy**:
  - Keep `HelperResponsePayload::Capability { supported: bool, detail: String }` wire schema intact.
  - Prefix helper `detail` with structured tag when failing, e.g. `ERR_CODE:<reason>:<detail>`.
  - Alternatively, if adding `reason_code: Option<String>` to `Capability`, remove `deny_unknown_fields` on `Capability` variant or bump `HELPER_PROTOCOL_VERSION: u32 = 2` with backward-compatible negotiation.
  - Fallback parser: if `detail` contains no structured tag (e.g. from older helper), parse known strings (`"Host does not support required suspend state"` -> `SuspendStateUnsupported`; `"Peer authentication failed"` -> `PeerAuthFailed`) or default to `ProbeFailureReason::Unknown(detail)`.

---

## 3. Key Area 2: Server-Side Observability vs Requirement 48 External Sanitization

### 3.1 Operator Tracing vs External Leaks
Requirement 48 states: External API responses must never leak internal host paths, local user identities, PIDs, internal service names, or raw kernel error strings.

| Boundary | Intended Consumer | Allowed Data | Prohibited Data |
|---|---|---|---|
| `tracing::warn!` / `error!` | Local Operator / Systemd Journal | Socket paths (`/run/dam-hopper/idle-suspend.sock`), raw errno (`13 EACCES`), enrolled UID/PID, command line, sysfs paths | Secrets, auth tokens |
| `POST .../force-suspend` | Browser / External API Client | Sanitized HTTP status, closed `code` string, high-level message | File paths, usernames, PIDs, errno strings |
| `GET .../v1/status` | Browser UI / Admin Dashboard | Safe closed reason code (`probeReasonCode`), timestamp (`probeCheckedAtMs`) | Diagnostic detail strings containing paths/errno |

### 3.2 Structured Tracing Call Sites
1. In `executor.rs`:
   ```rust
   tracing::warn!(
       target: "idle_suspend::executor",
       socket = %self.client.socket_path().display(),
       reason = ?reason,
       diagnostic = %diagnostic_detail,
       "Privileged helper probe failed"
   );
   ```
2. In `coordinator.rs` (`handle_force_suspend`):
   ```rust
   tracing::warn!(
       target: "idle_suspend::coordinator",
       correlation_id = %ctx.correlation_id,
       actor = %actor,
       reason = ?reason,
       "Force-suspend rejected during capability probe"
   );
   ```

### 3.3 Public API Error Response Mapping
Do not use 409 Conflict for probe inhibitors or RTC busy states during `POST /force-suspend`. In `packages/ui/src/components/organisms/ForceSleepDialog.tsx`, HTTP 409 is reserved for active PTY fleet confirmation/conflicts (`ActiveFleetConfirmationRequired`, `FleetChanged`). Returning 409 for helper probe failure causes the frontend to display an active session conflict dialog rather than an error banner.

Preserve HTTP 503 for all capability/helper rejections, but refine the sanitized code and message:

```rust
match outcome {
    CapabilityProbeOutcome::Unavailable { reason, .. } => {
        let (code, message) = match reason {
            ProbeFailureReason::SocketNotFound
            | ProbeFailureReason::SocketPermissionDenied
            | ProbeFailureReason::ConnectionRefused
            | ProbeFailureReason::PeerAuthFailed
            | ProbeFailureReason::ProbeExecutionError(_)
            | ProbeFailureReason::IpcProtocolError => (
                "idleSuspendHelperUnavailable",
                "privileged idle-suspend helper is unavailable or inaccessible",
            ),
            ProbeFailureReason::ProbeTimeout => (
                "idleSuspendProbeTimeout",
                "idle-suspend capability probe timed out",
            ),
            ProbeFailureReason::InhibitorPresent => (
                "idleSuspendInhibited",
                "host sleep is blocked by an active system inhibitor",
            ),
            ProbeFailureReason::RtcAlarmBusy => (
                "idleSuspendRtcBusy",
                "host RTC wakealarm device is currently in use",
            ),
            ProbeFailureReason::SuspendStateUnsupported
            | ProbeFailureReason::RtcAlarmMissing => (
                "idleSuspendCapabilityUnavailable",
                "host lacks required suspend state or RTC wakealarm capability",
            ),
            ProbeFailureReason::Unknown(_) => (
                "idleSuspendCapabilityUnavailable",
                "idle-suspend capability check failed",
            ),
        };
        idle_suspend_error_response(StatusCode::SERVICE_UNAVAILABLE, code, message)
    }
}
```

### 3.4 Live Probe Health in `IdleSuspendStatusV1`
In `server/src/idle_suspend/status.rs`:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdleSuspendStatusV1 {
    // ... existing fields ...
    
    /// Safe, sanitized reason code from the most recent capability probe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe_reason_code: Option<String>,

    /// Epoch millisecond timestamp of the most recent capability probe.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe_checked_at_ms: Option<u64>,
}
```

**Frontend Decoder Invariant (`packages/ui/src/api/client.ts`)**:
- `decodeIdleSuspendStatusV1` constructs a new object by explicit property assignment. It will drop unmapped properties unless explicitly added:
  ```typescript
  export interface IdleSuspendStatusV1 {
    // ...
    probeReasonCode?: string | null;
    probeCheckedAtMs?: number | null;
  }
  // Inside decodeIdleSuspendStatusV1:
  probeReasonCode: (value.probeReasonCode ?? null) as string | null,
  probeCheckedAtMs: (value.probeCheckedAtMs ?? null) as number | null,
  ```
- **Revision Churn Prevention**: In `IdleSuspendStatusV1::is_meaningful_change()`, ignore `probe_checked_at_ms` differences. Only emit revision increments and `host:idleSuspendChanged` events when `probe_reason_code` or coordinator `state` changes.

---

## 4. Key Area 3: Deployment Service Retirement & tmpfiles Ordering

### 4.1 Root Cause of Runtime Directory Ownership Corruption
1. Obsolete service `dam-hopper-plugin-runner.service` remained on disk with `Restart=on-failure`.
2. Missing executable produced exit `status=203/EXEC`.
3. Systemd triggered auto-restart every 5 seconds.
4. Each restart ran `ExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-plugin-runner.conf`.
5. The rule `d /run/dam-hopper 3770 root dam-hopper-plugins -` reset group ownership to `dam-hopper-plugins` (GID 979).
6. API running as `loidinh:loidinh` (UID/GID 1000) lost search/write access to `/run/dam-hopper`.

### 4.2 Flaws in `deploy/remove-plugin-platform.sh`
In `deploy/remove-plugin-platform.sh:202-214`:
```bash
if systemctl is-active --quiet "$RUNNER_UNIT" 2>/dev/null; then
    systemctl stop "$RUNNER_UNIT"
fi
```
- A unit crashing with `203/EXEC` is in `activating (auto-restart)` or `failed` state.
- `systemctl is-active` returns 3 (inactive/failed), so `systemctl stop` was skipped!
- Deleting the unit file while systemd retains an in-memory auto-restart job leaves the restart loop alive.

**Harden Retirement Script**:
```bash
RUNNER_UNIT="dam-hopper-plugin-runner.service"
# 1. Unconditional stop and cancel restart timers
systemctl stop "$RUNNER_UNIT" 2>/dev/null || true
systemctl reset-failed "$RUNNER_UNIT" 2>/dev/null || true
systemctl disable "$RUNNER_UNIT" 2>/dev/null || true

# 2. Remove unit files and symlinks
rm -f "$SYSTEMD_SYSTEM_DIR/$RUNNER_UNIT"
rm -f "$SYSTEMD_SYSTEM_DIR/multi-user.target.wants/$RUNNER_UNIT"

# 3. Remove obsolete tmpfiles rules
rm -f "$TMPFILES_DIR/dam-hopper-plugin-runner.conf"
rm -f "/etc/tmpfiles.d/dam-hopper-plugin-runner.conf"

# 4. Reload systemd daemon to purge in-memory unit
systemctl daemon-reload

# 5. Re-apply canonical runtime tmpfiles immediately
systemd-tmpfiles --create "$TMPFILES_DIR/dam-hopper-runtime.conf"
```

### 4.3 Integration into `activate.rs` & `runtime_cleanup.rs`
In `server/src/linux_release/activate.rs`:
- Define `const OBSOLETE_UNITS: &[&str] = &["dam-hopper-plugin-runner.service"];`
- Define `const OBSOLETE_TMPFILES: &[&str] = &["dam-hopper-plugin-runner.conf"];`
- During release activation (before starting native units):
  1. Unconditionally stop and disable obsolete units.
  2. Remove obsolete unit and tmpfiles files.
  3. Execute `systemctl daemon-reload`.
  4. In `runtime_cleanup.rs`: allow cleanup if obsolete unit is unloaded (`LoadState == not-found`) or successfully stopped.

### 4.4 Resolving Cold-Boot `226/NAMESPACE` Mount Failure
**The Defect**:
- Helper unit has:
  ```ini
  ReadWritePaths=/run/dam-hopper
  ExecStartPre=+/usr/bin/systemd-tmpfiles --create /etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf
  ```
- Systemd creates the mount namespace (`ReadWritePaths`) **before** running `ExecStartPre`.
- On cold boot, `/run` is an empty `tmpfs`. `/run/dam-hopper` does not exist.
- Mount namespace creation fails immediately with exit code `226/NAMESPACE`. `ExecStartPre` never executes.

**Architectural Remediation**:
1. **Global Boot Tmpfiles**:
   - Systemd's native early boot service `systemd-tmpfiles-setup.service` runs during `sysinit.target` before application services.
   - It only reads `/etc/tmpfiles.d/*.conf`, `/run/tmpfiles.d/*.conf`, `/usr/lib/tmpfiles.d/*.conf`. It does not read `/etc/dam-hopper/tmpfiles.d/`.
   - Install a symlink `/etc/tmpfiles.d/dam-hopper-runtime.conf -> /etc/dam-hopper/tmpfiles.d/dam-hopper-runtime.conf`.
   - This guarantees `/run/dam-hopper` is created during early boot.
2. **Helper Unit Dependency**:
   - In `dam-hopper-idle-suspend-helper.service.in`:
     Add `After=systemd-tmpfiles-setup.service`.
3. **Release Activation Sequencing**:
   - In `activate.rs:566-575`, current code starts helper before API:
     ```rust
     if let Err(e) = systemctl_start(HELPER_SERVICE_UNIT) { ... }
     provision_and_start_api(...)
     ```
   - Change order: Call `systemd_tmpfiles_create(&layout.runtime_tmpfiles_conf_path(), None)?` **prior** to calling `systemctl_start(HELPER_SERVICE_UNIT)`.

---

## 5. Key Area 4: Cloud Hypervisor / Virtualization Sleep Semantics

### 5.1 Cloud Provider & Hypervisor Landscape
| Provider / Hypervisor | In-Guest ACPI S3 (Mem) | RTC Wakealarm | Provider Sleep Mechanism |
|---|---|---|---|
| **AWS EC2 (Nitro / Xen)** | Unsupported (`freeze` only or empty) | Absent or virtual RTC lacks hardware wakeup | AWS Instance Stop / Start, AWS Hibernation Agent (S4 disk image) |
| **GCP Compute Engine (KVM)** | Unsupported (`freeze` only) | Virtual RTC without S3 wakeup | GCP API Instance Suspend/Resume (hypervisor RAM capture) |
| **Microsoft Azure (Hyper-V)** | Unsupported (`freeze` only) | Virtual RTC lacks S3 wakeup | Azure VM Deallocate / Hibernation |
| **DigitalOcean / Hetzner (KVM)** | Unsupported (default QEMU flags disable S3) | Untrusted wake | Cloud Console Power Off / Snapshot |
| **WSL2 (Hyper-V)** | Unsupported (`freeze` only) | No `/sys/class/rtc/rtc0` | `wsl --shutdown` from Windows host |

### 5.2 Virtualization Detection as Context, Not Verdict
- Hypervisors do not support Linux ACPI S3 suspend with hardware RTC wake.
- However, **virtualization detection must be treated as diagnostic context, not an automatic capability verdict**:
  - Do not automatically return `Unsupported` merely because `systemd-detect-virt` is non-empty (nested hypervisors or custom QEMU setups with `-global PIIX4_PM.disable_s3=0` may support S3).
  - Let `SysfsPreflightChecker` probe real sysfs nodes (`/sys/power/state` and `/sys/class/rtc/rtc0/wakealarm`).
  - When sysfs probe fails on a host where `systemd-detect-virt` reports a hypervisor, log clear diagnostic context:
    ```rust
    tracing::info!(
        target: "idle_suspend::preflight",
        virt = %virt_type,
        "Host is running inside a virtualized environment; hypervisors typically do not expose ACPI S3 or hardware RTC wakealarm devices"
    );
    ```
  - This immediately clarifies to operators why S3 sleep is unavailable on cloud instances without blaming DamHopper permissions or configuration.

---

## 6. Implementation Touchpoints & Remediation Matrix

| Priority | Area | Files to Touch | Concrete Changes |
|---|---|---|---|
| **P0** | Service Retirement | `deploy/remove-plugin-platform.sh` | Unconditionally stop, reset-failed, and disable `dam-hopper-plugin-runner.service`; remove obsolete tmpfiles; run `systemctl daemon-reload`; re-apply runtime tmpfiles. |
| **P0** | Release Migration | `server/src/linux_release/activate.rs`, `runtime_cleanup.rs` | Explicitly retire obsolete plugin units during release activation; pre-provision `/run/dam-hopper` via tmpfiles before starting helper. |
| **P0** | Cold-Boot tmpfiles | `deploy/systemd/dam-hopper-idle-suspend-helper.service.in`, `stage_units.rs` | Add `After=systemd-tmpfiles-setup.service`; link `/etc/tmpfiles.d/dam-hopper-runtime.conf`. |
| **P1** | Typed Probe Outcome | `server/src/idle_suspend/executor.rs`, `helper_client.rs` | Remove `Path::exists()`; use direct fallible connect; return `CapabilityProbeOutcome` with `ProbeFailureReason`. |
| **P1** | Helper IPC Diagnostics | `server/src/idle_suspend/helper_server.rs`, `protocol.rs` | Propagate typed preflight/peer error codes across helper IPC without breaking `deny_unknown_fields`. |
| **P1** | Coordinator Observability | `server/src/idle_suspend/coordinator.rs` | Log structured tracing on probe failures; track `last_probe_reason` and `last_probe_checked_at_ms`. |
| **P1** | Safe API Sanitization | `server/src/api/idle_suspend.rs`, `server/src/idle_suspend/status.rs` | Map probe outcomes to accurate sanitized codes (503 `idleSuspendHelperUnavailable` vs `idleSuspendCapabilityUnavailable`); add `probeReasonCode` and `probeCheckedAtMs` to `IdleSuspendStatusV1`. |
| **P1** | UI Status Decoder | `packages/ui/src/api/client.ts` | Update `decodeIdleSuspendStatusV1` to parse and normalize `probeReasonCode` and `probeCheckedAtMs`. |

---

## 7. Unresolved Questions & Evidence Limits

1. **Helper Protocol Serialization Envelope**: Does `HelperResponsePayload` currently permit backward-compatible wire additions without bumping `HELPER_PROTOCOL_VERSION`? If older clients strictly enforce `deny_unknown_fields`, structured error encoding in `detail` or a protocol version bump with backward fallback is required.
2. **Indefinite Sleep RTC Requirement**: Should `preflight.run_all()` bypass `check_rtc_wakealarm()` when `wake_after_seconds == 0` (indefinite suspend), allowing hosts without RTC wakealarm hardware to suspend indefinitely?
3. **Root Elevation in Deployment Environments**: In environments where release activation runs unprivileged (`DAM_HOPPER_ALLOW_NON_ROOT=1`), does systemd allow creating `/etc/tmpfiles.d/` links, or should local fallback directories be used?

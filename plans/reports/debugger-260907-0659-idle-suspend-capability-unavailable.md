# Diagnostic Report: 503 Service Unavailable (`idleSuspendCapabilityUnavailable`) on Force-Suspend API

## 1. Executive Summary
- **Issue**: Calling `POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend` fails with:
  ```json
  503 Service Unavailable
  {
    "error": "host lacks RTC alarm or suspend capability",
    "code": "idleSuspendCapabilityUnavailable"
  }
  ```
- **Root Cause**:
  1. **Missing Privileged Helper Binary on Target System**:
     - Systemd unit `/etc/systemd/system/dam-hopper-idle-suspend-helper.service` invokes:
       `ExecStart=/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper ...`
     - Symlink `/opt/dam-hopper/current` points to `/opt/dam-hopper/releases/v0.2.0/both`.
     - Release `v0.2.0` does **not** contain `dam-hopper-idle-suspend-helper` (introduced in v0.3.0 / `feat-terminal-idle-suspend`).
  2. **Failed Systemd Socket Activation & Continuous Restart Loop**:
     - At UAT startup (07:06:21), `dam-hopper-idle-suspend-helper.socket` was active and `/run/dam-hopper/idle-suspend.sock` was present on the VFS. `dam-hopper-server` enrolled `SystemdIdleSuspendExecutor`.
     - When `POST /api/system/idle-suspend/v1/force-suspend` arrived (07:06:34), coordinator initiated `executor.check_capability()`.
     - `UnixStream::connect("/run/dam-hopper/idle-suspend.sock")` triggered systemd socket activation.
     - Systemd attempted to execute `/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper`, failing immediately with `status=203/EXEC` (`No such file or directory`).
     - Connection dropped; capability probe failed and returned `false`.
  3. **VFS Socket Unlinking via `RuntimeDirectory` Cleanup**:
     - `dam-hopper-idle-suspend-helper.service` declares `RuntimeDirectory=dam-hopper`.
     - On service execution failure and exit, systemd automatically deleted `/run/dam-hopper`.
     - This unlinked `/run/dam-hopper/idle-suspend.sock` from the VFS namespace while the unit restarted every 5s (restart counter > 50).
     - Any subsequent check fails immediately at `self.client.is_socket_present()` (`false`) or `ENOENT`.
  4. **Host Hardware & OS Actually Capable**:
     - Hardware & kernel **do** support suspend (`/sys/power/state` has `mem`).
     - Hardware & kernel **do** support RTC wakealarm (`/sys/class/rtc/rtc0/wakealarm` exists, alarm currently inactive `0`).
     - Capability failure was 100% caused by missing helper binary and broken helper IPC.

---

## 2. Backward Call Stack & Failure Points

```
[HTTP Client]
  │ POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend
  ▼
[server/src/api/idle_suspend.rs:342] `force_suspend()`
  │ Validates transport guards & actor; parses `ForceSuspendRequest`
  │ Calls `coordinator.force_suspend(cmd).await` (line 422)
  ▼
[server/src/idle_suspend/coordinator.rs:253] `IdleSuspendCoordinator::force_suspend()`
  │ Sends `CommandMessage::ForceSuspend` over actor channel
  ▼
[server/src/idle_suspend/coordinator.rs:402] `run_coordinator_loop()`
  │ Dispatches to `handle_force_suspend()` (line 847)
  ▼
[server/src/idle_suspend/coordinator.rs:932] `handle_force_suspend()`
  │ Executes bounded capability probe (3s timeout):
  │ `tokio::time::timeout(3s, executor.check_capability()).await.unwrap_or_default()`
  │ Evaluates: `if !has_capability` (line 936) ───► [PROBE RETURNED FALSE]
  │ Returns `CoordinatorForceSuspendResult::CapabilityUnavailable(...)` (lines 955-957)
  ▼
[server/src/api/idle_suspend.rs:465-472] Handler Result Mapping
  │ Matches `CoordinatorForceSuspendResult::CapabilityUnavailable(_detail)`
  │ Returns HTTP 503 `idle_suspend_error_response`:
  │ Status: StatusCode::SERVICE_UNAVAILABLE (503)
  │ Code: "idleSuspendCapabilityUnavailable"
  │ Message: "host lacks RTC alarm or suspend capability"
```

### Deep Dive: Inside `executor.check_capability()`

```
[server/src/idle_suspend/executor.rs:83] `SystemdIdleSuspendExecutor::check_capability()`
  │ 1. `if !self.client.is_socket_present() { return false; }`
  │    Checks `Path::exists("/run/dam-hopper/idle-suspend.sock")`
  │ 2. `match self.client.check_capability().await { Ok((supported, _)) => supported, Err(_) => false }`
  ▼
[server/src/idle_suspend/helper_client.rs:31] `HelperClient::check_capability()`
  │ Connects to Unix socket: `UnixStream::connect("/run/dam-hopper/idle-suspend.sock").await`
  │ Systemd socket accepts connection fd, triggers `dam-hopper-idle-suspend-helper.service`
  ▼
[systemd / host system]
  │ Spawns `/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper`
  │ FAILS with 203/EXEC: No such file or directory
  │ Service exits; systemd closes socket connection & removes `/run/dam-hopper`
  ▼
[HelperClient / SystemdIdleSuspendExecutor]
  │ `UnixStream` read/write returns Broken pipe / Connection reset / EOF
  │ `check_capability()` returns `Err(ProtocolError::IoError)` -> maps to `false`
```

---

## 3. Host Environment Capabilities & Evidence

### 3.1 Host Hardware & Kernel State
- **Suspend Support** (`/sys/power/state`):
  ```
  freeze mem disk
  ```
  Kernel supports ACPI S3/mem suspend mode (`expected_mode: "mem"` matched).
- **RTC Wakealarm Support** (`/sys/class/rtc/rtc0/wakealarm`):
  ```
  -rw-r--r--+ 1 root root 4096 wakealarm
  Content: (empty / 0 active alarms)
  ```
  Device exists and is currently inactive. Exclusive ownership preflight will succeed.
- **Sleep Inhibitors** (`systemd-inhibit --list --no-legend`):
  ```
  ModemManager   0 root 1057 ModemManager sleep ModemManager needs to reset devices delay
  NetworkManager 0 root 996  NetworkManager sleep NetworkManager needs to turn off networks delay
  UPower         0 root 25329 upowerd sleep Pause device polling delay
  Oh My Pi       1000 loidinh 650017 omp idle Oh My Pi agent session block
  ```
  *Note*: In `server/src/idle_suspend/preflight.rs:84`, the inhibitor checker matches any row containing `"sleep"`, including standard system delay inhibitors (`ModemManager`, `NetworkManager`, `UPower`). Once the helper is running, delay inhibitors would also need evaluation (see Section 6).

### 3.2 Systemd Unit State & Journald Logs
- **Socket Unit** (`systemctl status dam-hopper-idle-suspend-helper.socket`):
  - State: `active (running)` since Sun 2026-09-06 01:38:28 +07.
  - Listening path: `/run/dam-hopper/idle-suspend.sock`.
- **Service Unit** (`systemctl status dam-hopper-idle-suspend-helper.service`):
  - State: `activating (auto-restart) (Result: exit-code)`
  - Exit Code: `status=203/EXEC`
  - Journald logs:
    ```
    Sep 07 07:06:34 localhost.localdomain systemd[1]: Started dam-hopper-idle-suspend-helper.service.
    Sep 07 07:06:34 localhost.localdomain (dam-hopper-idle-suspend-helper)[910132]: dam-hopper-idle-suspend-helper.service: Unable to locate executable '/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper': No such file or directory
    Sep 07 07:06:34 localhost.localdomain (dam-hopper-idle-suspend-helper)[910132]: dam-hopper-idle-suspend-helper.service: Failed at step EXEC spawning /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper: No such file or directory
    Sep 07 07:06:34 localhost.localdomain systemd[1]: dam-hopper-idle-suspend-helper.service: Main process exited, code=exited, status=203/EXEC
    ```
  - Exact timestamp of first crash: **07:06:34**, coinciding exactly with incoming API request.
  - Crash frequency: every 5 seconds (`RestartSec=5s`, restart counter > 50).

### 3.3 Server & Release Binary Inspection
- `/opt/dam-hopper/current` points to `/opt/dam-hopper/releases/v0.2.0/both`.
- Binaries in `/opt/dam-hopper/current/bin/`:
  - `dam-hopper-manager`
  - `dam-hopper-server`
  - `dam-hopper-web`
  - `dam-hopper-idle-suspend-helper` is **missing**.

### 3.4 UAT Server Configuration (`scripts/run-uat.sh`)
- UAT Server (PID 910052) was started with:
  ```bash
  /home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-server \
      --config /tmp/dam-hopper-uat/dam-hopper.toml \
      --host 0.0.0.0 --port 4803
  ```
- `/tmp/dam-hopper-uat/dam-hopper.toml`:
  ```toml
  [workspace]
  name = "uat-workspace"

  [server.idle_suspend]
  enabled = false
  quiet_period_seconds = 300
  wake_after_seconds = 600
  ```
- `DAM_HOPPER_IDLE_SUSPEND_SOCKET` is not set by `run-uat.sh`.
- Server defaulted to `/run/dam-hopper/idle-suspend.sock`.
- Server log `/tmp/dam-hopper-uat/server.log:11`:
  ```
  2026-09-07T00:06:21.891807Z INFO dam_hopper_server: Enrolling SystemdIdleSuspendExecutor with privileged helper socket=/run/dam-hopper/idle-suspend.sock
  ```

---

## 4. Architectural Analysis of Failure Mechanism

| Component | Intended Design | Observed Runtime Behavior | Impact |
|---|---|---|---|
| **Executor Selection** (`main.rs:370-388`) | If helper socket exists at startup, enroll `SystemdIdleSuspendExecutor`; else fallback to `UnavailableExecutor`. | Socket existed at 07:06:21 because of systemd socket unit. `SystemdIdleSuspendExecutor` enrolled. | Startup resolution succeeded, but runtime IPC failed. |
| **Systemd Socket Activation** | Socket forwards connections to spawned helper daemon. | Systemd spawns helper on connection, but binary path `/opt/dam-hopper/current/bin/...` does not exist. | Systemd fails with 203/EXEC; drops connection. |
| **Systemd `RuntimeDirectory`** (`dam-hopper-idle-suspend-helper.service:10`) | Unit creates `/run/dam-hopper` on start, deletes it on stop. | Because service crashes immediately, systemd deletes `/run/dam-hopper` and unlinks the socket file. | Leaves filesystem without socket; any subsequent call fails early with `is_socket_present() == false`. |
| **Capability Probe** (`coordinator.rs:932`) | Probe helper with 3s timeout to fail fast if helper down. | Probe fails due to broken IPC. | Maps to `CoordinatorForceSuspendResult::CapabilityUnavailable`. |
| **API Error Response** (`idle_suspend.rs:465-472`) | Sanitized error masking internal helper details (Requirement 48). | Returns generic 503 "host lacks RTC alarm or suspend capability". | Hides the true cause (helper binary not found / socket crash). |

---

## 5. Remediation Paths

### Path A: Production / Host Fix (Deploying Real Helper)
1. **Build the helper binary**:
   ```bash
   cargo build --release --bin dam-hopper-idle-suspend-helper
   ```
2. **Install binary into the active release path**:
   ```bash
   sudo cp target/release/dam-hopper-idle-suspend-helper /opt/dam-hopper/releases/v0.2.0/both/bin/
   # Or cut over /opt/dam-hopper/current to v0.3.0 release
   sudo chmod 0755 /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper
   sudo chown root:root /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper
   ```
3. **Reset and restart systemd units**:
   ```bash
   sudo systemctl reset-failed dam-hopper-idle-suspend-helper.service
   sudo systemctl restart dam-hopper-idle-suspend-helper.socket
   ```
4. **Verify socket presence & service readiness**:
   ```bash
   ls -la /run/dam-hopper/idle-suspend.sock
   systemctl is-active dam-hopper-idle-suspend-helper.socket
   ```

### Path B: UAT Environment Isolation (Local Helper Instance)
Avoid coupling UAT (running from working tree on port 4803/4804) to `/opt/dam-hopper/current` systemd units:
1. **Start dedicated UAT helper**:
   ```bash
   sudo /home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-idle-suspend-helper \
       --socket /tmp/dam-hopper-uat/idle-suspend.sock \
       --audit-file /tmp/dam-hopper-uat/idle-suspend-helper.jsonl \
       --enrolled-pid-file /tmp/dam-hopper-uat/server.pid
   ```
2. **Configure UAT in `scripts/run-uat.sh`**:
   Pass `DAM_HOPPER_IDLE_SUSPEND_SOCKET="/tmp/dam-hopper-uat/idle-suspend.sock"` in `start_services()`.

### Path C: Development / Test Mock Executor (Architecture Improvement)
- **Problem**: Currently, `FakeExecutor` (`server/src/idle_suspend/executor.rs:112`) is test-only. `server/src/main.rs` has no mechanism to enable a fake/mock executor for dev/UAT testing without privileged root helper execution.
- **Proposed Enhancement**:
  Support `DAM_HOPPER_IDLE_SUSPEND_MOCK=1` or `[server.idle_suspend] mock = true` in development/UAT to wire `FakeExecutor` with `capability_available = true`. This allows UI and API validation without requiring root privileges or risking real host suspension during developer testing.

---

## 6. Unresolved Questions & Observations
1. **System Delay Inhibitor Sensitivity in `SysfsPreflightChecker`**:
   In `server/src/idle_suspend/preflight.rs:84-95`, `check_sleep_inhibitor()` checks `if line_lower.contains("sleep")`.
   On standard Linux desktops/servers, daemons like `NetworkManager`, `ModemManager`, and `UPower` hold persistent `sleep ... delay` inhibitors so logind notifies them before sleeping.
   Does `check_sleep_inhibitor()` intend to reject `delay` inhibitors, or should it only fail closed on `mode == "block"`? Once the helper executable is installed, will `ModemManager`/`NetworkManager` delay inhibitors cause `preflight.run_all()` to fail?
2. **Release Package Version Mismatch**:
   Why is `/opt/dam-hopper/current` pointing to `v0.2.0` on a host running `feat-terminal-idle-suspend`? Has `v0.3.0` release package not yet been deployed to `/opt/dam-hopper/releases/` on this machine?

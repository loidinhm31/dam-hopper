# Diagnostic Report: 503 Service Unavailable (`idleSuspendCapabilityUnavailable`) on Force-Suspend API

## 1. Executive Summary
- **Issue**: Calling `POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend` with valid JWT authentication returns:
  ```json
  HTTP/1.1 503 Service Unavailable
  cache-control: no-store
  {
    "error": "host lacks RTC alarm or suspend capability",
    "code": "idleSuspendCapabilityUnavailable"
  }
  ```
  after server restart with MongoDB credentials configured in `.env`.
- **Primary Root Cause**: Missing enrolled PID file `/run/dam-hopper/server.pid`.
  - Systemd helper `/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper` executes with `--enrolled-pid-file /run/dam-hopper/server.pid`.
  - `scripts/run-uat.sh` writes server PID to `/tmp/dam-hopper-uat/server.pid`.
  - No service or component writes `/run/dam-hopper/server.pid`. File does not exist on VFS.
  - Helper server `peer_auth.rs:94-102` fails at `resolve_expected_pid()` (`PidFileReadError: os error 2`).
  - Helper rejects connection with `permissionDenied`. Client maps to `Err(ProtocolError::IoError)`. Executor maps `Err(_)` to `false`. Coordinator maps `!has_capability` to `CapabilityUnavailable` (503).
- **Secondary Root Cause (Immediate Next Blocker)**: False-positive inhibitor detection in `SystemdInhibitCliProvider`.
  - `preflight.rs:84-95` checks `line_lower.contains("sleep")` on `systemd-inhibit --list --no-legend`.
  - On this Linux host, daemons `ModemManager`, `NetworkManager`, `UPower` hold standard `sleep ... delay` notification locks.
  - `SysfsPreflightChecker::check_sleep_inhibitors` (`preflight.rs:226-235`) treats ANY inhibitor as fatal failure, failing to distinguish `mode: delay` from `mode: block`.
  - Systemd `delay` locks allow suspend (delayed up to `InhibitDelayMaxSec` for notification); they do not block suspend.
  - Once PID file resolved, capability probe still fails with `supported: false` due to ModemManager delay lock.
- **Tertiary Architectural Defect**: Broken systemd socket activation handoff.
  - `dam-hopper-idle-suspend-helper.rs:87-92` deletes socket file and re-binds fresh `UnixListener` on startup instead of adopting systemd file descriptor via `sd_listen_fds`.
  - Very first connection triggering socket activation is dropped/orphaned, causing 3s timeout or connection reset.
- **Hardware & Kernel Status**: Fully capable.
  - `/sys/power/state` contains `mem`.
  - `/sys/class/rtc/rtc0/wakealarm` exists and is empty/ready.

---

## 2. Backward Execution Trace & Failure Points

```
[HTTP Client]
  │ POST /api/system/idle-suspend/v1/force-suspend
  ▼
[server/src/api/idle_suspend.rs:358-370] force_suspend
  │ Transport guards & JWT claims pass; MongoDB actor is_enabled_user passes
  │ Dispatches to coordinator.force_suspend(cmd)
  ▼
[server/src/idle_suspend/coordinator.rs:932-936] handle_force_suspend
  │ Probes executor capability with 3s timeout:
  │ let has_capability = tokio::time::timeout(3s, executor.check_capability()).await.unwrap_or_default()
  │ Evaluates: if !has_capability -> returns CoordinatorForceSuspendResult::CapabilityUnavailable
  ▼
[server/src/idle_suspend/executor.rs:83-93] SystemdIdleSuspendExecutor::check_capability
  │ Checks socket existence -> /run/dam-hopper/idle-suspend.sock exists
  │ Calls self.client.check_capability().await -> matches Err(_) => false
  ▼
[server/src/idle_suspend/helper_client.rs:31-50] HelperClient::check_capability
  │ Connects to /run/dam-hopper/idle-suspend.sock
  │ Receives HelperResponsePayload::Error { code: "permissionDenied", message: "..." }
  │ Returns Err(ProtocolError::IoError(ErrorKind::PermissionDenied, ...))
  ▼
[server/src/idle_suspend/helper_server.rs:50-64] HelperServer::handle_connection
  │ Evaluates peer credentials via self.policy.verify_credentials(&cred)
  │ Returns Err(PeerAuthError::PidFileReadError("/run/dam-hopper/server.pid", "No such file or directory (os error 2)"))
  │ Sends HelperResponsePayload::Error { code: "permissionDenied", ... }
  ▼
[server/src/idle_suspend/peer_auth.rs:94-102] EnrolledPeerPolicy::resolve_expected_pid
  │ Attempts std::fs::read_to_string("/run/dam-hopper/server.pid")
  │ Fails: file does not exist
  ▼
[server/src/api/idle_suspend.rs:465-472] API Result Mapping
  │ Matches CoordinatorForceSuspendResult::CapabilityUnavailable
  │ Returns HTTP 503 idleSuspendCapabilityUnavailable: "host lacks RTC alarm or suspend capability"
```

---

## 3. Evidence from System & Source Code

### 3.1 Process & File State
- **Server Process**:
  - PID: `707978`, User: `root` (UID 0), Started: `Mon Sep 7 23:01:44 2026`.
  - Executable: `/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-server`.
  - Config: `/tmp/dam-hopper-uat/dam-hopper.toml`.
  - Server PID file written by `scripts/run-uat.sh`: `/tmp/dam-hopper-uat/server.pid`.
- **Helper Process**:
  - PID: `708111`, User: `root`, Started: `Mon Sep 7 23:02:08 2026`.
  - Executable: `/opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper`.
  - Service command line:
    ```
    /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper \
      --socket /run/dam-hopper/idle-suspend.sock \
      --audit-file /var/log/dam-hopper/idle-suspend-helper.jsonl \
      --enrolled-pid-file /run/dam-hopper/server.pid
    ```
- **VFS Inspection of `/run/dam-hopper/`**:
  ```
  srw-rw----+ 1 root root 0 Sep  7 23:02 idle-suspend.sock
  ```
  `/run/dam-hopper/server.pid` **does not exist**.

### 3.2 Peer Auth Logic (`server/src/idle_suspend/peer_auth.rs:94-124`)
```rust
pub fn resolve_expected_pid(&self) -> Result<Option<u32>, PeerAuthError> {
    if let Some(pid) = self.expected_pid {
        return Ok(Some(pid));
    }
    if let Some(path) = &self.pid_file_path {
        let content = std::fs::read_to_string(path)
            .map_err(|e| PeerAuthError::PidFileReadError(path.clone(), e.to_string()))?;
        let pid = content
            .trim()
            .parse::<u32>()
            .map_err(|_| PeerAuthError::InvalidPidFile(path.clone()))?;
        return Ok(Some(pid));
    }
    Ok(None)
}
```
When `path = "/run/dam-hopper/server.pid"` is missing, `std::fs::read_to_string` fails. `resolve_expected_pid()` returns `Err(PidFileReadError)`. `verify_credentials()` bubbles the error via `?`. Helper sends `permissionDenied`.

### 3.3 Secondary Blocker: Inhibitor Parsing (`server/src/idle_suspend/preflight.rs:80-96, 226-235`)
- Output of `systemd-inhibit --list --no-legend` on this machine:
  ```
  ModemManager   0    root    1224   ModemManager   sleep ModemManager needs to reset devices       delay
  NetworkManager 0    root    1150   NetworkManager sleep NetworkManager needs to turn off networks delay
  UPower         0    root    8193   upowerd        sleep Pause device polling                      delay
  Oh My Pi       1000 loidinh 687586 omp            idle  Oh My Pi agent session                    block
  ```
- Parser implementation:
  ```rust
  let line_lower = line.to_lowercase();
  if line_lower.contains("sleep") {
      let who = parts[0].to_string();
      let mode = parts.last().unwrap_or(&"block").to_string();
      let why = if parts.len() > 4 { parts[3..parts.len() - 1].join(" ") } else { ... };
      return Ok(Some(ActiveInhibitor::new(who, why, mode)));
  }
  ```
- Evaluates first matching line: `ModemManager ... sleep ... delay`.
  - `who` = `"ModemManager"`
  - `mode` = `"delay"`
  - `why` = `"1224 ModemManager sleep ModemManager needs to reset devices"` (also contains column indexing bug: includes PID, PROG, and WHAT).
- Preflight evaluation:
  ```rust
  fn check_sleep_inhibitors(&self) -> Result<(), PreflightError> {
      match self.inhibitor_provider.check_sleep_inhibitor() {
          Ok(Some(inhibitor)) => Err(PreflightError::Inhibited(
              inhibitor.format_description(),
              Some(inhibitor.who),
              Some(inhibitor.why),
          )),
          Ok(None) => Ok(()),
          Err(e) => Err(PreflightError::ProbeError(e)),
      }
  }
  ```
- `check_sleep_inhibitors()` treats ANY inhibitor as fatal failure regardless of mode.
- Systemd specification: `delay` mode only delays suspend up to `InhibitDelayMaxSec` (default 5s) for notification; logind suspends anyway. Only `block` mode prohibits suspend.
- Result: Helper reports `supported: false, detail: "Preflight check failed: system sleep inhibited by 'ModemManager': ... (mode: delay)"`.

### 3.4 Socket Activation Drop (`server/src/bin/dam-hopper-idle-suspend-helper.rs:87-92`)
```rust
// Clean up stale socket if it exists
if cli.socket.exists() {
    let _ = std::fs::remove_file(&cli.socket);
}

let listener = tokio::net::UnixListener::bind(&cli.socket)?;
```
`dam-hopper-idle-suspend-helper.socket` accepts client connection on FD 3. Helper binary ignores systemd socket activation, unlinks `/run/dam-hopper/idle-suspend.sock`, and rebinds. Initial client connection is abandoned and times out.

---

## 4. Defect Summary Table

| Layer | Defect Description | Code Location | Observed Impact |
|---|---|---|---|
| **PID File Sync** | Helper configured with `--enrolled-pid-file /run/dam-hopper/server.pid`, but UAT writes to `/tmp/dam-hopper-uat/server.pid`. `/run/dam-hopper/server.pid` does not exist. | `deploy/systemd/dam-hopper-idle-suspend-helper.service:13`, `scripts/run-uat.sh:93` | All client connections rejected with `permissionDenied`. Probe returns `false`. |
| **Inhibitor Mode Discrimination** | `SystemdInhibitCliProvider` treats `delay` mode as blocking inhibitor. Standard Linux daemons (`ModemManager`, `NetworkManager`, `UPower`) always hold `sleep delay` locks. | `server/src/idle_suspend/preflight.rs:84-95, 226-235` | Capability probe `run_all()` returns `supported: false` even with valid PID authentication. |
| **Inhibitor Column Parsing** | `why` slice `parts[3..parts.len() - 1]` assumes `WHY` starts at col 3. In systemd format (`WHO UID PID PROG WHAT WHY MODE`), col 3 is PID, col 4 PROG, col 5 WHAT. | `server/src/idle_suspend/preflight.rs:88-90` | Corrupted `why` string containing PID and process name. |
| **Socket Activation Handoff** | Helper ignores systemd socket activation FD (`sd_listen_fds`), unlinks socket, rebinds fresh listener. | `server/src/bin/dam-hopper-idle-suspend-helper.rs:87-92` | First request triggering socket activation is dropped/orphaned. |
| **Error Sanitization** | Coordinator collapses all helper IPC errors, auth denials, and preflight failures into generic 503 `idleSuspendCapabilityUnavailable`. | `server/src/api/idle_suspend.rs:465-472` | Masks operational/deployment bugs as hardware missing RTC alarm/suspend. |

---

## 5. Actionable Recommendations for UAT (Zero Code Edits)

To validate the force-suspend endpoint during UAT without code modifications:

### Workaround 1: Synchronize PID File & Temporarily Stop Sleep Delay Inhibitors
1. **Link UAT server PID into expected systemd helper path**:
   ```bash
   sudo sh -c 'cat /tmp/dam-hopper-uat/server.pid > /run/dam-hopper/server.pid'
   sudo chmod 0644 /run/dam-hopper/server.pid
   ```
2. **Temporarily stop daemons holding sleep delay locks**:
   Check active delay locks:
   ```bash
   systemd-inhibit --list --no-legend
   ```
   Temporarily stop services holding `sleep ... delay`:
   ```bash
   sudo systemctl stop ModemManager
   sudo systemctl stop upower
   ```
   *(Note: Verify `NetworkManager` is not holding a sleep lock, or temporarily disconnect/stop if necessary).*
3. **Execute API call**:
   ```bash
   curl -i -X POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json"
   ```

### Workaround 2: Run Standalone UAT Helper with Exact Process PID
To bypass systemd unit mismatches entirely:
1. **Stop systemd helper and socket**:
   ```bash
   sudo systemctl stop dam-hopper-idle-suspend-helper.service dam-hopper-idle-suspend-helper.socket
   ```
2. **Launch helper manually specifying enrolled PID directly**:
   ```bash
   sudo /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper \
     --socket /run/dam-hopper/idle-suspend.sock \
     --audit-file /tmp/dam-hopper-uat/helper-audit.jsonl \
     --enrolled-pid "$(cat /tmp/dam-hopper-uat/server.pid)"
   ```
   Passing `--enrolled-pid <PID>` directly avoids PID file filesystem reads.
3. *(Still requires stopping `ModemManager`/`upower` until code fix for delay inhibitors is deployed).*

---

## 6. Long-Term Remediation (For Subsequent Implementation Phase)

1. **Fix Inhibitor Mode Checking in `preflight.rs`**:
   - Only treat `mode == "block"` (or `mode == "block-weak"` for unprivileged) as active inhibitor.
   - Ignore `mode == "delay"`. Delay inhibitors are normal systemd hooks that permit suspend.
   - Fix column splitting: properly parse `WHO UID PID WHAT WHY MODE` according to systemd table layout.
2. **Standardize PID File Path**:
   - Configure `dam-hopper-server` to optionally write its PID file on startup, or have `run-uat.sh` write `/run/dam-hopper/server.pid` when directory exists.
   - Alternatively, pass `--enrolled-pid-file` via environment variable `DAM_HOPPER_IDLE_SUSPEND_ENROLLED_PID_FILE` configurable per environment.
3. **Adopt Systemd Socket Activation in Helper Binary**:
   - Check `listen_fds` / `LISTEN_FDS` on startup before unlinking socket. If FD 3 is present, adopt it via `tokio::net::UnixListener::from_std()`.
4. **Diagnostic Logging for Capability Probe**:
   - In `SystemdIdleSuspendExecutor::check_capability()`, log `warn!` when probe fails, including error detail returned by helper client, so operator sees why capability was denied.

---

## 7. Unresolved Questions
1. Does `dam-hopper.service` (production systemd unit) configure systemd to write `/run/dam-hopper/server.pid` via `PIDFile=/run/dam-hopper/server.pid`, or is `dam-hopper-server` expected to write this file internally?
2. Should `SysfsPreflightChecker` support an allowlist of known benign delay inhibitors (`ModemManager`, `NetworkManager`, `UPower`, `systemd-logind`), or strictly filter by `mode == "block"`?
3. In `SystemdIdleSuspendExecutor::check_capability()`, should failure details from `HelperResponsePayload::Capability { detail, .. }` and `HelperResponsePayload::Error` be recorded in server-side diagnostic status (`state.idle_suspend_status`) rather than discarded silently?

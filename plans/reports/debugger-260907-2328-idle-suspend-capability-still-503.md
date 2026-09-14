# Technical Investigation Report: Idle Suspend 503 `idleSuspendCapabilityUnavailable`

**Target**: `POST /api/system/idle-suspend/v1/force-suspend` returns HTTP 503 `idleSuspendCapabilityUnavailable` after helper started with `--enrolled-pid 726664`.  
**Date**: 2026-09-07 23:28 Asia/Saigon  
**Author**: Debugger  
**Report File**: `plans/reports/debugger-260907-2328-idle-suspend-capability-still-503.md`

---

## 1. Executive Summary

- **Problem Statement**:  
  Calling `POST /api/system/idle-suspend/v1/force-suspend` on `dam-hopper-server` (PID `726664`, port `4803`) returns:
  ```json
  {
      "error": "host lacks RTC alarm or suspend capability",
      "code": "idleSuspendCapabilityUnavailable"
  }
  ```
  despite privileged helper running with `--enrolled-pid 726664` (PID `726813`) and bound to `/run/dam-hopper/idle-suspend.sock`.

- **Primary Root Cause (Layer 1 - Active Blocker)**:  
  **Startup Order Race & Permanent Latching**: In `server/src/main.rs:370-389`, `dam-hopper-server` checks `socket_path.exists()` strictly once at boot. When UAT server started at 23:25, helper was stopped, `/run/dam-hopper/idle-suspend.sock` did not exist. The server permanently initialized `UnavailableExecutor` into `state.idle_suspend_coordinator`. `UnavailableExecutor::check_capability()` is hardcoded to return `false`. Starting the helper at 23:26 had **zero effect** because `dam-hopper-server` never dynamically reconnects or re-evaluates socket existence.

- **Secondary Root Cause (Layer 2 - Next Immediate Blocker)**:  
  **False-Positive Sleep Inhibitor Detection in Preflight**: When server restarts and connects to helper, helper runs `preflight.run_all()` (`server/src/idle_suspend/helper_server.rs:99`). In `server/src/idle_suspend/preflight.rs:84-95`, `SystemdInhibitCliProvider` runs `systemd-inhibit --list --no-legend`. It matches `NetworkManager`'s sleep inhibitor (`WHAT=sleep`, `MODE=delay`). The code treats ANY line containing `"sleep"` as an active blocking inhibitor, ignoring the `delay` mode (which standard Linux daemons use to flush network state before sleep). `run_all()` returns `Err(PreflightError::Inhibited)`, causing helper capability probe to return `supported: false`, which maps to the identical 503 error.

- **Architectural Flaw**:  
  **Chicken-and-Egg Lifecycle Deadlock with `--enrolled-pid`**: Helper with `--enrolled-pid <PID>` cannot start before server (PID unknown). Server cannot start before helper (latches `UnavailableExecutor` if socket missing). Restarting server changes PID, triggering `permissionDenied` (PID mismatch). The system **must** use `--enrolled-pid-file` to decouple startup ordering.

---

## 2. Technical Analysis

### 2.1 Layer 1: Startup Order Race & Permanent Latching

#### Timeline of Events
1. **Prior State**: User stopped systemd helper daemon to prepare for manual launch. Systemd unlinked `/run/dam-hopper/idle-suspend.sock`.
2. **23:25**: UAT API server started as PID `726664`:
   ```bash
   /home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-server \
       --config /tmp/dam-hopper-uat/dam-hopper.toml --host 0.0.0.0 --port 4803
   ```
3. **23:25**: Server executed `server/src/main.rs:370-389`:
   ```rust
   let idle_suspend_executor: Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor> = {
       let socket_path = std::env::var("DAM_HOPPER_IDLE_SUSPEND_SOCKET")
           .map(PathBuf::from)
           .unwrap_or_else(|_| PathBuf::from("/run/dam-hopper/idle-suspend.sock"));
       if socket_path.exists() {
           tracing::info!(socket = %socket_path.display(), "Enrolling SystemdIdleSuspendExecutor with privileged helper");
           Arc::new(dam_hopper_server::idle_suspend::SystemdIdleSuspendExecutor::new(&socket_path))
       } else {
           tracing::info!(socket = %socket_path.display(), "Privileged helper socket not found; idle suspend executor will be unavailable");
           Arc::new(dam_hopper_server::idle_suspend::UnavailableExecutor::new(
               "Privileged helper socket not found at expected path",
           ))
       }
   };
   state.start_idle_suspend_coordinator(idle_suspend_executor).await;
   ```
   At 23:25, `/run/dam-hopper/idle-suspend.sock` did not exist.
   `socket_path.exists()` evaluated to `false`.
   `UnavailableExecutor` was constructed and passed to `state.start_idle_suspend_coordinator()`.
4. **State Storage (`server/src/state.rs:189-211`)**:
   `state.idle_suspend_coordinator` was populated once with `IdleSuspendCoordinator::start_with_sink(..., UnavailableExecutor, ...)`.
5. **23:26:11**: Helper manually started as PID `726813`:
   ```bash
   sudo /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper \
       --socket /run/dam-hopper/idle-suspend.sock \
       --audit-file /tmp/dam-hopper-uat/helper-audit.jsonl \
       --enrolled-pid 726664
   ```
   Helper created `/run/dam-hopper/idle-suspend.sock` (`stat /run/dam-hopper`: Birth `23:26:11`).
6. **Force Suspend Invocation (`POST /api/system/idle-suspend/v1/force-suspend`)**:
   - Handler in `server/src/api/idle_suspend.rs:422` calls `coordinator.force_suspend(cmd).await`.
   - In `server/src/idle_suspend/coordinator.rs:932-960`:
     ```rust
     let has_capability = tokio::time::timeout(Duration::from_secs(3), executor.check_capability())
         .await
         .unwrap_or_default();

     if !has_capability {
         return (
             CoordinatorForceSuspendResult::CapabilityUnavailable(
                 "Privileged helper capability probe failed or executor is unavailable".into(),
             ),
             None,
             None,
         );
     }
     ```
   - Executor is `UnavailableExecutor` (`server/src/idle_suspend/executor.rs:44-47`):
     ```rust
     impl IdleSuspendExecutor for UnavailableExecutor {
         fn check_capability(&self) -> BoxFuture<'_, bool> {
             Box::pin(async { false })
         }
     }
     ```
   - Returns `false` immediately without touching filesystem or IPC socket.
   - Handler in `server/src/api/idle_suspend.rs:465-472` maps `CapabilityUnavailable` to:
     ```rust
     idle_suspend_error_response(
         StatusCode::SERVICE_UNAVAILABLE,
         IdleSuspendErrorCode::CapabilityUnavailable.as_code_str(),
         "host lacks RTC alarm or suspend capability",
     )
     ```
   - Result: HTTP 503 `idleSuspendCapabilityUnavailable`.

---

### 2.2 Layer 2: Secondary Blocker (`NetworkManager` Delay Inhibitor)

Even if the server is restarted with the socket present, the call will **still fail** with 503 due to `preflight.rs:84-95`.

#### Execution Chain on Server Restart
1. Server starts, detects `/run/dam-hopper/idle-suspend.sock`, instantiates `SystemdIdleSuspendExecutor`.
2. Client calls `POST /api/system/idle-suspend/v1/force-suspend`.
3. `coordinator.rs:932` calls `executor.check_capability()`.
4. `SystemdIdleSuspendExecutor::check_capability()` (`executor.rs:88`) calls `client.check_capability().await`.
5. `HelperClient` sends `HelperRequestPayload::ProbeCapability` over `/run/dam-hopper/idle-suspend.sock`.
6. Helper authenticates peer credentials (`cred.pid == enrolled_pid`).
7. `HelperServer::handle_connection()` (`helper_server.rs:98-106`):
   ```rust
   HelperRequestPayload::ProbeCapability => {
       let (supported, detail) = match self.preflight.run_all() {
           Ok(()) => (true, "Host supports RTC wake and suspend".to_string()),
           Err(e) => (false, format!("Preflight check failed: {e}")),
       };
       let resp = HelperResponseFrame::new(HelperResponsePayload::Capability {
           supported,
           detail,
       });
       write_frame_async(stream, &resp).await?;
       return Ok(());
   }
   ```
8. `SysfsPreflightChecker::run_all()` runs:
   - `check_suspend_state()` -> PASS (`/sys/power/state` contains `mem`).
   - `check_rtc_wakealarm()` -> PASS (`/sys/class/rtc/rtc0/wakealarm` empty).
   - `check_sleep_inhibitors()` -> **FAILS**.

#### Host Inhibitor State
Output of `systemd-inhibit --list --no-legend` on this machine:
```
NetworkManager 0    root    1150   NetworkManager sleep NetworkManager needs to turn off networks delay
Oh My Pi       1000 loidinh 687586 omp            idle  Oh My Pi agent session                    block
Oh My Pi       1000 loidinh 687586 omp            idle  Oh My Pi agent session                    block
```

#### Flawed Parsing in `server/src/idle_suspend/preflight.rs:84-95`
```rust
let line_lower = line.to_lowercase();
if line_lower.contains("sleep") {
    let who = parts[0].to_string();
    let mode = parts.last().unwrap_or(&"block").to_string();
    let why = if parts.len() > 4 {
        parts[3..parts.len() - 1].join(" ")
    } else {
        "system sleep inhibited".to_string()
    };
    return Ok(Some(ActiveInhibitor::new(who, why, mode)));
}
```
1. `line_lower.contains("sleep")` matches the `NetworkManager` delay lock.
2. The logic ignores `mode == "delay"`. In systemd, `delay` inhibitors allow services up to 5 seconds to perform cleanup before sleep proceeds; only `block` inhibitors halt sleep.
3. Slicing bug `parts[3..parts.len() - 1]` misparses `WHY` as `"1150 NetworkManager sleep NetworkManager needs to turn off networks"` because systemd column order is `WHO UID USER PID COMM WHAT WHY MODE`.
4. `check_sleep_inhibitors()` returns `Err(PreflightError::Inhibited("NetworkManager (...) [mode: delay]"))`.
5. Helper returns `Capability { supported: false, detail: "Preflight check failed: system sleep inhibited: ..." }`.
6. Client maps to `has_capability = false` -> HTTP 503 `idleSuspendCapabilityUnavailable`.

---

### 2.3 Layer 3: Chicken-and-Egg Lifecycle Deadlock

```mermaid
flowchart TD
    subgraph Option A: Static PID [--enrolled-pid]
        A1[Start Helper with --enrolled-pid] -->|Requires Server PID| A2[Server must run first]
        A2 -->|Starts without socket| A3[Server latches UnavailableExecutor]
        A3 -->|503 on requests| A4[Restart Server to see socket]
        A4 -->|Server gets new PID| A5[Helper rejects: PID Mismatch]
        A5 --> A1
    end

    subgraph Option B: Dynamic PID File [--enrolled-pid-file]
        B1[Start Helper with --enrolled-pid-file /tmp/.../server.pid] -->|Binds socket| B2[/run/dam-hopper/idle-suspend.sock exists]
        B2 --> B3[Start Server: Sees socket -> SystemdIdleSuspendExecutor]
        B3 --> B4[Write Server PID to /tmp/.../server.pid]
        B4 --> B5[Client connects: Helper lazily reads PID file -> Authenticated]
    end
```

#### Why `--enrolled-pid <PID>` Deadlocks
- Helper requires unprivileged server's PID at launch time.
- If helper starts before server: Server PID is unknown.
- If server starts before helper: Helper socket does not exist; server permanently latches `UnavailableExecutor`.
- If server is restarted after helper launches: Server process acquires a new PID (e.g. `727xxx`), mismatching helper's static `--enrolled-pid 726664`. Helper rejects all requests with `permissionDenied: Peer PID mismatch`.

#### Why `--enrolled-pid-file <PATH>` Succeeds
In `server/src/idle_suspend/peer_auth.rs:94-104`:
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
Helper reads the PID file **lazily on each incoming connection**, not at startup.  
This allows helper to create the socket before the server starts, while authenticating the server's PID dynamically once written.

---

## 3. Supporting Evidence

### 3.1 Live Host Process State
```text
UID        PID    PPID  C STIME TTY          TIME CMD
1000      1466       1  1 07:49 ?        00:13:27 /opt/dam-hopper/releases/v0.2.0/both/bin/dam-hopper-server --port 4801
0       726664       1  0 23:25 ?        00:00:01 /home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-server --config /tmp/dam-hopper-uat/dam-hopper.toml --host 0.0.0.0 --port 4803
0       726813  726812  0 23:26 pts/16   00:00:00 /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper --socket /run/dam-hopper/idle-suspend.sock --audit-file /tmp/dam-hopper-uat/helper-audit.jsonl --enrolled-pid 726664
```
- Server started at `23:25`.
- Helper started at `23:26:11`.

### 3.2 VFS & Sysfs Inspection
- `/run/dam-hopper`:
  - Access/Modify/Birth: `2026-09-07 23:26:11.110287648 +0700`
  - Created by helper process at `23:26:11`, after server had already started and initialized.
- `/sys/power/state`:
  - `freeze mem disk` (mem supported).
- `/sys/class/rtc/rtc0/wakealarm`:
  - Empty string (alarm available and not busy).
- `systemd-inhibit --list --no-legend`:
  - Active lock: `NetworkManager 0 root 1150 NetworkManager sleep NetworkManager needs to turn off networks delay`.

---

## 4. Exact Restart & Execution Sequence for UAT

To test `POST /api/system/idle-suspend/v1/force-suspend` without code changes, execute the following sequence:

### Step 1: Terminate Stale Processes
```bash
# Stop stale server and helper
sudo kill 726813 726664 2>/dev/null || true
```

### Step 2: Handle Secondary Blocker (`NetworkManager` Delay Lock)
Because `preflight.rs:85` rejects all sleep locks regardless of `MODE=delay`, NetworkManager's sleep inhibitor must be temporarily removed for UAT preflight to pass:
```bash
# Temporarily stop NetworkManager during UAT probe (or restart NM without sleep inhibitor)
sudo systemctl stop NetworkManager
```
*(Note: Loopback interfaces `127.0.0.1` remain up. If remote SSH/Tailscale is used, verify connection before stopping).*

### Step 3: Launch Helper FIRST with Dynamic PID File
Run helper pointing to `/tmp/dam-hopper-uat/server.pid`:
```bash
sudo /opt/dam-hopper/current/bin/dam-hopper-idle-suspend-helper \
    --socket /run/dam-hopper/idle-suspend.sock \
    --audit-file /tmp/dam-hopper-uat/helper-audit.jsonl \
    --enrolled-pid-file /tmp/dam-hopper-uat/server.pid &
```
Verify socket creation:
```bash
test -S /run/dam-hopper/idle-suspend.sock && echo "Socket ready"
```

### Step 4: Launch Server SECOND
Launch server. Because `/run/dam-hopper/idle-suspend.sock` exists, `main.rs:374` initializes `SystemdIdleSuspendExecutor`:
```bash
/home/loidinh/WS/dam-hopper-ws/feat-terminal-idle-suspend/server/target/release/dam-hopper-server \
    --config /tmp/dam-hopper-uat/dam-hopper.toml \
    --host 0.0.0.0 \
    --port 4803 &
SERVER_PID=$!
echo $SERVER_PID > /tmp/dam-hopper-uat/server.pid
```

### Step 5: Test Force Suspend
Now invoke the endpoint:
```bash
curl -X POST http://127.0.0.1:4803/api/system/idle-suspend/v1/force-suspend \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <TOKEN>" \
    -d '{"wake_after_seconds": 600, "force": true}'
```
- Server connects to `/run/dam-hopper/idle-suspend.sock`.
- Helper reads `/tmp/dam-hopper-uat/server.pid`, authenticates `$SERVER_PID`.
- Helper runs preflight: sysfs power check passes, RTC wakealarm passes, sleep inhibitor check passes (NM stopped).
- Capability probe succeeds; force-suspend command proceeds to execution.

---

## 5. Recommended Permanent Code Fixes (For Subsequent Implementation Phase)

1. **Eliminate Boot-Time Socket Latching in `server/src/main.rs:370-389`**:
   `SystemdIdleSuspendExecutor` already checks `self.client.is_socket_present()` dynamically per request (`server/src/idle_suspend/executor.rs:85-87`). Replace the boot-time check with unconditional enrollment of `SystemdIdleSuspendExecutor(socket_path)`:
   ```rust
   let socket_path = std::env::var("DAM_HOPPER_IDLE_SUSPEND_SOCKET")
       .map(PathBuf::from)
       .unwrap_or_else(|_| PathBuf::from("/run/dam-hopper/idle-suspend.sock"));
   Arc::new(dam_hopper_server::idle_suspend::SystemdIdleSuspendExecutor::new(&socket_path))
   ```
   This allows helper to start or restart at any time without requiring server restart.

2. **Fix Sleep Inhibitor Discrimination in `server/src/idle_suspend/preflight.rs:84-95`**:
   - Check `mode == "block"`. Ignore `delay` inhibitors.
   - Fix column slicing to conform to systemd output format:
     ```rust
     let parts: Vec<&str> = line.split_whitespace().collect();
     if parts.len() >= 6 {
         let who = parts[0];
         let what = parts[parts.len() - 3]; // or column 5 depending on systemd version
         let mode = parts[parts.len() - 1];
         if what.contains("sleep") && mode.eq_ignore_ascii_case("block") {
             ...
         }
     }
     ```

3. **Standardize PID File Path**:
   Unify PID file path between `deploy/systemd/dam-hopper-idle-suspend-helper.service` (`/run/dam-hopper/server.pid`) and UAT runner (`scripts/run-uat.sh`).

---

## 6. Unresolved Questions

1. **Systemd Service PID Synchronization**: In production systemd deployment (`deploy/systemd/dam-hopper-api.service.in`), is systemd intended to write `/run/dam-hopper/server.pid` via `PIDFile=/run/dam-hopper/server.pid`, or should `dam-hopper-server` write its own PID file on startup?
2. **NetworkManager Delay Inhibitor Policy**: Should `SysfsPreflightChecker` strictly ignore all `delay` mode locks and only block on `block` locks, or should it maintain an explicit allowlist of system daemons (`NetworkManager`, `UPower`, `systemd-logind`)?
3. **Diagnostic Visibility**: When `executor.check_capability()` fails, `coordinator.force_suspend()` discards the error detail and returns generic `idleSuspendCapabilityUnavailable`. Should the internal failure reason (`detail`) be exposed in `GET /api/system/idle-suspend/v1/status` for observability?

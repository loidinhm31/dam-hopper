# Host Browser CDP Streaming Architecture

**Authority:** Backend Subsystem (`server/src/browser_host/`, `server/examples/browser_host_qualification.rs`)  
**Status:** Supervised Principal Profiles, Admission Control, Leased Input, Raw CDP Gateway, Screencast Producer, Bounded Media Fanout, Decoder Pipeline, OS Root Lifecycle Cutover, Secure Selection / Confirmed Logout Reset, and Integrated Security & Platform Qualification (Phases 01–09 Automated Checks Qualified; Physical Device & Windows Release Host Gates Pending; Phase 10 Unblocked)

This specification defines the architectural contracts, process containment boundaries, bounded CDP actor lifecycle, and binary wire framing for the Host Browser CDP Streaming subsystem.

## 1. Scope, Identity and Trust Model

The Host Browser subsystem provides candidate headless Chromium process management and CDP streaming primitives for developer browser sessions.

- **Principal Isolation:** Exactly one lazily launched Chromium instance per authenticated principal/server. Different authenticated principals never share browser processes or user-data directories.
- **Identity Hierarchy:**
  - `browserSessionId`: Authoritative server-issued UUID representing a single logical page target, distinct from native Chromium target IDs.
  - `browserIncarnation`: Fresh UUID minted on each browser process launch.
  - `profileEpoch`, `viewportEpoch`, `frameSeq`: Canonical decimal `u64` string counters matching `[1-9][0-9]{0,19}` with numeric values $\le 18446744073709551615$. Zero, leading zeros, signs, whitespace, and non-ASCII characters are rejected. Counters never wrap; exhaustion requires identity recreation.
  - `producerRun`, `subscriptionEpoch`: Fresh UUIDs for screencast runs and viewer subscriptions.
- **Trust Boundaries:** Raw CDP exposes full native browser and host privileges. Cooperative leases and target mappings do not sandbox an untrusted agent. Loopback debugging assumes local processes with loopback access can reach debug ports; stronger isolation requires external containerization.

## 2. Bounded CDP Actor and Command Budget

The CDP connection actor (`server/src/browser_host/cdp.rs`) manages a single WebSocket connection to the browser's DevTools endpoint with bounded resource admission:

```mermaid
flowchart LR
    Caller["Caller / API Handler"] -->|reserve_slot & try_reserve_bytes| Budget["Shared CommandBudget<br/>(Max 64 slots, 2 MiB total)"]
    Budget -->|CommandReservation RAII| Channel["Writer Queue Channel<br/>(Max 32 messages)"]
    Channel -->|Bounded 5s write| Actor["CDP Connection Actor<br/>(tokio-tungstenite)"]
    Actor -->|Duplex WebSocket| Chrome["Headless Chromium"]
    Chrome -->|Screencast Frame| Actor
    Actor -->|Immediate ACK| Chrome
    Actor -->|Broadcast| ScreencastRx["Screencast Broadcast Channel"]
```

### Resource Admission Bounds

| Resource Ceiling | Limit | Enforcement Mechanism |
| --- | --- | --- |
| Writer Queue Channel | 32 messages | `mpsc::channel(32)`; saturation returns `CdpError::WriterQueueFull` |
| Total Admitted Commands | 64 commands | Shared across queued and in-flight commands; returns `CdpError::TooManyPendingCommands` |
| Command Byte Budget | 2 MiB (2,097,152 bytes) | Shared RAII `CommandBudget` reservation held from pre-serialization until response or drop |
| Single Command Payload | 64 KiB (65,536 bytes) | Serialization ceiling; payloads $> 64$ KiB return `CdpError::CommandTooLarge` |
| Actor Write Deadline | 5 seconds | Stalled writes pause actor reads/sweeps; timeout aborts connection |
| WebSocket Frame/Message Cap | 4 MiB (4,194,304 bytes) | Tungstenite `max_message_size` and `max_frame_size` |

### RAII Budget Lifecycle (`command_budget.rs`)

`CommandReservation` guarantees that reserved command slots and payload bytes are atomically returned to `CommandBudget` when the reservation is dropped across any termination path: normal response receipt, caller deadline timeout, caller cancellation, or connection teardown.

### Response and Screencast Frame Routing

- **Response Demultiplexing:** Responses are routed to callers by monotonic numeric command ID. Unknown events increment an atomic counter (`unknown_events_count`) without allocating queue slots.
- **Screencast Frame Handling:** `Page.screencastFrame` events are validated for finite metadata (`offsetTop`, `pageScaleFactor`, `deviceWidth`, `deviceHeight`, `scrollOffsetX`, `scrollOffsetY`) and broadcast to subscribers.
- **Native Frame Credit Decoupling:** `CdpClient::ack_screencast_frame` acknowledges frames back to Chromium independently of downstream viewer consumption, preventing stalled viewers from exhausting native frame credits.
- **Fail-Closed Malformed Envelopes:** A malformed known screencast frame (unparseable envelope, missing session ID, non-finite geometry) has no routable caller and closes the actor with `CdpError::MalformedResponse`.

## 3. Fail-Closed Process Supervision & Containment Model

Process management (`server/src/browser_host/process.rs`) supervises Chromium execution with fail-closed containment:

### Launch Configuration & Allowlist

- **No Automatic Discovery:** `find_browser_executable(None)` fails closed with `ProcessError::ExecutableNotFound` when `DAM_HOPPER_BROWSER_EXECUTABLE` is not explicitly set. Automatic PATH or standard-directory scanning is prohibited.
- **Strict Argument Allowlist (`is_allowlisted_arg`):**
  - **Permitted Prefixes:** `--window-size=`, `--user-agent=`, `--lang=`, `--force-device-scale-factor=`, `--default-background-color=`.
  - **Explicitly Forbidden Flags:** `--remote-debugging*`, `--remote-allow-origins*`, `--user-data-dir*`, `--load-extension*`, `no-sandbox`, `disable-web-security`, `ignore-certificate-errors`, `disable-site-isolation`, `password-store`, `use-mock-keychain`, `disable-hang-monitor`, `disable-ipc-flooding`, `disable-renderer-backgrounding`, `disable-backgrounding-occluded`, `disable-background-timer-throttling`.
  - All default Chromium sandboxing, certificate verification, and site isolation protections remain active.

### Unix Process Group & Death-Pipe Watcher

- **Linux 6.9+ Kernel Requirement (`PIDFD_SIGNAL_PROCESS_GROUP`):** Chromium process launch strictly requires Linux 6.9+ for process group pidfd signalling (`pidfd_send_signal(PIDFD_SIGNAL_PROCESS_GROUP)`) and `close_range` (5.9+). Spawns Chromium in a dedicated process group (`process_group(0)`).
- **Bidirectional Death-Pipe Watcher:** The dedicated watcher process (`process/death_watcher.rs`) holds a leader pidfd acquired prior to fork and signals the kernel's process group object directly rather than a numerical PGID. Supervisor termination drops the anonymous POSIX death pipe; the watcher receives `EOF` on `death_r` and executes `pidfd_send_signal` against the process group, ensuring orphaned renderer and utility processes are terminated without risking signalling recycled process group IDs after leader reap. On kernels without `PIDFD_SIGNAL_PROCESS_GROUP` (< 6.9, e.g. Ubuntu 24.04 6.8), watcher arming fails with `EINVAL` and launch fails closed; legacy pre-6.9 killpg/procfs fallbacks are permanently deleted.
- **Dual-Stage Liveness Verification:** `live_members(pgid)` verifies termination via pidfd probe and `/proc` process-tree scanning against captured launch token markers.
- **Graceful Shutdown Protocol:** Sends `SIGTERM` with a 3-second grace period (`SHUTDOWN_GRACE_PERIOD_SECS`), followed by `SIGKILL` if processes survive.
- **Non-Positive PGID Rejection:** During unmanaged prior process group cleanup (e.g. after daemon restart or crash recovery), any stored `process_pgid <= 1` (where `0` represents current process group, `-1` all processes, and `1` init/systemd) is rejected fail-closed. Tombstone stage transitions to `ResetStage::Failed`, error records `invalid non-positive PGID {pgid}`, and the instance transitions to `InstanceLifecycleState::CleanupPending`, refusing to signal host or init processes.
- **Durable Containment Fencing:** Process group containment is proven before completing process launch or profile wipe. If processes survive the 3-second `SIGTERM` grace period and 2-second `SIGKILL` proof deadline, the failure is recorded in an atomic `reset.json` tombstone and the profile enters `CleanupPending`. On server restart, `load_tombstone` recovers this state and fences subsequent launch attempts until resolved.

### Endpoint Discovery and Loopback Validation

- **Bounded Stream Reading:** Stderr is consumed in 1024-byte chunks up to a hard ceiling of 64 KiB (`MAX_STDERR_CAPTURE_BYTES = 65_536`). Oversized stderr streams without an endpoint token fail closed with `ProcessError::StderrOverflow`.
- **DevToolsActivePort Corroboration:** When present, `DevToolsActivePort` (read up to 512 bytes) is corroborated against the stderr endpoint; mismatch between port file and stderr fails closed with `ProcessError::EndpointMismatch`.
- **Loopback Enforcement (`validate_loopback_endpoint`):** Endpoints must parse as `ws://`, bind strictly to `127.0.0.1`, `[::1]`, or `localhost`, specify an explicit non-zero port, and match `/devtools/browser/<canonical-uuid>` where the UUID is a 36-character lowercase RFC 4122/9562 UUID.
- **Non-Unix Platform Containment:** On non-Unix platforms (such as Windows), `BrowserProcess::launch` fails closed immediately with `ProcessError::ContainmentUnavailable`. Windows containment remains unimplemented; no qualification is claimed.

## 4. Binary Wire Framing Protocol (BHJF v1)

Streaming frames from the server to viewers use the atomic `BHJF` binary envelope (`server/src/browser_host/protocol.rs`):

```text
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|   'B'   |   'H'   |   'J'   |   'F'   |        version (1)    |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       json_header_len         |           payload_len         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|    payload_len (continued)    |            reserved           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                      reserved (continued)                     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| JSON Header Bytes (1 .. 1024 bytes) ...                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| JPEG Payload Bytes (1 .. 2,097,152 bytes) ...                 |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Header Specification

- **Header Size:** Fixed 16-byte big-endian prefix.
- **Magic:** `0x42 0x48 0x4A 0x46` (`BHJF`).
- **Version:** `1` (`u16`).
- **JSON Header Length:** `u16` ($\le 1024$ bytes).
- **Payload Length:** `u32` ($\le 2,097,152$ bytes / 2 MiB).
- **Reserved:** `u32` (must be zero).

### Frame Geometry & Decimal Counters

`TargetFrameHeader` enforces strict validation rules:
- **Canonical Decimal Counters:** `profileEpoch`, `viewportEpoch`, and `frameSeq` are non-empty positive ASCII decimal strings $\le \text{u64::MAX}$ without signs, whitespace, or leading zeros (`validate_decimal_sequence`).
- **CSS Viewport Ceilings:** Layout viewport width $\in (0, 1920]$, height $\in (0, 1080]$.
- **Scale Bounds:** `dpr` $\in [0.1, 10.0]$, `pageScale` $\in [0.1, 10.0]$.
- **Offset Bounds:** Absolute offsets $\le 10,000,000$ CSS px.
- **Payload Consistency:** Declared header `width` and `height` must match JPEG SOF0/SOF2 marker dimensions exactly.

## 5. Authenticated Agent CDP Gateway & Upstream Relay (`cdp_gateway.rs`)

The production CDP Gateway (`server/src/browser_host/cdp_gateway.rs`) exposes authenticated raw Chrome DevTools Protocol access to external automation clients (e.g. Playwright via `connectOverCDP`):

### Discovery Endpoint Rewriting

CDP discovery routes (`GET /api/browser/cdp/json/version`, `GET /api/browser/cdp/json/list`, and `GET /api/browser/cdp/json`) authenticate callers and proxy metadata from the running Chromium instance:
- **Gateway WS Base Resolution:** Rewrites internal `webSocketDebuggerUrl` and `devtoolsFrontendUrl` to public gateway WebSocket endpoints (`/api/browser/cdp/ws` or `/api/browser/cdp/ws/{target_id}`). The public URL is derived strictly from operator-configured `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` (scheme and authority only, mapping `http` to `ws` and `https` to `wss`), or in guarded `--no-auth` development mode with a verified loopback bound listener socket. The request `Host` and forwarded headers (`X-Forwarded-Host`, `X-Forwarded-For`) are never consulted or reflected; an unconfigured origin rejects discovery with HTTP 503 Service Unavailable (`kind: "publicOriginUnavailable"`).
- **Endpoint Sanitization:** Internal loopback DevTools ports (e.g. `127.0.0.1:xxxxx`) are stripped from frontend URLs before returning to callers.
- **Payload Bounds:** Discovery target list payloads from Chromium are strictly bounded to 256 KiB; oversized responses fail closed with HTTP 502 Bad Gateway.

### Exact Single Origin Policy

Origin validation enforces strict single-origin invariants (`validate_cdp_origin`):
1. **Single Header Enforcement:** Multiple `Origin` headers (`headers.get_all(header::ORIGIN).iter().count() > 1`) fail closed with HTTP 403 Forbidden (`kind: "forbiddenOrigin"`).
2. **Format Sanitation:** Origins equal to `"null"`, ending in a trailing slash (`/`), or containing commas (`,`) fail closed with HTTP 403 Forbidden.
3. **Allowlist Matching:** Evaluates byte-for-byte exact equality against approved origins (`server.cors_origins`, `public_server_origin`, and in dev `browser.allowed_dev_origins`). An empty allowlist approves nothing (denies all Origin-bearing requests).
4. **Origin-less Requests:** Permitted strictly for clients presenting bearer credentials (`Authorization: Bearer <token>`) or loopback development bypass. Origin-less requests without bearer authentication fail closed with HTTP 403 Forbidden.
5. **Oracle Mitigation:** Discovery endpoints evaluate caller authentication before validating Origin headers; unauthenticated requests fail with HTTP 401 Unauthorized, preventing unauthenticated origin enumeration or probing.

### Canonical Claims Evaluation & MFA Integration

Browser host admission integrates directly with the canonical authentication service (`authenticate_browser_caller` in `api/browser_host.rs`):
- Decodes `AuthClaims` from Bearer tokens or cookies and executes `state.auth_service.evaluate_claims(&claims)`.
- Enforces multi-factor authentication requirements: computes effective session deadlines via `crate::auth::compute_mfa_due_at(mfa_verified_at, expires_at)`.
- `AuthDecision::MfaRequired` returns HTTP 401 Unauthorized (`kind: "mfaRequired"`).
- `AuthDecision::FullLoginRequired` returns HTTP 401 (`kind: "invalidSession"`) or HTTP 403 (`kind: "accountDisabled"`).
- `AuthDecision::Unavailable` returns HTTP 503 Service Unavailable (`kind: "authUnavailable"`).
- Revalidates active session in the database: `revoked_at.is_none()`, `auth_version` and `credential_version` match user records, and caller holds the enabled `Admin` role (`UserRole::Admin`).

### Server-Derived Capability Tickets & Subprotocol Upgrade

Clients connecting without Bearer headers may authenticate using single-use capability tickets:
- Issued exclusively via server endpoint `POST /api/browser/attachments` with `purpose: "agentCdp"`.
- 256-bit random entropy from `rand::rngs::OsRng`, URL-safe unpadded Base64 encoded; server stores only the 32-byte SHA-256 hash in memory.
- Expiration: 30 seconds (`TICKET_TTL`), clipped to caller auth session deadline.
- Redeemed via WebSocket subprotocol: `Sec-WebSocket-Protocol: damhopper.browser.cdp.v1, damhopper.ticket.<base64url>`.
- Single-use atomic consumption: consumed ticket is removed immediately from the ticket store.
- Validates that running instance `browserIncarnation` and `profileEpoch` match the ticket.

### Foreign Session Checks

Every session retrieval, mutation, navigation, or control operation verifies ownership:
- If the target session ID exists but is owned by another principal, the lookup returns `SessionError::NotFound` (HTTP 404 `kind: "sessionNotFound"`), indistinguishable from a non-existent session.
- Prevents cross-principal session presence discovery, ID enumeration, or information leakage.

### Bounded Upstream Relay & Concurrency Bounds

- **Concurrency Ceiling:** Max 2 concurrent agent CDP connections globally by default (`DEFAULT_MAX_AGENT_CDP_CONNECTIONS = 2`), guarded by `Semaphore`. Admissions when saturated return HTTP 429 Too Many Requests (`kind: "browserBusy"`).
- **Dedicated Upstream Per Agent:** Each agent WebSocket connection spawns a dedicated, unshared upstream WebSocket client to Chromium's DevTools endpoint with a 5-second connection deadline (`UPSTREAM_CONNECT_TIMEOUT = 5s`). No multiplexing through internal screencast actors.
- **Framing & Write Bounds:** Bounded to 4 MiB frame and message caps (`MAX_WS_MESSAGE_BYTES = 4_194_304`). Outgoing socket writes enforce a 5-second deadline (`WRITE_DEADLINE = 5s`).

### Live Auth Cancellation Racing with Socket Writes & Fast Teardown

Long-running CDP relays do not rely solely on initial handshake authentication:
1. **Continuous Auth Supervisor:** Spawns a background task running every 5 seconds (`LIVE_CHECK_INTERVAL`) with a 2-second database timeout (`LIVE_CHECK_TIMEOUT`) calling `verify_live_admission`.
2. **Live Demotion & Revocation:** Detects account disabling, demotion from Admin role, session revocation, or credential/auth version increments.
3. **Cancellation Racing with Writes (`write_with_cancel`):** Outgoing socket writes wrap send futures with `write_with_cancel`, which uses `tokio::select!` to race the write future against an auth cancellation receiver channel (`auth_abort_rx`). If auth is revoked while a socket write is stalled or in progress, the write is aborted immediately without waiting for the 5-second write deadline.
4. **Fast Teardown:** If aborted due to auth failure (`aborted_by_auth == true`), the relay skips the cooperative 500ms WebSocket close handshake (`close(None)`), dropping client and upstream sockets immediately to prevent data leakage.
5. **Instance Authority Warning:** Attaching to the raw CDP gateway grants instance-wide authority, bypassing cooperative input leases and target fences. The connection registers with the manager (`register_agent_cdp`) and logs an authoritative security warning.
## 6. Configuration Schema & Admission Budgets (`config.rs`)

The browser host subsystem is configured under `[server.browser]` in `config.toml` (with legacy top-level `[browser]` mapped transparently into `server.browser`).

### Configuration Model (`BrowserHostConfig`)

| Field | Type | Default | Validation & Semantics |
| --- | --- | --- | --- |
| `enabled` | `bool` | `false` | Master enable switch. Defaults to `false` until an executable and origin policy are configured. |
| `executable_path` | `Option<PathBuf>` | `None` | Path to browser binary. Must be regular file with execute permissions (`mode & 0o111 != 0`) and not world-writable (`mode & 0o002 == 0`). |
| `profile_root` | `Option<PathBuf>` | `None` | Base directory for principal profiles. Defaults to `~/.config/dam-hopper/browser-profiles`. Must not be a symlink; directory permissions must be strictly mode `0700` (`mode & 0o077 == 0`). |
| `allowed_target_origins` | `Vec<String>` | `[]` | Approved target page origins. Strictly formatted (`http://` or `https://`, host, optional port; credentials, query, fragment, path segments, and trailing slashes forbidden). |
| `allowed_asset_origins` | `Vec<String>` | `[]` | Approved asset origins for viewer frames and static resources. Strictly formatted. |
| `allowed_dev_origins` | `Vec<String>` | `[]` | Approved developer debug origins. Strictly formatted. |
| `denied_destinations` | `Vec<String>` | Cloud metadata IPs | Blocked destination addresses. Default list: `169.254.169.254`, `fd00:ec2::254`, `metadata.google.internal`, `100.100.100.200`. Formats: IP, IP CIDR, hostname, or `host:port`. |
| `budgets` | `BrowserBudgetsConfig` | Defaults below | Structured admission bounds and memory limits. |

### Budget Limits (`BrowserBudgetsConfig`)

| Budget Field | Default | Range | Enforcement Mechanism |
| --- | --- | --- | --- |
| `max_processes` | `1` | `1 ..= 4` | Capped by global process atomic counter; excess returns `ManagerError::Busy` (HTTP 429) |
| `max_targets` | `2` | `1 ..= 16` | Maximum concurrent page targets per principal |
| `max_viewers` | `2` | `1 ..= 16` | Maximum concurrent streaming viewers per target |
| `max_raw_cdp_connections` | `2` | `1 ..= 8` | Maximum concurrent raw CDP proxy WebSocket connections |
| `memory_ceiling_bytes` | `134,217,728` (128 MiB) | `33,554,432` (32 MiB) ..= `1,073,741,824` (1 GiB) | Hard memory ceiling checked against worst-case allocation |
| `jpeg_quality` | `65` | `10 ..= 100` | Screencast JPEG encoding quality |
| `max_width` | `1280` | `64 ..= 1920` | Maximum capture frame width |
| `max_height` | `900` | `64 ..= 1080` | Maximum capture frame height |
| `frame_rate_fps` | `10` | `1 ..= 30` | Maximum screencast capture frame rate |

### Memory Reservation Bounds Calculation

The budget validator enforces an analytical ceiling check:
$$\text{estimated} = (\text{max\_targets} \times 12.1\text{ MiB}) + (\text{max\_viewers} \times 4.2\text{ MiB}) + (\text{max\_raw\_cdp} \times 8.0\text{ MiB}) \le \text{memory\_ceiling\_bytes}$$

- **Per-Target (~12.1 MiB):** 2 MiB command budget + 4 MiB WS event buffer + 4 MiB candidate buffer + ~2.1 MiB complete BHJF buffer.
- **Per-Viewer (~4.2 MiB):** 2 outstanding + 1 pending Bytes handles (buffered) + writer queue.
- **Per-Raw-CDP (8.0 MiB):** 4 MiB frame buffer per direction.
Configurations exceeding the memory ceiling fail validation with `BrowserConfigError::MemoryCeilingExceeded`.

### Domain Capability Evaluation (`evaluate_capabilities`)

Direct probe evaluating subsystem capabilities without launching Chromium or making network calls:
- Returns `BrowserCapabilitiesDto` (`protocolVersion: 1`, `available: bool`, `unavailableReason: Option<String>`, `effectiveLimits: BrowserEffectiveLimitsDto`, `engineQualified: bool`, `profileEpoch: String`, `managedProfilePresent: bool`).
- Reports explicit `unavailableReason` for disabled status, non-Unix platform, missing executable, invalid permissions, overbudget memory ceiling, or active reset tombstone (`CleanupPending`).
- Never exposes internal loopback debug ports or URLs.

## 7. Principal Profile Directory Layout & Advisory Flock Exclusivity (`profile.rs`)

Principal isolation ensures that different authenticated users never share browser processes, cookies, or user-data directories.

### Filesystem Layout

Profiles are organized under `<profile_root>/` by namespace and hashed subject:

```text
<profile_root>/
├── dev/                     # Development namespace (--no-auth mode)
│   └── <sha256(subject)>/   # 64-character hex hash, mode 0700
│       ├── manager.lock     # Advisory flock target (stable inode, never deleted)
│       ├── manager.json     # Metadata record (mode 0600, atomic write)
│       ├── reset.json       # Durable reset tombstone (mode 0600; active during reset)
│       └── user-data/       # Chromium user-data directory (mode 0700; deleted on reset)
└── prod/                    # Production authenticated namespace
    └── <sha256(subject)>/
        ├── manager.lock
        ├── manager.json
        ├── reset.json
        └── user-data/
```

- **Non-User-Controlled Paths:** Principal directories use 64-char lowercase SHA-256 hashes of the principal subject, preventing path traversal attacks.
- **Strict POSIX Permissions:** Principal directories and parent namespace directories are created with mode `0700` (`rwx------`). Metadata and tombstone files use mode `0600` (`rw-------`). Symbolic links for profile roots are forbidden.
- **Advisory OS Lock (`ProfileLock`):** Holds open `manager.lock` via non-blocking `flock(fd, LOCK_EX | LOCK_NB)` on Unix. Released automatically on drop (`LOCK_UN`). Lock wait timeout is bounded to 5 seconds (`DEFAULT_LOCK_TIMEOUT`). The lock file inode is preserved across profile resets.
- **Profile Lock Retention Across Resets:** Exclusive OS advisory `flock` (`manager.lock`) is retained across resets and restarts on a stable file inode directly in the principal directory (`<profile_root>/<namespace>/<sha256(subject)>/manager.lock`). The lock file itself is never deleted during profile reset or credential wipe (only `user-data/` is purged and recreated), preventing file lock races, directory unlinking races, or concurrent process spawns during teardown.

### Metadata Schema & Durable Persistence Pipeline (`manager.json`, `profile.rs`)

Every persistent metadata and tombstone mutation executes a four-stage durability pipeline (`write_durably`):
1. **Mode 0600 Temp File:** Serializes JSON into a unique temporary file (`.<name>.tmp.<pid>.<uuid>`) with mode `0600` (`rw-------`).
2. **File Fsync:** Flushes bytes and file metadata to disk (`FileSync`).
3. **Atomic Rename:** Renames the temp file over the final target (`Rename`).
4. **Directory Fsync:** Calls `fsync` on the parent principal directory (`DirSync`) to make directory entry creation durable across system crashes. Tombstone unlinking similarly performs directory fsync.

**Persisted Process Identity (`ContainmentIdentity`):**
- `pid` and `pgid`: Numeric process and group identifiers.
- `startTime`: Kernel start time read from field 22 of `/proc/<pid>/stat`, preventing PID recycling confusion.
- `bootId`: System boot ID distinguishing restarts.
- `launchToken`: Unique UUID token exported via environment variable `DAM_HOPPER_BROWSER_LAUNCH_TOKEN` to Chromium and all child processes. A launch intent marker is written and synced to `manager.json` *before* process spawn so crash recovery can reconcile surviving trees.
- `ProfileFaults`: Test-only fault injector allowing automated suites to simulate step-specific I/O failures across `FileSync`, `Rename`, `DirSync`, `Unlink`, and `UserData` operations.

**Metadata Fields (`manager.json`):**
- `subject`: Principal identifier string.
- `isDev`: Boolean distinguishing `--no-auth` dev mode from authenticated production profiles.
- `profileEpoch`: Monotonic `u64` counter matching `[1-9][0-9]{0,19}`.
- `browserIncarnation`: Fresh UUID minted on each process launch; `null` when dormant.
- `containment`: Captured `ContainmentIdentity`.
- `updatedAtUnixMs`: Millisecond Unix timestamp of last update.
- `lastResetOperationId`: Optional UUID of last successfully completed reset operation (for idempotence).
## 8. Reset Reconciliation & Durable Tombstone Lifecycle (`manager.rs`)

The reset state machine purges user credentials (`user-data/`) and recreates a fresh profile while maintaining process exclusivity and preventing concurrent operations.

### Reset Sequence (`reset_profile_with_hooks`)

1. **Acquire Lock & Live Admin Recheck:** Acquires exclusive `ProfileLock` on `manager.lock` (up to 5s timeout) and executes `ResetFenceHooks::recheck_admin` (`verify_live_admin_for_reset`) before modifying profile state.
2. **Idempotence & Epoch Validation:** Returns `ResetOutcome::Completed` immediately if `meta.last_reset_operation_id == Some(operation_id)`; resumes interrupted `reset.json` when `operation_id` matches; otherwise verifies `meta.profile_epoch == expected_profile_epoch` (`ManagerError::StaleEpoch`).
3. **Advance Epoch & Persist Tombstone:** Increments `profileEpoch`, writes `reset.json` (`ResetStage::Initiated`) and `manager.json` atomically, updates `live_profile_epochs`, and spawns a manager-owned worker (returning `ResetOutcome::CleanupPending` after `DEFAULT_RESET_WAIT_TIMEOUT = 2s` while the worker continues).
4. **Synchronous Fence & Bounded Async Teardown:** Inside worker ownership, runs `sync_fence` (revokes attachments, closes sessions/input managers, fences selection state and `ManagedBrowser` artifacts) followed by `async_teardown` (deletes fenced artifact files before bounded CDP/producer removal within 2s).
5. **Terminate Process & Delete User Data:** Executes bounded 10s process termination (`DEFAULT_TERMINATE_TIMEOUT`), bounded 10s `user-data/` deletion (`DEFAULT_DELETE_TIMEOUT`), and `0700` `user-data/` recreation; failure persists `ResetStage::Failed` and `CleanupPending`.
6. **Clear Tombstone & Status Polling:** Records `last_reset_operation_id`, clears `reset.json` durably (unlink + dir fsync), and returns `Dormant`; `GET /api/browser/profile/reset/{operationId}` inspects active workers, tombstones, and metadata via `get_reset_status`.

### Tombstone & Crash Reconciliation Recovery

On server restart or subsequent launch attempts under exclusive `ProfileLock`:
- **Prior Tree Reconciliation:** Scans processes carrying the matching `launchToken`, boot ID, and kernel start time before launching a new browser or running resets, safely signalling orphaned trees.
- **Interrupted Resets:** Resumes interrupted operations from persisted `reset.json` stage markers without clobbering epochs.
- **Creation Marker Reconciliation:** If a browser crashed during target creation, lost pages tagged with `about:blank#dh-<session_id>` are discovered and reconciled or safely cleaned up.

| Stage | Trigger / Transition | Failure Behavior |
| --- | --- | --- |
| `Initiated` | Reset requested and epoch validated | Atomically written before process termination |
| `Terminating` | Process termination signaled | 10s timeout; failure sets `Failed` stage and `CleanupPending` |
| `DeletingUserData` | Process confirmed dead | 10s timeout; failure sets `Failed` stage and `CleanupPending` |
| `RecreatingUserData` | `user-data/` removed | Directory creation with mode `0700`; failure sets `Failed` stage |
| `Failed` | Timeout or I/O error during reset | Tombstone retained; profile enters `CleanupPending` |

- **Startup Reconciliation:** When loading an instance, `BrowserHostManager` checks for `reset.json`. If present, the instance enters `CleanupPending`:
  - `capabilities()` reports `available: false` with reason `"profile cleanup pending from prior failed reset or termination; recovery or confirmed reset required"`.
  - `ensure_running()` fails closed with `ManagerError::CleanupPending`.
  - Resuming reset: Invoking `reset_profile` with the matching `operation_id` resumes the interrupted reset under lock.

## 9. Lazy AppState Lifecycle & Graceful Shutdown (`state.rs`, `main.rs`)

### Lazy Manager Integration

`BrowserHostManager` is constructed during `AppState::new` as an `Arc<BrowserHostManager>`:
- **Zero Startup Spawning:** No browser processes are launched during server initialization or `AppState` creation. Processes are spawned lazily only when `ensure_running()` is explicitly called by browser workflows.
- **Global Process Capacity Admission:** Managed by an atomic counter `global_process_count` capped at `budgets.max_processes` (default 1). Admissions exceeding capacity fail closed with `ManagerError::Busy` (HTTP 429).
- **Reconnect Deduplication:** Reconnecting clients reuse the existing alive browser instance handle (`BrowserInstanceHandle { pid, ws_endpoint, browser_incarnation, profile_epoch, user_data_dir }`) without consuming additional process capacity. Stale processes (dead PID) are detected and cleaned up before relaunching.

### Graceful Server Teardown Protocol

During server shutdown (`server/src/main.rs`), `browser_host.shutdown_all().await` executes alongside debug artifact disposal:
1. Iterates across all active principal instances in `instances` map.
2. For each running instance, extracts the `BrowserProcess` handle and executes `proc.terminate()` with a bounded 10-second deadline (`DEFAULT_TERMINATE_TIMEOUT`).
3. Clears in-memory active target maps, viewer counters, and raw CDP connection counters.
4. Transitions instance lifecycle states to `Dormant`.
5. Resets `global_process_count` to zero.
6. **Credential Preservation:** Ordinary shutdown terminates browser processes and cleans up runtime locks, but strictly preserves the `user-data/` directory and persisted profile credentials.

## 10. Admission Security Model & Live Session Verification (`auth.rs`)

Every HTTP and WebSocket request to `/api/browser/*` undergoes strict admission evaluation via `evaluate_browser_admission`:

### Dual-Mode Admission Control

- **Production Authentication:** Requires a valid bearer token or auth cookie. Evaluates the database live:
  - Account exists and `is_enabled == true`.
  - User holds the `Admin` role (`UserRole::Admin`); ordinary users receive HTTP 403 `kind: "adminRequired"`.
  - Session exists and is not revoked (`revoked_at.is_none()`).
  - Token `auth_version` and `credential_version` match active user and session database records.
  - Token `effective_deadline` has not passed.
- **Development Bypass (`state.no_auth == true`):**
  - Requires `state.no_auth` AND an actually bound loopback listener address (`bound_listener`) AND a loopback peer socket (`127.0.0.1` or `::1`). If either listener or peer is non-loopback (or listener address is unknown), admission fails closed with HTTP 403 `kind: "devBypassDenied"`.
  - Forwarded headers (`X-Forwarded-For`, `X-Real-IP`, `Forwarded`) are explicitly ignored; only raw socket addresses are evaluated.
  - Any `Origin` header must strictly match approved origins (`server.cors_origins`, trusted `public_server_origin`, or `allowed_dev_origins`, falling back to local Vite ports `http://127.0.0.1:5173`, `http://localhost:5173` only when no dev origins are configured). An empty allowlist approves nothing.
  - Loopback requests without Origin (local native CLI/agents) are permitted. Assigned principal is `"dev-user"` with `is_dev: true`.
### Periodic Live Verification (`verify_live_admission`)

Long-running streaming connections and active attachments do not rely on static handshake validation alone:
- Checked every 5 seconds (`LIVE_CHECK_INTERVAL`) with a strict 2-second timeout (`LIVE_CHECK_TIMEOUT`).
- Detects database account disablement, demotion from Admin role, session revocation, or credential version increments.
- Bounded cancellation triggers an independent `CancellationToken` shared across the attachment pair, terminating connections immediately without waiting for stalled outgoing media queues.

## 11. Single-Use Capability Tickets & Attachment Management (`attachments.rs`)

Streaming WebSockets (`/ws/browser/media`, `/ws/browser/control`, `/ws/browser/cdp`) require a capability ticket minted via `POST /api/browser/attachments`:

### Ticket Lifecycle & Memory Storage

1. **Generation:** 256-bit (32-byte) cryptographically secure random value generated by `rand::rngs::OsRng`, URL-safe unpadded Base64 encoded (`URL_SAFE_NO_PAD`).
2. **Hash-Only Storage:** Server stores only the 32-byte SHA-256 hash in memory (`HashMap<[u8; 32], StoredTicket>`). Raw ticket tokens are never stored, logged, or serialized.
3. **Atomic Single-Use Consumption:** `consume_ticket` atomically removes the ticket hash from the map on connection upgrade. Replay attempts fail immediately with HTTP 401 `kind: "ticketNotFound"`.
4. **Purpose & Identity Binding:** Tickets strictly bind `purpose` (`media`, `control`, `agentCdp`), principal, auth session ID, versions, deadline, `profileEpoch`, `browserIncarnation`, `browserSessionId`, `viewerId`, `subscriptionEpoch`, and issuing `Origin`.
5. **Bounded TTL & Capacity:** 30-second TTL (`TICKET_TTL`), clipped to auth session deadline. Unconsumed tickets capped at 16 per principal and 64 globally; excess returns HTTP 429 `kind: "ticketCapacityExceeded"`.
6. **Media/Control Pairing (`PairedSlot`):** Media and control connections must specify identical `viewerId` and `subscriptionEpoch`. The first arriving socket waits up to 15 seconds (`PAIR_WAIT_TIMEOUT`) for its counterpart; timeout evicts the slot and cancels both connections.

## 12. Cooperative Leased Input Queue & Coordinate Transformation (`input.rs`)

Target interaction enforces strict single-viewer authority and reliable event delivery:

### Cooperative Lease Semantics

- **30-Second Lease:** Acquired via `POST /api/browser/sessions/{id}/control/acquire` (`LEASE_TTL = 30s`). Renewed within 5s window (`LEASE_RENEWAL_WINDOW = 5s`).
- **Exclusivity:** Only one viewer (`human` or `agent`) holds control. Conflicting acquire returns HTTP 409 `kind: "leaseConflict"`.
- **Fail-Safe Release (`HeldInputState`):** Tracks currently held mouse buttons and keyboard keys. When a lease is released, expired, revoked, or dropped, `generate_release_events` automatically generates synthetic `PointerUp` and `KeyUp` events to clear stuck keys/buttons in Chromium.

### Reliable Input Queue & Sequencing

- **Queue Bounds:** Max 128 reliable records (`MAX_RELIABLE_RECORDS`), max 256 KiB queued bytes (`MAX_RELIABLE_BYTES`).
- **Decimal Sequence Ordering (`inputSeq`):** Enforces strictly contiguous decimal sequence counters (`inputSeq == last_processed_seq + 1`).
  - Sequence gap: Returns HTTP 400 `kind: "sequenceViolation"`, flushes queue, clears held keys, and revokes lease.
  - Stale sequence: Dropped with HTTP 400 `kind: "sequenceViolation"`.
- **Event Coalescing:** Adjacent `PointerMove` and `Wheel` events are coalesced between ordering barriers (`PointerDown`, `PointerUp`, `KeyDown`, `KeyUp`, `InsertText`).

### Coordinate Mapping (`map_fraction_to_css_coords`)

Transforms normalized aspect-fit image fractions $(u, v) \in [0.0, 1.0]$ into CDP CSS layout coordinates:
$$x = u \times \text{css\_width}, \quad y = v \times \text{css\_height} + \text{offset\_top}$$
- Validates finite bounds; out-of-range returns `InputError::InvalidFraction` (HTTP 400).
- Requires valid non-zero layout geometry; missing geometry returns `InputError::GeometryUnavailable` (HTTP 503 `kind: "inputUnavailable"`).
- Viewport scroll offsets are metadata and are not added to coordinates; DPR rescales screencast images only and is never applied twice.

## 13. Session Registry & Idempotent Target Management (`session.rs`)

`SessionRegistry` manages target lifecycle and state transitions:
- **Idempotent Creation & Reservation:** `POST /api/browser/sessions` requires `creationKey`. Caches up to 128 idempotency records per principal for 10 minutes (`IDEMPOTENCY_TTL = 600s`). Retrying with the same key returns the existing session with HTTP 200 OK.
- **Shared Native Target Capacity:** Configured `max_targets` (default 2, 1..=16) is strictly honored across all shared native target consumers: startup pages, REST sessions (`reserve_creation`), raw CDP targets (`register_raw_target`), and admitted popups. When total occupied targets reach `max_targets`, new sessions fail with HTTP 429 `kind: "browserBusy"`, and popups are rejected with `popupBlocked: true`.
- **Session Lifecycle Status Truth:** Server session status reflects five lifecycle states: `initializing`, `running`, `closing`, `lost`, and `closed`. A session in `closing` state holds its target capacity slot until native absence is proven via `finish_close` or native destruction events (`native_destroyed`). `lost` indicates unexpected native page destruction while freeing its slot.
- **Failed Close Handling:** `DELETE /api/browser/sessions/{id}` returning an unconfirmed native close results in HTTP 502 Bad Gateway (`kind: "nativeCloseUnconfirmed"`), keeping the session in `closing` status with its target capacity held.
- **Session Listing & TTL Reaping:** `GET /api/browser/sessions` lists all non-closed sessions (including `closing` and `lost`) so operators and UI observe truth. Retired sessions and idempotency records are reaped after `IDEMPOTENCY_TTL = 600s`. Note: UI TypeScript `BrowserSessionStatus` union does NOT yet include `closing` or `lost` (Phase 02/03 owns UI contract alignment).
- **Independent Epochs:** Tracks `navigationRevision` independently of `viewportEpoch` and `profileEpoch`.

## 14. Navigation & HTTP Network Policy (`network_policy.rs`)

Navigation URLs are validated against `validate_navigation_url`:
- **Length Ceilings:** URL length $\le 4096$ bytes (`MAX_URL_BYTES`), title length $\le 512$ bytes (`MAX_TITLE_BYTES`).
- **Scheme Restrictions:** Only `http`, `https`, and `about:blank` are permitted; `file:`, `javascript:`, `chrome:`, `data:` are rejected.
- **Credentials Prohibited:** Embedded usernames/passwords in URLs fail closed.
- **Production Private & Metadata IP Blocking:** Rejects private IPv4/IPv6, link-local, loopback, and cloud metadata endpoints (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`, `metadata.google.internal`) unless matching explicit project origin exceptions.
- **Development Isolation:** Rejects general internet destinations; restricts navigation to loopback and configured `allowed_origins`.
- **Fetch Request-Policy Interception:** CDP `Fetch` interception (`Fetch.enable` for all URL patterns at `Request` stage) is installed on the Page session before any navigation is initiated. Targets are initially created at `about:blank#dh-<session_id>` before navigating; server-initiated initial navigation awaits main-frame commit before the navigation watcher begins.
- **Worker & Child Target Interception:** Flattened auto-attach pauses child targets (frames and workers) until request interception is established (`Runtime.runIfWaitingForDebugger`). Unpoliced child targets fail closed: if interception cannot be enabled, the child is contained immediately. Page-owned targets die with page close; detached service workers and shared workers are terminated explicitly via `Target.closeTarget` by native target ID, with proof of absence verified against `Target.getTargets`.
## 15. Native Screencast Producer & Bounded Ingress (`screencast.rs`)

The screencast producer (`server/src/browser_host/screencast.rs`) manages native Chromium screencast streaming with bounded memory admission and strict lifecycle control:

### Dedicated Page Session Attachment

- **Explicit Page Session:** Subscribes to target via `Target.attachToTarget(flatten: true)` before starting screencast; enables the `Page` domain on the target session.
- **Serial Lifecycle Runs:** Starts, stops, and reconfigures with a fresh `producerRun` UUID and native `sessionId` learned from the ordered run. Reconnection or run abort generates a new `producerRun`.

### Prompt Exact-Once CDP ACK

- **compositor Starvation Prevention:** Enqueues exactly one ACK (`Page.screencastFrameAck`) for each received current-run event after bounded admission or explicit drop.
- **No ACK Retries:** Ambiguously written ACKs are not replayed or retried; connection failure aborts the run cleanly to avoid over-ACKing or state desynchronization.

### Single Replaceable Encoded Candidate Mailbox

- **No Task-per-Event:** Event ingress drains into one replaceable candidate mailbox without spawning background tasks per incoming frame.
- **Base64 Bounds Enforcement:** Enforces base64 size ceiling (`MAX_BASE64_BYTES = 2_796_204`, corresponding to 2 MiB decoded payload) before admission.
- **Late Base64 Decoding:** Overwritten candidates are dropped and ACKed immediately. Base64 is decoded only once when the governor selects the latest candidate at the 10 FPS boundary.
- **SOF Dimension Validation:** Parses JPEG SOF0/SOF2 marker (`parse_jpeg_dimensions`) directly to inspect image dimensions ($\le 1920 \times 1080$, $\le 2,073,600$ pixels). Never decodes uncompressed pixels or re-encodes JPEG images.

### Viewport Epoch & Geometry Reconciliation

- **Epoch Synchronization:** Synchronizes `viewportEpoch` and layout geometry (`TargetGeometry`) before publishing.
- **Cached Frame Reuse:** On initial attachment, resize, or restart, the producer reuses the valid cached frame if dimensions match.
- **Zero Periodic Screenshots:** If 250 ms elapses without a native frame (`SCREENSHOT_FALLBACK_DELAY`), allows exactly one bracketed `Page.captureScreenshot` fallback per epoch. Periodic or post-input screenshot engines are strictly prohibited.

### Demand-Driven Lifecycle & Heartbeat Expiry

- **Viewer Demand Tracking:** Screencast runs only when active viewers register visible demand (`ViewerDemand`, `visible: true`).
- **Heartbeat Cadence:** Viewers send heartbeats every 5 seconds (`HEARTBEAT_INTERVAL`); demand expires after 15 seconds (`VISIBLE_DEMAND_EXPIRY`).
- **Zero-Demand Teardown:** When visible demand drops to zero (or all viewer heartbeats expire), screencast stops immediately (`zero_demand_stops`).
- **Final Frame Retention:** The final published frame is retained in cache without withholding ACKs from Chromium.

## 16. Binary Media Fanout & Independent Credit Governor (`media.rs`)

The media fanout layer (`server/src/browser_host/media.rs`) delivers atomic binary frames to multiple concurrent viewers with independent credit flow control:

### Atomic Binary Envelope & Publication

- **Serialize Once:** Complete immutable BHJF frame (16-byte prefix + target frame header + JPEG payload) is serialized once per publication.
- **Zero App-Level Copies:** Broadcasts identical contiguous `Bytes` clones through Axum 0.8.8 / tungstenite 0.28.0 WebSocket `AxumWsMessage::Binary(Bytes)`. Viewers share the underlying memory buffer.

### Independent Per-Viewer Credit Governor

- **Rate Ceiling:** Governed to maximum 10 deliveries per second (`MIN_DELIVERY_INTERVAL = 100ms`).
- **Credit Budget:** Maximum 2 outstanding frames (`MAX_OUTSTANDING_PER_VIEWER = 2`) + 1 latest pending frame (`MAX_PENDING_PER_VIEWER = 1`) per viewer.
- **Outstanding Key:** Each delivery is tracked by `OutstandingKey(subscriptionEpoch, producerRun, viewportEpoch, frameSeq)`.
- **Originating Socket Subscription Authority:** Incoming `frameAck` and `frameDiscarded` messages must match the connected socket's `subscriptionEpoch` (`control_sub == self.subscription_epoch`). Foreign, duplicate, future, or old-socket traffic cannot alter credit or clear replacement entries.
- **Settled-Frame Flush:** Releasing credit immediately flushes any buffered pending frame if the rate governor interval has elapsed.
- **Deadlines & Timeouts:** 30-second outstanding frame timeout (`OUTSTANDING_TIMEOUT = 30s`) and 5-second physical socket write deadline (`WRITE_DEADLINE = 5s`). Failed writes close the subscription, while buffer reservations survive until the last clone drops.

### Pause & Rebind Protocol

- **Demand Detachment:** Pausing detaches viewer demand and frees credit controller state.
- **Fresh Socket Requirement:** Resuming requires a fresh media socket + new single-use capability ticket + new `subscriptionEpoch` and paired control connection. Old sockets cannot be retagged.

### Viewer Capacity

- **Global Ceiling:** Capped at 2 concurrent active streaming viewers globally (`MAX_GLOBAL_VIEWERS = 2`), guarded by RAII `ViewerPermit`. Admissions beyond capacity return HTTP 429 Too Many Requests (`kind: "browserBusy"`).

## 17. Memory Admission Controller & Stream Diagnostics (`diagnostics.rs`)

The memory admission controller (`server/src/browser_host/diagnostics.rs`) enforces strict bounds across all browser payload buffers:

### Global Payload Memory Ceiling

- **128 MiB Hard Cap:** Hard memory ceiling of 128 MiB (`MAX_BROWSER_PAYLOAD_MEMORY_BYTES = 134,217,728` bytes) enforced across actor ingress, commands, raw gateway, and encoded/JPEG references.
- **Pre-Allocation Admission:** Memory is reserved via `try_reserve(bytes)` before base64 decoding or frame packing; exhaustion drops candidates cleanly.

### Complete BHJF Buffer Tracking (`TrackedBhjfFrame`)

- **Last-Clone RAII Release:** Wraps packed frame `Bytes` with a shared `Arc<FrameReservationOwner>` holding `MemoryReservation`.
- **Survives Subscription Teardown:** The memory reservation remains held until the LAST active-writer, cache, outstanding, or pending clone drops—including slow-writer or old-outstanding clones after subscription cleanup.

### Bounded Operational Stream Diagnostics (`StreamDiagnostics`)

- **Operational Counters:** Reports bounded-label atomic counters: `events_received`, `events_admitted`, `events_dropped`, `acks_enqueued`, `acks_failed`, `base64_decoded_bytes`, `jpeg_bytes_total`, `frames_delivered`, `acks_received`, `discards_received`, `timeouts_occurred`, `reservations_denied`.
- **Capture vs Delivery Distinction:** Distinguishes native engine capture rate from viewer delivery rate.
- **Synthetic Qualification Ring:** Bounded ring buffer for qualification event timestamps (`MAX_QUALIFICATION_EVENTS = 256`).

## 18. Streaming WebSocket Transports (`/api/browser/media` and `/api/browser/control`)

The streaming interface exposes two paired WebSocket routes:

### Dual-Transport Separation

- **Media Transport (`GET /api/browser/media`):** Dedicated binary delivery socket for BHJF v1 frames. Subprotocol: `damhopper.browser.media.v1`. Max control message/frame size: 1024 bytes (`MAX_MEDIA_CONTROL_BYTES`). Receives client `frameAck`, `frameDiscarded`, `pause`, and `heartbeat`.
- **Control Transport (`GET /api/browser/control`):** Dedicated ordered text socket for input dispatch and browser events. Subprotocol: `damhopper.browser.control.v1`. Max message/frame size: 16 KiB (`MAX_CONTROL_MESSAGE_BYTES`). Rate limited: burst 200, sustained 100/s. Transmits `InputMessage` records; receives `ServerControlEvent` notifications. Zero JPEG bytes.
- **Capability Ticket Authentication:** Both sockets require single-use capability tickets (`damhopper.ticket.<base64url>`) with respective purposes (`media`, `control`).
- **Socket Pairing:** Paired via `AttachmentManager` requiring identical `viewerId` and `subscriptionEpoch` with a 15-second wait timeout.
- **Continuous Auth Supervisor:** Active sockets share a `CancellationToken` wired to the 5s live auth check; revocation aborts both connections immediately without waiting for stalled media writes.

## 19. Viewer Client Decoder & Android-Web Input Subsystem

The frontend client modules (`packages/ui/src/browser-host/`, `packages/ui/src/api/`) implement the viewer-facing decode pipeline and user input dispatch:

### Typed Browser Client Identity & REST Transport (`browser-host-client.ts`, `browser-host-types.ts`)

- **Connection Ownership Validation:** Every asynchronous request and ticket minting operation asserts connection validity (`assertValidConnection`), verifying profile ID and generation before and after network operations.
- **Session Lifecycle & Management:** Typed REST calls manage capabilities, session creation, navigation, history, reloads, viewport adjustments, control lease acquisition/renewal/release, dialog responses, page search, selected text, and profile resets.
- **Atomic Ticket Minting (`mintViewerAttachmentTickets`):** Fetches session state, validates incarnation and profile epoch, issues matching single-use capability tickets for media and control WebSockets, and constructs WebSocket endpoints with ticket subprotocols without persisting credentials in URLs or local storage.

### Target-Scoped Binary Frame Parser (`frame-protocol.ts`)

- **Header Validation:** Binary unpacker (`unpackBhjfFrame`) validates the 16-byte `BHJF` prefix, version 1, header length ($\le 1024$ bytes), payload length ($\le 2$ MiB), and canonical lowercase UUID fields.
- **JPEG SOF0 Marker Inspection:** `parseJpegDimensions` parses image dimensions directly from JPEG Start-of-Frame markers ($\le 1920 \times 1080$, $\le 2,073,600$ pixels) without full pixel decompression or canvas allocation.
- **Strict Sequence Counters:** Canonical decimal string validation (`validateDecimalSequence`) parses positive numeric sequence IDs (`profileEpoch`, `viewportEpoch`, `frameSeq`) as `bigint`.

### Bounded Canvas Stream Controller (`stream-controller.ts`, `canvas-view.tsx`)

- **1-Active + 1-Pending Decode Governor:** Canvas controller maintains at most one in-flight `createImageBitmap` decode and one pending compressed frame. Intermediate frames arriving during an active decode replace the pending slot and emit an immediate `frameDiscarded` (reason `replaced`) for the overwritten frame.
- **Captured Originating Socket & Subscription:** ACKs and discards are transmitted strictly over the captured originating media WebSocket with the frame's admission subscription epoch. If the socket closes, no replacement traffic is sent over subsequent connections.
- **Synchronous Privacy Blackening:** Triggering privacy mode (`setPrivacyMode(true)`) synchronously clears and blacks the canvas, advances the decode epoch to invalidate in-flight decode completions, cancels queued frames, and closes active media and control WebSockets.
- **Visibility & Detachment Lifecycle:** Hiding the viewer (`setVisibility(false)`) pauses stream delivery, detaches demand, and closes both WebSockets. Resuming requires fresh capability tickets, a new subscription epoch, and paired WebSocket handshakes.
- **ImageBitmap Cleanup:** Guarantees `ImageBitmap.close()` execution across normal render, exceptional draw, and disposal paths.

### Virtual Pointer, Keyboard & IME Input Controller (`input-controller.ts`, `text-input-proxy.tsx`)

- **Aspect-Fit Coordinate Transformation:** Maps canvas client coordinates to normalized image fractions $(u, v) \in [0.0, 1.0]$ based on letterbox aspect-fit calculations; pointer events falling within letterbox margins or with untrusted geometry (`inputTrusted: false`) are rejected.
- **Lease Token Tracking & Held Input Cleanup:** Input messages carry the current 30-second control lease token and monotonic sequence counter (`inputSeq`). Loss of lease, blur, or disposal immediately sends synthetic release events (`releaseAllHeldInput`) to avoid stuck modifier keys or held mouse buttons.
- **Pointer Move Coalescing:** Consecutive pointer move events within the same microtask coalesce into the latest coordinate, while discrete barriers (pointerDown, pointerUp, wheel) flush pending moves beforehand.
- **Soft-Keyboard & IME Composition Proxy:** Focusable `TextInputProxy` manages virtual keyboard visibility on mobile and Android web, deduplicating Vietnamese and Japanese multi-stage IME compositions (`compositionstart`, `compositionend`, `beforeinput`) to prevent duplicate character insertions.

## 20. Selection Artifacts, Actor Binding & Revoke-First Logout Reset (Phase 08)

Phase 08 integrates secure CDP DOM selection, actor-bound artifact authorization, revoke-first logout ordering, and confirmed profile reset UX:

- **Actor-Bound Debug Artifacts & Handoff Authority Fences (`browser_debug/`, `state.rs`):** Every artifact carries an immutable `owner` (`AuthenticatedActor.subject`) and internal `ArtifactSource` (`Cooperative` vs `ManagedBrowser { principal, profile_epoch, browser_incarnation }`). Public `POST /api/browser-debug/artifacts` (`deny_unknown_fields`) always assigns `Cooperative`; managed selection artifacts require live `AppStateBrowserAdmissionAuthority` checks (enabled Admin or `--no-auth` dev, matching `profileEpoch`, and zero active reset tombstones) across create, PNG upload, delete, and handoff—denying demoted Admins and foreign owners with indistinguishable `404`. Global quota enforces 64 records / 64 MiB via cancellation-safe `QuotaReservationGuard`, `UploadReservationGuard`, and `PublishedPathCleanupGuard`. During PTY handoff writes, `HandoffAuthority::is_current` revalidates revocation epoch (`publish_revocation`), live browser incarnation, navigation revision, and actor deadline synchronously inside the PTY mutation lock without awaiting, denying stale writes. Unlink failures retain charged storage in the `pending_cleanups` set.
- **CDP Selection Preview & Atomic Terminal Delivery (`selection.rs`, `cdp.rs`, `selection-controller.ts`, `BrowserApp.tsx`):** `Overlay` inspect mode (`Overlay.setInspectMode`) and one-shot `inspectPoint` (`DOM.getNodeForLocation` + allowlisted `Runtime.callFunctionOn`) sanitize DOM metadata into `BrowserSelectionV1` (omitting form values, passwords, raw HTML, and control bytes) with optional cropped CDP PNG capture (`<= 4 MiB` at `1.0x`/`0.5x` scale). A session-lifetime background navigation watcher subscribes to projected `CdpLifecycleEvent` records (`MAX_LIFECYCLE_EVENT_SLOTS = 8`, bounded via `MemoryAdmissionController`) to invalidate selections/pending artifacts on main-frame or same-document navigation. Atomic handoff holds `acquire_managed_selection_fence` and executes `pty_manager.write_if_incarnation` with server-generated reference paths only (`[DamHopper browser-debug artifact ...]`); UI `useHostBrowserSelection` enforces 409 `navigationRevision` sync recovery and preserves Cooperative extension/bridge flows (`use-browser-debug.ts`, `browser-bridge`).
- **Revoke-First Logout & Truthful Outcome UX (`api/auth.rs`, `AccountLogoutDialog.tsx`, `ServerProfilesDialog.tsx`, `ServerSettingsDialog.tsx`, `BrowserStreamKeepAliveHost.tsx`):** `POST /api/auth/logout` captures pre-revocation live Admin admission, then **always executes session revocation, media-ticket revocation, Browser attachment/lease teardown (`revoke_auth_session_browser_resources`), and cookie clearing FIRST**, returning HTTP 200 `{ browserResetState: "retained", resetRequired: true }` for legacy/missing/stale-confirmation callers. The response sets `sessionRevoked: true` only when the request's own credential was identified and revoked (accompanied by explicit `sessionIdentified: bool`); client-side auth clients never treat `sessionRevoked: true` as confirmation for an unsent Bearer token. Destructive reset additionally requires CSRF/Origin (`validate_destructive_browser_csrf`), `confirmed: true`, `expectedProfileEpoch`, `operationId`, and lock-guarded Admin recheck; if private artifact file purge remains incomplete, the outcome reports `browserResetState: "cleanupPending"`.

## 21. Qualification Status & Open Proof Obligations

Qualification was executed on Linux x86_64 (`Linux 7.2.15-200.fc44.x86_64`) against real Google Chrome 157.0.8103.38:

| Gate | Status | Evidence / Invariant |
| --- | --- | --- |
| Linux Process Containment | **PASS** | Process group pidfd signalling (`PIDFD_SIGNAL_PROCESS_GROUP`) and `close_range` verified on Linux 6.9+; older kernels fail closed |
| Adapter Bounds & Budget | **PASS** | 64-command cap, 2 MiB RAII byte budget, 32-msg writer queue, 5s write deadline |
| Coordinate Mapping | **PASS** | Authoritative marker centroids verified for DPR 1/2, scroll, pageScale, visual offsets |
| Wire Codec (BHJF) | **PASS** | Roundtrip encode/decode, SOF dimension verification, decimal sequence validation |
| Dual Bearer Relay | **PASS** | Exact Origin policy, bearer authentication, 2-connection concurrency, 4 MiB frame limit |
| Configuration & Capabilities | **PASS** | Bounded budgets, origin/destination validation, executable/root permissions, domain DTO |
| Principal Profile Isolation | **PASS** | Dev/prod separation, 64-hex hashed root, 0700/0600 permissions, advisory flock exclusivity |
| Reset Reconciliation & Tombstones | **PASS** | Epoch advance, atomic reset.json, 2s wait + async worker, 10s terminate/delete timeouts, CleanupPending fencing |
| Lazy Manager & Graceful Shutdown | **PASS** | Zero startup spawn, reconnect reuse, 10s shutdown reap preserving credentials |
| Admission & Network Policy | **PASS** | Admin live role checks, dev loopback/Origin bypass, scheme/metadata filtering |
| Single-Use Capability Tickets | **PASS** | 256-bit OsRng, SHA-256 memory store, 30s TTL, single-use atomic consume, pair matching |
| Leased Input Queue & Releases | **PASS** | 30s lease, 128-record queue, contiguous inputSeq, stuck key auto-release, aspect-fit mapping |
| Agent CDP Gateway & Relay | **PASS** | Authenticated discovery URL rewriting, dedicated upstream relay, 4 MiB frame/message cap, 5s write timeout, exact Origin policy, dynamic connection budget (`budgets.max_raw_cdp_connections`, cap 8), manager target tracking (64 targets), viewport epoch fencing with stale input Conflict (409), live auth cancellation racing with socket writes and absolute deadline, and fast socket drop on revocation. Verified by 14 Rust gateway tests and 8 Playwright E2E tests in `agent.spec.ts` against production gateway mode. User approved after Cycle 3 (score 7/10; 57/57 tests passing). |
| Screencast Producer & Ingress | **PASS** | Dedicated Page session, serial `producerRun`, prompt exact-once CDP ACK, single replaceable candidate, JPEG SOF dimension validation, zero periodic screenshots, and 15s visible demand stop |
| Binary Media Fanout & Credits | **PASS** | Immutable BHJF v1 fanout via Axum `Binary(Bytes)` with zero per-viewer JPEG copies, independent credit governor (max 10 FPS, 2 outstanding + 1 pending), originating socket subscription authority, 30s outstanding timeout, 5s write deadline, pause detaching demand, and max 2 global viewers |
| Stream Memory Admission | **PASS** | Hard 128 MiB global memory reservation ceiling across ingress, commands, raw gateway, and frames; `TrackedBhjfFrame` shared RAII reservation held until last clone drops; bounded stream diagnostics counters and ring buffer |
| Viewer Client Decoder & Input | **PASS** | 1-active + 1-pending frame decode governor, captured subscription credit ACKs, synchronous privacy blackening, letterbox coordinate mapping, and IME deduplication. Verified by 60 unit tests, 8 Chromium browser tests, clean UI build, and clean E2E typecheck. User approved after Cycle 3 (score 4/10; technical carryovers C1, C3, W1–W8). |
| Root Browser Keep-Alive & OS Cutover | **PASS** | Root keepalive host, canvas slot reparenting, viewer-local claims, explicit target close, recipe sanitization, and retired iframe path. Verified by 206 test cases + 2 typecheck suites. User approved after Cycle 2 (score 4/10; technical carryovers W1–W10; unblocks Phase 08). |
| Actor-Bound Artifacts, Selection & Logout Reset | **PASS** | Immutable owner/source class, live Admin demotion checks, bounded CDP selection + PNG + atomic terminal handoff, revoke-first logout, 2s bounded async reset worker, and Cancel-first UI (V1). Verified by 237/237 scoped Phase 08 checks + 3,718/3,718 full UI unit run; Cycle 3 approved (`7/10`, 0 critical issues; carryovers W1–W9). |
| Live-Server Selection E2E (`selection.spec.ts`) | **DEFERRED (PHASE 09)** | `packages/ui/e2e/os-host-browser/selection.spec.ts` authored and E2E typechecked; live-server Playwright execution deferred to Phase 09 integrated qualification. |
| Native Browser Zoom | **UNVERIFIED** | Unreachable via standard CDP in headless Chromium 157; `inputTrusted: false` enforced |
| Windows Containment | **FAIL-CLOSED** | Windows Job Object containment unimplemented; non-Unix launch returns `ContainmentUnavailable`. Retained fail-closed; no qualification claimed |
### Phase 05 Verification Summary

- **Phase 05 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 3 (70/70 checks passing across screencast, fanout, bounds, regressions, build, and TypeScript compile suites). Phase 06 (Frame Assembly & Decoder Pipeline) is unblocked.
- **Test Evidence:** Verified by real Google Chrome screencast tests (`server/tests/browser_host_screencast.rs` [3/3]), media fanout and credit governor tests (`server/tests/browser_host_media.rs` [7/7]), and memory admission bounds tests (`server/tests/browser_host_bounds.rs` [3/3]), alongside 57 regression tests.

### Phase 06 Verification Summary

- **Phase 06 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 3 (70/70 validation checks passing across unit, Chromium browser component, package build, and E2E typecheck suites). Phase 07 (OS Shell Cutover & Legacy Frame Deletion) is unblocked.
- **Test Evidence:**
  - Unit tests (60 passed, 0 failed, 0 skipped): `src/api/browser-host-client.test.ts` (8), `src/browser-host/frame-protocol.test.ts` (16), `src/browser-host/stream-controller.test.ts` (21), `src/browser-host/input-controller.test.ts` (15).
  - Chromium browser tests (8 passed, 0 failed, 0 skipped): `browser-tests/host-browser-decoder.browser.tsx` (2), `browser-tests/host-browser-input.browser.tsx` (6).
  - TypeScript build & typechecks (2 passed): `pnpm --filter @dam-hopper/ui build` (clean, 0 errors), `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (clean, 0 errors).
- **Noted Technical Carryovers:** Cycle 3 code review scored 4/10; unresolved carryovers tracked for subsequent phases include:
  - C1: Live owner and cache boundary fences to eliminate potential stale private pixel redrawing on attachment changes.
  - C3: Release ordering and ambient identity on the leased input stream to prevent command sequence corruption and dropped releases under queue saturation.
  - W1–W8: Input trust fencing against stale geometry, canonical numeric counter precision, exactly-once IME text commit state machine, draw/decode exceptional bitmap cleanup, REST DTO schema alignment, explicit copy/find/touch controls, and half-pair transport teardown bounds.

### Phase 07 Verification Summary

- **Phase 07 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 2 (208/208 validation checks passing across unit, Chromium browser component, package build, and E2E typecheck suites). Phase 08 (Authentication, Client Integration & Artifacts) is unblocked.
- **Architectural Deliverables:**
  - **Root Keep-Alive Host (`BrowserStreamKeepAliveHost.tsx`):** Mounted at the top level within `OsResourceHost`. Manages persistent off-screen parked containers (`data-os-browser-parking-host="true"`), transferring container DOM elements between visible window frames and parking slots via `registerBrowserStreamSlot` and `updateBrowserStreamSlot`.
  - **Viewer-Local Presentation Claims:** Claim key derives from `resourceId: window.id` instead of URL, allowing multiple OS windows to view the same target session simultaneously without collision or claim denial.
  - **Interactive Controls & Dialog Overlay:** Top toolbar providing Back, Forward, Reload, URL address bar with Enter navigation, Controllable vs View-only indicators with interactive lease acquisition button, short session ID display, and active CDP dialog modals (`BrowserDialogModal`).
  - **Window Lifecycle Binding:** Explicit window close (`closeWindow(windowId)`) resolves owner connection and dispatches backend target deletion (`closeBrowserSession`) once, preserving sibling and shared target sessions. Placement changes (tile, float, max, min, restore, desktop switch) and component unmount retain canvas DOM continuity without destruction.
  - **Persistence & Recipe Sanitization:** Persisted session state allows non-secret references (`url`, `sessionId`, `logicalSessionId`) while stripping capability tickets, tokens, and credentials. Recipe schema and engine sanitize browser steps strictly to `{ url }`, guaranteeing that recipe launches spawn independent targets.
  - **Obsolete Iframe Path Retirement:** Complete removal of `OsBrowserIframe`, `OsBrowserKeepAliveHost`, `browserSlots`, `registerBrowserSlot`, and `updateBrowserSlot` symbols across production and browser test suites.
- **Test Evidence:**
  - OS unit & regression tests (124 passed, 0 failed): `src/os/resource-registry.test.ts`, `src/os/deep-links.test.ts`, `src/os/persistence.test.ts`, `src/os/recipes/recipe-source-context.test.ts`, `src/os/recipes/recipe-engine.test.ts`, `src/os/recipes/schema.test.ts`, `src/os/window-ops.test.ts`.
  - Chromium browser tests (22 passed, 0 failed): `browser-tests/os-lifecycle.browser.tsx`, `browser-tests/os-input-isolation.browser.tsx`, `browser-tests/host-browser-lifecycle.browser.tsx`.
  - Decoder & client unit tests (60 passed, 0 failed): `src/api/browser-host-client.test.ts`, `src/browser-host/frame-protocol.test.ts`, `src/browser-host/stream-controller.test.ts`, `src/browser-host/input-controller.test.ts`.
  - TypeScript build & typechecks (2 passed): `pnpm --filter @dam-hopper/ui build` (clean, 0 errors), `pnpm --filter @dam-hopper/ui test:e2e:typecheck` (clean, 0 errors).
- **Noted Technical Carryovers:** Cycle 2 code review scored 4/10; unresolved carryovers tracked for subsequent phases include:
  - W1: Authoritative navigation revision wire format (JSON u64 number vs decimal string).
  - W2: Persisted live target adoption on SPA reload (`listBrowserSessions`/`getBrowserSession` consumption).
  - W3: Restore ticket demand-fencing and generation-reactivity.
  - W4: Control lease renewal and deadline tracking across pause/restore.
  - W5: Shell-modal/document visibility aggregation and deliberate text focus.
  - W6: Explicit close pending-create and failed-delete ownership finalization.
  - W7: Popup projection/overflow notification and Radix modal migration.
  - W8: Connected-boundary behavioral integration test requirements.
  - W9: React-owned DOM movement vs imperative host portal convention.
  - W10: Capability and transport error handling in UI.

### Phase 08 Verification Summary

- **Phase 08 Finalized (2026-11-09):** User approved Cycle 3 code review (`7/10`, 0 critical issues). Unblocks Phase 09 integrated qualification.
- **Test Evidence:** `237/237` scoped Phase 08 checks passing: `78/78` Rust across 7 targets (`browser_debug` [13], `browser_host` [27], `browser_debug_artifacts` [7], `browser_host_selection` [7], `browser_host_logout` [8], `browser_host_lifecycle` [10], `auth_device_sessions` [6]); `121/121` scoped UI Vitest across 9 files (plus `3,718/3,718` full UI unit run); `19/19` scoped Chromium browser tests across 5 files (`host-browser-selection.browser.tsx`, `host-browser-logout.browser.tsx`, `browser-debug-panel.browser.tsx`, `browser-debug-keep-alive.browser.tsx`, `host-browser-lifecycle.browser.tsx`); `19/19` `browser-bridge`; clean UI/extension/E2E typechecks, UI/web builds, and 15-file ESLint. (Accidental `--` full-browser expansion showed 3 pre-existing failures in 2 untouched files; live-server `selection.spec.ts` execution deferred to Phase 09.)
- **Noted Technical Carryovers (Cycle 3 W1–W9 tracked into Phase 09):**
  - **W1 (High):** Serialize handoff final validation/write and authoritative navigation/reset epoch updates through one ordered fence (`state.rs`, `selection.rs`, `browser_debug/store.rs`).
  - **W2 (High):** Check complete captured owner/generation/token/operation across every standalone reset/status mutation (`ServerSettingsDialog.tsx`).
  - **W3 (High):** Clear/replace `GLOBAL_NAV_WATCHERS` entry or retire target authority on lifecycle overflow/lag (`selection.rs`).
  - **W4 (High):** Return `sessionRevoked: false` / uncertain when public logout receives no usable credential so cleartext non-loopback HTTP without cookie cannot misreport revocation (`auth.rs`, `auth-client.ts`).
  - **W5 (High):** Preserve pending reset operation identity on post-commit `409 resetFailed` and reconcile surviving `reset.json` before completion replay (`manager.rs`, `browser_host.rs`, `ServerSettingsDialog.tsx`).
  - **W6 (Medium):** Correlate `pending_api_navigation_at` suppression with dispatched navigation rather than a 5s timer (`session.rs`, `api/browser_host.rs`).
  - **W7 (Medium):** Hold quota charges until artifact deletion/expiry file removal succeeds (`browser_debug/store.rs`).
  - **W8 (Medium):** Make selection status polling single-flight with abort/deadline and revision ordering checks (`selection-controller.ts`).
  - **W9 (Medium):** Restore `setIsDeleting(true)` busy-state guard in `handleConfirmDelete` (`ServerProfilesDialog.tsx`).
### Finalization & Roadmap Status

- **Phase 04 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 3 (score 7/10; 57/57 tests passing across Rust gateway, regressions, example build, TypeScript compile, and Playwright E2E suites). Phase 05 (Screencast Producer Actor & JPEG Fragmentation) is unblocked.
- **Noted Issues Carried Forward:** Architectural review noted follow-up areas for subsequent phases: correlating wire session IDs to native target IDs across flattened Playwright sessions (C2), wiring authoritative input manager epoch synchronization directly into production layout reconciliation (C2), and strictly deriving public server WS URLs exclusively from configured origins without request-Host fallback under complex TLS topologies (W4).
- **Observed Implementation vs Full System Qualification:** Component, gateway, and Playwright qualification pass against the production gateway mode (`browser_host_qualification.rs`), but end-to-end multi-client system qualification across concurrent human viewers, screencast streaming producers (Phase 05), decoder UI (Phase 06), and production container load (Phase 09) remains scheduled for later phases.
- **Teardown Timing Under Congestion:** While `write_with_cancel` races auth cancellation and absolute deadline against in-flight writes, actual kernel socket buffer draining and upstream termination remain subject to OS scheduler scheduling and network latency; immediate teardown is bounded by local runtime aborts, not an absolute wall-clock guarantee.
- **Windows Platform Boundary:** Windows process containment remains unimplemented and fails closed with `ContainmentUnavailable`.
### Phase 09 Integrated Qualification Summary

- **Phase 09 Finalized (2026-11-09):** User approved with noted issues after Cycle 3 code review (score 4/10; 54/54 automated checks passing across 5 validation gates). Phase 10 (Documentation & Controlled Rollout Reconciliation) is unblocked.
- **Test Evidence & Validation Gates:**
  - `server/tests/browser_host_security.rs` (7/7 passed): Proves role denial matrix across Unauthenticated, Ordinary Member (`UserRole::User`), and Admin (`UserRole::Admin`) principals (A16); capability ticket replay, purpose (`Media` vs `Control`), and exact-Origin fencing (A18); `--no-auth` loopback socket enforcement (`127.0.0.1` or `::1`) with forwarded header rejection (A17); URL safety, forbidden schemes (`javascript:`, `data:`, `file:`, `view-source:`, `chrome:`), and metadata protection (A04); multi-target (max 2) and multi-viewer (max 2) concurrency with zero-copy shared BHJF Bytes fanout, credit isolation, and PTY event decoupling (A26); viewport epoch input fencing with `StaleViewportEpoch` rejection and input lease conflict handling (A08); and live Admin role demotion termination (A19).
  - `server/tests/browser_host_platform.rs` (5/5 passed): Chromium launch flag security allowlist rejecting dangerous overrides (`--no-sandbox`, `--disable-web-security`, `--remote-debugging-address=0.0.0.0`, etc.) (A29); loopback endpoint canonical UUID validation; advisory OS locking (`flock` on `manager.lock`) and Chromium `SingletonLock` cleanup (A28, A30); durable `reset.json` tombstones preventing dirty-profile relaunch (`CleanupPending`, A34); dev/prod directory isolation; and crash recovery with PTY isolation.
  - `packages/ui/browser-tests/host-browser-android.browser.tsx` (6/6 passed): Vitest browser mode testing virtual touch tap and soft-keyboard proxy focus, touch drag/pan gesture handling, touch cancel cleanup, Vietnamese Telex and Japanese Kana IME composition deduplication with exactly-once commit, and clipboard plain-text paste (A09).
  - `packages/ui/e2e/fixtures/host-browser-app.ts`: Authenticated multi-principal test fixture (`admin`, `ordinary`, `foreign`) with isolated port allocation and process supervision.
  - `packages/ui/e2e/os-lifecycle/host-browser.spec.ts`: OS window placement continuity across Float, Tile, Maximize, and Minimize preserving canvas DOM elements and presentation state without fiber crashes (A11); target capacity ceiling (max 2 targets, 429 `browserBusy` A05); target close isolation (A14); session reconnect idempotency (A12); and Cognito privacy mode canvas blanking (A15).
  - `packages/ui/e2e/os-host-browser/same-target.spec.ts`: CDP agent same-target interference coexistence contract (A02). Proves that external agent `Page.disable` and `Page.stopScreencast` commands do not disrupt the production screencast stream.
  - `packages/ui/e2e/os-host-browser/performance.spec.ts`: Performance benchmarks and bounded tuning grid evaluation (A37, A38). Evaluates 12 configurations; exactly 6 eligible with `everyNthFrame = 1`; setting #7 (`q65`, `1280x900`, `everyNthFrame = 1`) proposed default; `everyNthFrame = 2` disqualified to avoid stranded final frames; proves static page emits zero periodic `Page.captureScreenshot` calls.
  - `packages/ui/e2e/os-host-browser/android.spec.ts`: Full-SPA Android touch/IME journey sequence (A09).
- **Open Release Gates & Truth Governance:**
  - Physical Android device receipts with Gboard Vietnamese Telex and Japanese Kana IME (A09, `reports/human-acceptance.md`).
  - Desktop Chrome/Firefox human visual and agent interference ledger (A40, `reports/human-acceptance.md`).
  - Continuous 60s soak workloads, physical scanout latency, and production capture benchmarks (A37, `reports/performance-qualification.md`).
  - Dedicated native Windows release host runner for Job Object containment (A29, `reports/platform-qualification.md`).

### Phase 01 Authority & Lifecycle Remediation (2026-11-10)

Phase 01 remediates backend authority, lifecycle truth, durable reset recovery, and request-policy interception:
- **Implemented Remediation Tasks:** Delivered `secure-browser-admission` (loopback listener + peer socket enforcement, exact Origin allowlist matching, trusted public origin resolution for raw CDP), `reconcile-native-targets` (shared `max_targets` capacity across startup/REST/raw/popups, `closing`/`lost` lifecycle statuses, 502 `nativeCloseUnconfirmed`, Fetch request-policy interception on pages/workers), `persist-reset-recovery` (0600 temp + fsync + rename + dir fsync, launch token reconciliation under flock, `ProfileFaults`), and `secure-artifact-logout` (in-lock PTY handoff authority revalidation, `sessionIdentified` logout truth, pending cleanup retention).
- **Windows Platform Boundary:** Task `implement-windows-containment` remains blocked due to absence of a native Windows runner. Windows stays fail-closed (`ContainmentUnavailable`); no qualification is claimed.
- **Tracked Known Limitations (Open Review Follow-ups):**
  - **C1 (Recycled-Group Race):** Supervisor and recovery scanner (`process.rs:1233-1346`) uses lazy `/proc` traversal, introducing a potential race with recycled process group numbers during prior-tree termination after the original leader was reaped.
  - **C2 (MFA StepUp Epoch Race):** Database credential commit precedes epoch publication (`auth_mfa.rs:939-969`), leaving an interval where cancellation or failure can lose publication.
  - **C3 (Live Containment Capacity):** Failed live containment (`manager.rs:1947-1999`) invokes dead-browser retirement, potentially releasing target capacity before native child process teardown is confirmed.
  - **Cleanup & Drain Bounds:** Queued artifact cleanup vector retains historical IDs without a hard bound; shutdown does not join every detached cleanup/escalation task; observer overlay mutations bypass the generation gate.
  - **Accepted Design Limits:** Direct database demotion relies on 5s supervisor poll latency rather than synchronous push; cancelled handoff workers blocked on std Mutex release without writing; page-session overflow drops worker identity.

## 22. Source Map

| Responsibility | Path |
| --- | --- |
| Bounded CDP Actor | `server/src/browser_host/cdp.rs` |
| Atomic Command Budget | `server/src/browser_host/command_budget.rs` |
| Process Supervisor & Containment | `server/src/browser_host/process.rs` |
| Binary BHJF Protocol | `server/src/browser_host/protocol.rs` |
| Configuration & Capability DTO | `server/src/browser_host/config.rs` |
| Principal Profile & Lock Management | `server/src/browser_host/profile.rs` |
| Lifecycle Manager & Reset Supervisor | `server/src/browser_host/manager.rs` |
| Admission Security & Live Verifier | `server/src/browser_host/auth.rs` |
| Single-Use Tickets & Attachments | `server/src/browser_host/attachments.rs` |
| Leased Input Queue & Coordinates | `server/src/browser_host/input.rs` |
| Session Registry & Target Epochs | `server/src/browser_host/session.rs` |
| Navigation & HTTP Network Policy | `server/src/browser_host/network_policy.rs` |
| Browser Host REST API Handlers | `server/src/api/browser_host.rs` |
| Agent CDP Gateway & Upstream Relay | `server/src/browser_host/cdp_gateway.rs` |
| Module Exports | `server/src/browser_host/mod.rs` |
| Screencast Producer Actor | `server/src/browser_host/screencast.rs` |
| Binary Media Fanout & Transports | `server/src/browser_host/media.rs` |
| Stream Diagnostics & Memory Admission | `server/src/browser_host/diagnostics.rs` |
| Managed Selection & Nav Watcher | `server/src/browser_host/selection.rs` |
| Actor-Bound Debug Artifact Store | `server/src/browser_debug/{mod,store,error}.rs`, `server/src/api/browser_debug.rs` |
| Revoke-First Logout & Cleanup Wiring | `server/src/api/auth.rs`, `server/src/api/router.rs`, `server/src/state.rs` |
| Qualification Example Harness | `server/examples/browser_host_qualification.rs` |
| Adapter & Protocol Test Suite | `server/tests/browser_host_adapter.rs` |
| Process Containment Test Suite | `server/tests/browser_host_process.rs` |
| Real-Engine Compatibility Test Suite | `server/tests/browser_host_compatibility.rs` |
| Profile Lifecycle & Reset Test Suite | `server/tests/browser_host_lifecycle.rs` |
| Graceful Shutdown Test Suite | `server/tests/browser_host_shutdown.rs` |
| Admission & REST Test Suite | `server/tests/browser_host_admission.rs` |
| Capability Ticket & Live Auth Test Suite | `server/tests/browser_host_auth.rs` |
| Leased Input Queue Test Suite | `server/tests/browser_host_input.rs` |
| Agent CDP Gateway Test Suite | `server/tests/browser_host_gateway.rs` |
| Native Screencast Test Suite | `server/tests/browser_host_screencast.rs` |
| Media Fanout & Credit Test Suite | `server/tests/browser_host_media.rs` |
| Bounds Admission Test Suite | `server/tests/browser_host_bounds.rs` |
| Actor-Bound Artifacts Test Suite | `server/tests/browser_debug_artifacts.rs` |
| Managed Selection Test Suite | `server/tests/browser_host_selection.rs` |
| Revoke-First Logout & Reset Suite | `server/tests/browser_host_logout.rs` |
| Device Session & Cleanup Suite | `server/tests/auth_device_sessions.rs` |
| E2E Qualification Harness Fixture | `packages/ui/e2e/fixtures/browser-host-qualification.ts` |
| Playwright Compatibility Spec | `packages/ui/e2e/os-host-browser/compatibility.spec.ts` |
| Agent CDP Qualification Spec | `packages/ui/e2e/os-host-browser/agent.spec.ts` |
| Browser Host REST & Ticket Client | `packages/ui/src/api/browser-host-client.ts` |
| Browser Host Client & Wire Types | `packages/ui/src/api/browser-host-types.ts` |
| Binary BHJF Frame Codec & Parser | `packages/ui/src/browser-host/frame-protocol.ts` |
| Bounded Canvas Stream Controller | `packages/ui/src/browser-host/stream-controller.ts` |
| Bounded Canvas View Component | `packages/ui/src/browser-host/canvas-view.tsx` |
| Virtual Input Controller | `packages/ui/src/browser-host/input-controller.ts` |
| Soft-Keyboard & IME Text Proxy | `packages/ui/src/browser-host/text-input-proxy.tsx` |
| Browser Host Client Test Suite | `packages/ui/src/api/browser-host-client.test.ts` |
| BHJF Frame Protocol Test Suite | `packages/ui/src/browser-host/frame-protocol.test.ts` |
| Stream Controller Test Suite | `packages/ui/src/browser-host/stream-controller.test.ts` |
| Input Controller Test Suite | `packages/ui/src/browser-host/input-controller.test.ts` |
| Chromium Decoder Browser Test | `packages/ui/browser-tests/host-browser-decoder.browser.tsx` |
| Chromium Input Browser Test | `packages/ui/browser-tests/host-browser-input.browser.tsx` |
| Root Browser Keep-Alive Host | `packages/ui/src/os/BrowserStreamKeepAliveHost.tsx` |
| Host Browser Lifecycle Browser Test | `packages/ui/browser-tests/host-browser-lifecycle.browser.tsx` |
| Playwright Selection E2E Spec | `packages/ui/e2e/os-host-browser/selection.spec.ts` |
| Selection Preview & Handoff Controller | `packages/ui/src/browser-host/selection-controller.ts` |
| Unified Cancel-First Logout Dialog | `packages/ui/src/components/organisms/AccountLogoutDialog.tsx` |
| Profile Management & Settings Reset UI | `packages/ui/src/components/organisms/{ServerProfilesDialog,ServerSettingsDialog}.tsx` |
| Chromium Selection & Logout Tests | `packages/ui/browser-tests/host-browser-{selection,logout}.browser.tsx` |
| Security Matrix Integration Suite | `server/tests/browser_host_security.rs` |
| Platform Containment & Reset Suite | `server/tests/browser_host_platform.rs` |
| Android Web Interaction Browser Suite | `packages/ui/browser-tests/host-browser-android.browser.tsx` |
| Real Host Browser E2E App Fixture | `packages/ui/e2e/fixtures/host-browser-app.ts` |
| OS Lifecycle & Target Cap E2E Spec | `packages/ui/e2e/os-lifecycle/host-browser.spec.ts` |
| Agent Same-Target Interference Spec | `packages/ui/e2e/os-host-browser/same-target.spec.ts` |
| Tuning Grid & Zero-Polling E2E Spec | `packages/ui/e2e/os-host-browser/performance.spec.ts` |
| Full-SPA Android Web E2E Spec | `packages/ui/e2e/os-host-browser/android.spec.ts` |
| Integrated Qualification Report | `plans/261108-0237-host-browser-cdp-streaming/reports/integrated-qualification.md` |
| Platform Qualification Report | `plans/261108-0237-host-browser-cdp-streaming/reports/platform-qualification.md` |
| Performance & Tuning Qualification Report | `plans/261108-0237-host-browser-cdp-streaming/reports/performance-qualification.md` |
| Human & Physical Acceptance Ledger | `plans/261108-0237-host-browser-cdp-streaming/reports/human-acceptance.md` |

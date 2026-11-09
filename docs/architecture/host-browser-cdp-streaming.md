# Host Browser CDP Streaming Architecture

**Authority:** Backend Subsystem (`server/src/browser_host/`, `server/examples/browser_host_qualification.rs`)  
**Status:** Supervised Principal Profiles, Admission Control, Leased Input, Raw CDP Gateway, Screencast Producer & Bounded Media Fanout (Phases 01–05 Finalized & Verified; Phase 06 Unblocked)

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

- **Process Group Isolation:** Spawns Chromium in a dedicated process group (`process_group(0)`).
- **Bidirectional Death-Pipe Watcher:** Uses an anonymous POSIX pipe between supervisor and child watcher. Supervisor process termination automatically drops the write-end of the pipe; the watcher receives `EOF` on `death_r` and executes `killpg` against the process group, terminating all orphaned renderer, GPU, and utility processes immediately.
- **Dual-Stage Liveness Verification:** `live_members(pgid)` verifies termination via both `killpg(pgid, 0)` kernel probe and `/proc` process-tree scanning.
- **Graceful Shutdown Protocol:** Sends `SIGTERM` with a 3-second grace period (`SHUTDOWN_GRACE_PERIOD_SECS`), followed by `SIGKILL` if processes survive.
- **Non-Positive PGID Rejection:** During unmanaged prior process group cleanup (e.g. after daemon restart or crash recovery), any stored `process_pgid <= 1` (where `0` represents the current process group, `-1` all processes, and `1` init/systemd) is rejected fail-closed. Tombstone stage transitions to `ResetStage::Failed`, error records `invalid non-positive PGID {pgid}`, and the instance transitions to `InstanceLifecycleState::CleanupPending`, refusing to signal host or init processes.
- **Durable Containment Fencing:** Process group containment is proven before completing process launch or profile wipe. If `live_members(pgid) > 0` survives the 3-second `SIGTERM` grace period and 2-second `SIGKILL` proof deadline, the process error is recorded in an atomic `reset.json` tombstone and the profile enters `CleanupPending`. On server restart, `load_tombstone` recovers this state and fences subsequent launch attempts until resolved.

### Endpoint Discovery and Loopback Validation

- **Bounded Stream Reading:** Stderr is consumed in 1024-byte chunks up to a hard ceiling of 64 KiB (`MAX_STDERR_CAPTURE_BYTES = 65_536`). Oversized stderr streams without an endpoint token fail closed with `ProcessError::StderrOverflow`.
- **DevToolsActivePort Corroboration:** When present, `DevToolsActivePort` (read up to 512 bytes) is corroborated against the stderr endpoint; mismatch between port file and stderr fails closed with `ProcessError::EndpointMismatch`.
- **Loopback Enforcement (`validate_loopback_endpoint`):** Endpoints must parse as `ws://`, bind strictly to `127.0.0.1`, `[::1]`, or `localhost`, specify an explicit non-zero port, and match `/devtools/browser/<canonical-uuid>` where the UUID is a 36-character lowercase RFC 4122/9562 UUID.
- **Non-Unix Platform Containment:** On non-Unix platforms (such as Windows), `BrowserProcess::launch` fails closed immediately with `ProcessError::ContainmentUnavailable`.

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
- **Gateway WS Base Resolution:** Rewrites internal `webSocketDebuggerUrl` and `devtoolsFrontendUrl` to public gateway WebSocket endpoints (`/api/browser/cdp/ws` or `/api/browser/cdp/ws/{target_id}`). The public URL is derived strictly from `DAM_HOPPER_PUBLIC_SERVER_ORIGIN` or the direct `Host` header. Forwarded headers (`X-Forwarded-Host`, `X-Forwarded-For`) are ignored to prevent URL poisoning.
- **Endpoint Sanitization:** Internal loopback DevTools ports (e.g. `127.0.0.1:xxxxx`) are stripped from frontend URLs before returning to callers.
- **Payload Bounds:** Discovery target list payloads from Chromium are strictly bounded to 256 KiB; oversized responses fail closed with HTTP 502 Bad Gateway.

### Exact Single Origin Policy

Origin validation enforces strict single-origin invariants (`validate_cdp_origin`):
1. **Single Header Enforcement:** Multiple `Origin` headers (`headers.get_all(header::ORIGIN).iter().count() > 1`) fail closed with HTTP 403 Forbidden (`kind: "forbiddenOrigin"`).
2. **Format Sanitation:** Origins equal to `"null"`, ending in a trailing slash (`/`), or containing commas (`,`) fail closed with HTTP 403 Forbidden.
3. **Allowlist Matching:** Evaluates byte-for-byte exact equality against `server.cors_origins` and `browser.allowed_dev_origins`.
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

### Metadata Schema (`manager.json`)

Atomic writes via temporary file (`manager.json.tmp.<pid>.<uuid>`) and rename:
- `subject`: Principal identifier string.
- `isDev`: Boolean distinguishing `--no-auth` dev mode from authenticated production profiles.
- `profileEpoch`: Monotonic `u64` counter matching `[1-9][0-9]{0,19}`.
- `browserIncarnation`: Fresh UUID minted on each process launch; `null` when dormant.
- `updatedAtUnixMs`: Millisecond Unix timestamp of last update.
- `lastResetOperationId`: Optional UUID of last successfully completed reset operation (for idempotence).

## 8. Reset Reconciliation & Durable Tombstone Lifecycle (`manager.rs`)

The reset state machine purges user credentials (`user-data/`) and recreates a fresh profile while maintaining process exclusivity and preventing concurrent operations.

### Reset Sequence (`reset_profile`)

1. **Acquire Lock:** Acquires exclusive `ProfileLock` on `manager.lock` (up to 5s timeout).
2. **Idempotence Check:** If `meta.last_reset_operation_id == Some(operation_id)`, returns `ResetOutcome::Completed` immediately without re-executing.
3. **Epoch Validation:** Confirms `meta.profile_epoch == expected_profile_epoch`; mismatch returns `ManagerError::StaleEpoch`.
4. **Advance Epoch & Persist Tombstone:** Increments `profileEpoch`, sets state to `InstanceLifecycleState::Resetting`, and atomically writes `reset.json` tombstone with `stage: ResetStage::Initiated`. Atomically saves `manager.json` with new epoch.
5. **Terminate Process (Bounded 10s):** Updates tombstone to `stage: ResetStage::Terminating`. If running, terminates browser process via `proc.terminate()` with `DEFAULT_TERMINATE_TIMEOUT = 10s`. Failure or timeout transitions tombstone to `stage: ResetStage::Failed`, enters `InstanceLifecycleState::CleanupPending`, and returns `ResetOutcome::CleanupPending`.
6. **Delete User Data (Bounded 10s):** Updates tombstone to `stage: ResetStage::DeletingUserData`. Asynchronously deletes `user-data/` with `DEFAULT_DELETE_TIMEOUT = 10s`. Failure or timeout records `stage: ResetStage::Failed`, enters `CleanupPending`, and returns `ResetOutcome::CleanupPending`.
7. **Recreate User Data:** Updates tombstone to `stage: ResetStage::RecreatingUserData`. Recreates empty `user-data/` directory with mode `0700`.
8. **Clear Tombstone & Complete:** Records `last_reset_operation_id` in `manager.json`, clears `reset.json`, transitions state to `Dormant`, releases `ProfileLock`, and returns `ResetOutcome::Completed`.

### Tombstone Lifecycle & Crash Reconciliation

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
  - Connecting peer socket address must be loopback (`127.0.0.1` or `::1`). Non-loopback fails closed with HTTP 403 `kind: "devBypassDenied"`.
  - Forwarded headers (`X-Forwarded-For`, `X-Real-IP`) are explicitly ignored; only raw socket peer address is evaluated.
  - If an `Origin` header is present, it must match configured `cors_origins` or standard local Vite dev ports (`http://127.0.0.1:5173`, `http://localhost:5173`).
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
- **Idempotent Creation:** `POST /api/browser/sessions` requires `creationKey`. Caches up to 128 idempotency records per principal for 10 minutes (`IDEMPOTENCY_TTL = 600s`). Retrying with the same key returns the existing session with HTTP 200 OK.
- **Target Capacity Limits:** Bounded to `DEFAULT_MAX_TARGETS = 2` per principal. Over-capacity creates return HTTP 429 `kind: "browserBusy"`.
- **Independent Epochs:** Tracks `navigationRevision` independently of `viewportEpoch` and `profileEpoch`.
- **Popup Management:** Native popup creation creates bounded server sessions; capacity overflow closes the popup and sets `popupBlocked: true`.

## 14. Navigation & HTTP Network Policy (`network_policy.rs`)

Navigation URLs are validated against `validate_navigation_url`:
- **Length Ceilings:** URL length $\le 4096$ bytes (`MAX_URL_BYTES`), title length $\le 512$ bytes (`MAX_TITLE_BYTES`).
- **Scheme Restrictions:** Only `http`, `https`, and `about:blank` are permitted; `file:`, `javascript:`, `chrome:`, `data:` are rejected.
- **Credentials Prohibited:** Embedded usernames/passwords in URLs fail closed.
- **Production Private & Metadata IP Blocking:** Rejects private IPv4/IPv6, link-local, loopback, and cloud metadata endpoints (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`, `metadata.google.internal`) unless matching explicit project origin exceptions.
- **Development Isolation:** Rejects general internet destinations; restricts navigation to loopback and configured `allowed_origins`.

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

## 19. Qualification Status & Open Proof Obligations

Qualification was executed on Linux x86_64 (`Linux 7.2.15-200.fc44.x86_64`) against real Google Chrome 157.0.8103.38:

| Gate | Status | Evidence / Invariant |
| --- | --- | --- |
| Linux Process Containment | **PASS** | Process group isolation, death-pipe watcher, and procfs scan verified |
| Adapter Bounds & Budget | **PASS** | 64-command cap, 2 MiB RAII byte budget, 32-msg writer queue, 5s write deadline |
| Coordinate Mapping | **PASS** | Authoritative marker centroids verified for DPR 1/2, scroll, pageScale, visual offsets |
| Wire Codec (BHJF) | **PASS** | Roundtrip encode/decode, SOF dimension verification, decimal sequence validation |
| Dual Bearer Relay | **PASS** | Exact Origin policy, bearer authentication, 2-connection concurrency, 4 MiB frame limit |
| Configuration & Capabilities | **PASS** | Bounded budgets, origin/destination validation, executable/root permissions, domain DTO |
| Principal Profile Isolation | **PASS** | Dev/prod separation, 64-hex hashed root, 0700/0600 permissions, advisory flock exclusivity |
| Reset Reconciliation & Tombstones | **PASS** | Epoch advance, atomic reset.json, 10s terminate/delete timeouts, CleanupPending fencing |
| Lazy Manager & Graceful Shutdown | **PASS** | Zero startup spawn, reconnect reuse, 10s shutdown reap preserving credentials |
| Admission & Network Policy | **PASS** | Admin live role checks, dev loopback/Origin bypass, scheme/metadata filtering |
| Single-Use Capability Tickets | **PASS** | 256-bit OsRng, SHA-256 memory store, 30s TTL, single-use atomic consume, pair matching |
| Leased Input Queue & Releases | **PASS** | 30s lease, 128-record queue, contiguous inputSeq, stuck key auto-release, aspect-fit mapping |
| Agent CDP Gateway & Relay | **PASS** | Authenticated discovery URL rewriting, dedicated upstream relay, 4 MiB frame/message cap, 5s write timeout, exact Origin policy, dynamic connection budget (`budgets.max_raw_cdp_connections`, cap 8), manager target tracking (64 targets), viewport epoch fencing with stale input Conflict (409), live auth cancellation racing with socket writes and absolute deadline, and fast socket drop on revocation. Verified by 14 Rust gateway tests and 8 Playwright E2E tests in `agent.spec.ts` against production gateway mode. User approved after Cycle 3 (score 7/10; 57/57 tests passing). |
| Screencast Producer & Ingress | **PASS** | Dedicated Page session, serial `producerRun`, prompt exact-once CDP ACK, single replaceable candidate, JPEG SOF dimension validation, zero periodic screenshots, and 15s visible demand stop |
| Binary Media Fanout & Credits | **PASS** | Immutable BHJF v1 fanout via Axum `Binary(Bytes)` with zero per-viewer JPEG copies, independent credit governor (max 10 FPS, 2 outstanding + 1 pending), originating socket subscription authority, 30s outstanding timeout, 5s write deadline, pause detaching demand, and max 2 global viewers |
| Stream Memory Admission | **PASS** | Hard 128 MiB global memory reservation ceiling across ingress, commands, raw gateway, and frames; `TrackedBhjfFrame` shared RAII reservation held until last clone drops; bounded stream diagnostics counters and ring buffer |
| Native Browser Zoom | **UNVERIFIED** | Unreachable via standard CDP in headless Chromium 157; `inputTrusted: false` enforced |
| Windows Containment | **FAIL-CLOSED** | Windows Job Object containment unqualified; non-Unix launch returns `ContainmentUnavailable` |

### Phase 05 Verification Summary

- **Phase 05 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 3 (70/70 checks passing across screencast, fanout, bounds, regressions, build, and TypeScript compile suites). Phase 06 (Frame Assembly & Decoder Pipeline) is unblocked.
- **Test Evidence:** Verified by real Google Chrome screencast tests (`server/tests/browser_host_screencast.rs` [3/3]), media fanout and credit governor tests (`server/tests/browser_host_media.rs` [7/7]), and memory admission bounds tests (`server/tests/browser_host_bounds.rs` [3/3]), alongside 57 regression tests.

### Finalization & Roadmap Status

- **Phase 04 Finalized (2026-11-09):** The user explicitly approved the code review with noted issues after Cycle 3 (score 7/10; 57/57 tests passing across Rust gateway, regressions, example build, TypeScript compile, and Playwright E2E suites). Phase 05 (Screencast Producer Actor & JPEG Fragmentation) is unblocked.
- **Noted Issues Carried Forward:** Architectural review noted follow-up areas for subsequent phases: correlating wire session IDs to native target IDs across flattened Playwright sessions (C2), wiring authoritative input manager epoch synchronization directly into production layout reconciliation (C2), and strictly deriving public server WS URLs exclusively from configured origins without request-Host fallback under complex TLS topologies (W4).
- **Observed Implementation vs Full System Qualification:** Component, gateway, and Playwright qualification pass against the production gateway mode (`browser_host_qualification.rs`), but end-to-end multi-client system qualification across concurrent human viewers, screencast streaming producers (Phase 05), decoder UI (Phase 06), and production container load (Phase 09) remains scheduled for later phases.
- **Teardown Timing Under Congestion:** While `write_with_cancel` races auth cancellation and absolute deadline against in-flight writes, actual kernel socket buffer draining and upstream termination remain subject to OS scheduler scheduling and network latency; immediate teardown is bounded by local runtime aborts, not an absolute wall-clock guarantee.
- **Windows Platform Boundary:** Windows process containment remains unimplemented and fails closed with `ContainmentUnavailable`.
- **Native Engine Zoom:** Headless Chromium zoom cannot be verified via standard CDP without layout distortion; non-unit zoom geometry remains flagged `inputTrusted: false`.
## 20. Source Map

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
| E2E Qualification Harness Fixture | `packages/ui/e2e/fixtures/browser-host-qualification.ts` |
| Playwright Compatibility Spec | `packages/ui/e2e/os-host-browser/compatibility.spec.ts` |
| Agent CDP Qualification Spec | `packages/ui/e2e/os-host-browser/agent.spec.ts` |

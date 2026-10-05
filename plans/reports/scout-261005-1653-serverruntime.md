# Server Runtime Scout Report

**Report Path**: `plans/reports/scout-261005-1653-serverruntime.md`  
**Date**: 2026-10-05  
**Target Scope**: `server/src/pty/`, `server/src/agent_status/`, `server/src/idle_suspend/`, `server/src/system.rs`, `server/src/system/`, `server/src/host_actions/`, `server/src/telemetry/`, `server/src/port_forward/`, `server/src/tunnel/`, `server/src/api/resource_events.rs`, `server/src/diagnostics/`, `server/src/ssh.rs`  

---

## 1. Directory and Symbol Map

### 1.1 `server/src/pty/` — Terminal Lifecycle, Incarnation, & Fleet State
- `mod.rs`: Re-exports PTY primitives (`BroadcastEventSink`, `EventSink`, `PtyCreateOpts`, `PtySessionManager`, `PtyTargetContext`, `SessionDetail`, `SessionMeta`, `HandoffClaim`, `PtyFleetSnapshot`, `PtyFleetState`, `PtyFleetWatcher`, `ProcessIdentity`, `TerminalIdentity`, `RootQualification`, `PtyActivitySnapshot`, `PtyActivityWatcher`).
- `manager.rs`: `PtySessionManager`, `Inner`, `LifecycleGate`, `ReaderRegistry`, `ReaderGuard`, `PtyCreateOpts`, `SessionDetail`, `TerminalBufferReplay`, `TerminalAttachSnapshot`, `is_reserved_agent_status_env_var`.
  - Invariants: Monotonic incarnation allocated per spawn/respawn; environment scrubbing of reserved keys (`DAM_HOPPER_AGENT_STATUS_URL`, `DAM_HOPPER_AGENT_STATUS_TOKEN`, `DAM_HOPPER_AGENT_HOOKS_SOCKET`); dead session retention for 60s TTL; PTY reader threads drain before graceful exit.
- `session.rs`: `LiveSession`, `DeadSession`, `SessionMeta`, `SessionType`, `RespawnOpts`, `SCROLLBACK_CAPACITY` (1 MiB).
  - Invariants: Unix process group killing (`killpg(Pid::from_raw(pgid), Signal::SIGKILL)`) to eliminate detached child trees before falling back to `ChildKiller::kill()`.
- `fleet_state.rs`: `PtyFleetSnapshot`, `PtyFleetWatcher`, `PtyFleetState`, `HandoffClaim`, `HandoffClaimError`.
  - Invariants: Strictly monotonic `generation` incremented on every state transition; quiescent iff `live_count == 0 && creating_count == 0 && restart_pending_count == 0 && !disposing && !closing && !handoff_active`.
- `activity.rs`: `ProcessIdentity` (PID + start ticks from `/proc/<pid>/stat`), `TerminalIdentity` (session ID + incarnation), `RootQualification`, `RootActivityRecord`, `ActivityIncompleteReason`, `PtyActivitySnapshot`, `PtyActivityWatcher`, `ParsedProcStat`, `parse_proc_stat`, `read_process_stat`, `probe_process_identity`, `SATURATED_COUNTER_SENTINEL` (`u64::MAX`), `MAX_LIVE_ROOTS_LIMIT` (256).
- `buffer.rs`: `ScrollbackBuffer`, `BufferReplay`. Fixed-capacity (1 MiB) circular UTF-8 scalar-boundary buffer; monotonic `total_written` counter for delta replays.
- `output_control_parser.rs`: `Utf8StreamDecoder` for chunked UTF-8 validation across stream boundaries.
- `shell_integration.rs`: `ShellIntegration`, `ShellIntegrationCapabilities`. Wraps bash (`--rcfile`), zsh (`ZDOTDIR`), and fish (`--init-command`) with randomized base64 nonce `DAM_HOPPER_SHELL_NONCE`.
- `shell_lifecycle.rs`: `ShellLifecycle`, `LifecycleState`, `LifecycleEvent`. Bounded observer for OSC 633 lifecycle markers (`\x1b]633;`) authenticated via constant-time comparison against nonce; detects alternate buffer switches (`\x1b[?1049h`) to transition state to `LifecycleState::Opaque`.
- `event_sink.rs`: `EventSink`, `BroadcastEventSink`, `NoopEventSink`. Nonce-omitting event dispatcher to WebSocket broadcast.

### 1.2 `server/src/agent_status/` — Agent Status Reporting, Ingress Privacy, & Peer Auth
- `mod.rs`: Re-exports agent status types, integration helpers, and collector runtime.
- `types.rs`: `AGENT_STATUS_PROTOCOL_VERSION` (1), `DEFAULT_HEARTBEAT_MS` (5000), `DEFAULT_LEASE_MS` (15000), `MAX_PRIVATE_FRAME_BYTES` (4096), `AGENT_STATUS_WS_PATH` (`/v1/agent-status`), `AGENT_HOOKS_PATH` (`/v1/agent-hooks`), `MAX_ANCESTRY_DEPTH` (64), `AgentKind` (`omp`, `codex`, `claude`), `AgentState` (`unknown`, `idle`, `working`, `blocked`), `BlockedReason` (`approval`, `question`, `error`), `TurnOutcome` (`ended`, `interrupted`, `error`, `unknown`), `ReporterHello`, `ReporterReport`, `PrivateHookEnvelope`, `ReporterAck`, `TerminalAgentStatusRow`, `AgentStatusSnapshotV1`.
- `runtime.rs`: `AgentStatusRuntime`, `CredentialReservation`, `CredentialState`, `ScopedCredential`, `TokenAuthResult`. Terminal-scoped credential lifecycle (`Pending` -> `Active` -> `Revoked`).
- `collector.rs`: `AgentStatusCollector`. Dual listener:
  1. Private loopback TCP WebSocket listener on `127.0.0.1:<random-port>/v1/agent-status` with `Authorization: Bearer <scoped_token>`.
  2. Linux Unix Domain Socket listener on `0600` socket in `0700` dir for native hook ingress (`POST /v1/agent-hooks`), authenticated via `SO_PEERCRED`.
- `hook_ingress.rs`: `TokenRateLimiter` (replenishment 20/s, burst 40), `validate_hook_envelope`, `verify_reporter_ancestry`.
  - Invariants: Peer PID verified against `/proc/<pid>/stat` start ticks; ancestry chain validated from leaf reporter to agent root to registered PTY shell root (`MAX_ANCESTRY_DEPTH: 64`); rejects detached daemons (e.g. Codex app-server managed daemon) and nested CLI agents.
- `hook_reporter.rs`: Early CLI handler `dam-hopper-server integration <codex|claude> report-hook`. Discards prompts/tools/outputs; exits 0 silently; 250ms deadline without retries.
- `reducer.rs`: `TerminalAgentReducer`, `AgentStatusRegistry`, `ReducerOutput`. Causal ordering, deduplication (`MAX_SEEN_EVENT_IDS: 512`), lease enforcement; produces `TerminalAgentStatusRow` stripped of tokens, prompts, outputs, file paths, and environment.
- `codex_hooks.rs`: `CODEX_QUALIFIED_EVENTS` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `Stop`, `Interrupt`, `SessionEnd`). Subagents rejected; no `Blocked` state or attention events emitted.
- `claude_hooks.rs`: `CLAUDE_QUALIFIED_EVENTS` (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `PostCompact`, `Notification`, `Stop`, `StopFailure`, `SessionEnd`). Maps `Notification` and `StopFailure` to `BlockedReason`.
- `integration.rs`, `codex_integration.rs`, `claude_integration.rs`: Managed configuration installers and status checkers for Codex (`config.toml` or `hooks.json`) and Claude Code (`config.json`).
- `assets/`: `omp-agent-status.ts` (standalone Bun adapter), `native-agent-status.sh` (POSIX launcher script).

### 1.3 `server/src/idle_suspend/` — Idle Suspend Subsystem & Helper Boundary
- `mod.rs`: Re-exports policy, coordinator, status, protocol, activity sampler, and helper IPC components.
- `policy.rs`: `StartupIdleSuspendPolicy` (immutable startup config), `RuntimeIdleSuspendTiming` (mutable quiet/wake timing pair), `AgentExecutableSet`, `validate_timing_pair`.
- `protocol.rs`: `HELPER_PROTOCOL_VERSION` (1), `MAX_HELPER_FRAME_BYTES` (4096), `HelperRequestFrame`, `HelperRequestPayload`, `HelperResponseFrame`, `HelperResponsePayload`, `SuspendWithRtcWakeRequest`, `SuspendOutcome`, `IdleSuspendTimingPatchRequest`, `IdleSuspendTimingPatchResponse`, `ForceSuspendRequest`, `ForceSuspendAcceptedResponse`, `IdleSuspendConflictResponse`, `encode_frame`, `decode_frame`. Length-prefixed framing (`u32` BE length + JSON).
- `peer_auth.rs`: `EnrolledPeerPolicy`, `PeerCredentials`, `PeerAuthError`. Authenticates unprivileged server process over UDS using `SO_PEERCRED` (UID and MainPID/pid_file).
- `helper_server.rs`: Privileged helper IPC server over UDS, running as root or dedicated systemd service.
- `helper_client.rs`: `HelperClient`. Client connection from unprivileged server to helper UDS.
- `executor.rs`: `IdleSuspendExecutor`, `SystemdIdleSuspendExecutor`, `UnavailableExecutor`, `FakeExecutor`.
- `backend.rs`: `SuspendActionBackend`, `SystemdLogindBackend`. Programs RTC wake via `/sys/class/rtc/rtc0/wakealarm` (clears with `0\n`, reads back, sets target epoch from `/sys/class/rtc/rtc0/since_epoch`, reads back) and calls `/usr/bin/systemctl suspend`.
- `preflight.rs`: `PreflightChecker`, `SysfsPreflightChecker`, `SystemdInhibitCliProvider`. Probes `/sys/power/state` ("mem"), `/sys/class/rtc/rtc0/wakealarm`, and runs `systemd-inhibit --list --no-legend`.
- `coordinator.rs`: `IdleSuspendCoordinator`, `CoordinatorState` (`Disabled`, `Watching`, `Armed`, `FinalCheck`, `HandedOff`, `Suppressed`, `Failed`, `Resumed`).
- `status.rs`: `IdleSuspendStatusV1`, `IdleSuspendActivityStatusV1`, `IdleSuspendMeasurementWarningV1`, `CoordinatorState`, `ActivityMeasurementState`.
- `timing_store.rs`: `IdleSuspendTimingStore`. Atomic persistence to canonical registry configuration.
- `server_audit.rs`: `IdleSuspendServerAudit`. Mode-0600 append-only JSONL audit log (`idle-suspend-audit.jsonl`).
- `audit.rs`: `HelperAudit`. Helper-side bounded audit log.
- `event.rs`: `IdleSuspendEventWriter`, `IdleSuspendEventEnvelopeV1`. Diagnostic semantic event writer at `/var/lib/dam-hopper/.config/dam-hopper/diagnostics/idle-suspend-events-v1.jsonl`.
- `activity/`:
  - `sampler.rs`: Cooperative single background sampler; `SAMPLE_CADENCE` = 2s, `SAMPLE_ACCEPTANCE_TIMEOUT` = 1s, `MAX_ACCEPTED_OBSERVATION_AGE` = 5s.
  - `process.rs`: `ProcessDiscovery` scanning `/proc` for configured agent executables and child lineages.
  - `tcp.rs`: `TcpObserver` monitoring IPv4/IPv6 socket byte deltas via `NETLINK_SOCK_DIAG`.
  - `tcp_info.rs`: Netlink TCP info parsing.
  - `netlink.rs`: Netlink socket encoding and decoding.

### 1.4 `server/src/system.rs` and `server/src/system/` — Resource Monitoring & Metrics
- `server/src/system.rs`: Host metrics sampler, thermal zone parsing (`/sys/class/thermal`), disk source identification (`is_real_persistent_disk`), workspace disk selection.
- `system/types.rs`: `CpuMetrics`, `DiskMetrics`, `HostMetrics`, `LoadAverageMetrics`, `MemoryMetrics`, `TemperatureMetrics`.
- `system/types_v1.rs`: `HostResourceSnapshotV1`, `MemorySnapshot`, `BatterySnapshot`, `ProcessInventory`, `CgroupMemory`, `MountContext`, `CacheAttribution`, `Availability`, `AvailabilityState`.
- `system/monitor.rs`: `HostResourceMonitor`, `CachedHostResourcePair`, `StreamStatusBasis`. Clamped collection cadence (light: 1-60s, processes: 5-300s, PSS: 15-600s, jitter <= 1000ms).
- `system/resource_stream.rs`: `HostResourcePublisher`, `StreamSubscription`, `PublishedFrame`, `encode_data_frame` (max 256 KiB), `encode_status_control` (max 4 KiB).
- `system/alerts.rs`: `AlertSummary`, `ResourceAlertSummary`, `ResourceAlertIncident`. Evaluates thermal, memory, and disk alert states.
- `system/config.rs`: Clamped limits and configurations for resource monitor.
- `system/platform.rs`: Cross-platform OS identification.
- `system/linux/`: Linux-specific deep metric probes:
  - `cgroup.rs`: Cgroup v2 memory controller and PSI inspection.
  - `meminfo.rs`: `/proc/meminfo` parser.
  - `mounts.rs`: `/proc/mounts` parser.
  - `power_supply.rs`, `power_supply_aggregation.rs`: `/sys/class/power_supply` battery and AC adapter status.
  - `process.rs`: Bounded `/proc` process RSS/PSS scan.
  - `psi.rs`: `/proc/pressure/memory`, `/proc/pressure/cpu`, `/proc/pressure/io`.

### 1.5 `server/src/api/resource_events.rs` — Authenticated SSE Streaming
- `MAX_GLOBAL_SSE_STREAMS` = 32, `MAX_SUBJECT_SSE_STREAMS` = 4.
- `HostResourceAdmission`, `AdmissionPermit`, `SubjectPermit`, `BodyLease`, `LeaseStream`.
- Route layers: Global admission permit (32) -> Origin admission check -> Bearer authentication guard (2s timeout) -> Per-subject admission permit (4) -> `events_handler`.
- Supervisor task re-evaluates signed claims every 5 seconds; cancels body via `CancellationToken` on session expiration/revocation.

### 1.6 `server/src/host_actions/` — Host Actions & Approval Workflow
- `service.rs`: `HostActionService`. Manages approval workflow, execution queue, cache cooldown (15 min), and action auditing.
- `types.rs`: `HostAction` (`DropCleanCaches`, `TerminateSameUserProcess`), `ProcessTarget`, `ActionIntentRequest`, `ApproveIntentRequest`, `ExecutionRequest`, `ActionCapabilitiesResponse`, `ActionExecution`, `ExecutionState`.
- `approval.rs`: `ApprovalStore`, `IntentChallenge`, `ApprovedIntent`. Two-phase approval: Intent creation -> Challenge (nonce) -> Reauth/Approve (credentials) -> Token -> Submit.
- `audit.rs`: `ActionAuditStore`. Append-only execution auditing.
- `helper_client.rs`: `HostActionExecutor`, `UnavailableExecutor`. Current implementation returns `available: false` (`helperNotEnrolled`).

### 1.7 `server/src/telemetry/` — Telemetry & OTLP Ingestion
- `privacy.rs`: `TelemetryHmacKey`, `TelemetryKeyRing`, `HmacDigest`. HMAC-SHA256 obfuscation of identifiers; `FORBIDDEN_CONTENT_FIELDS` (`command`, `argv`, `cwd`, `environment`, `pty_output`, `prompt`, `response`, `tool_arguments`, `tool_output`, `raw_otlp`). Enforces 0600 mode on keyfile with `O_NOFOLLOW`.
- `runtime.rs`: `TelemetryRuntime`, `TelemetryRuntimeStatus`. Coordinates ingestion worker and SQLite storage.
- `store.rs`: `TelemetryStore`. SQLite database with schema in `schema.sql`.
- `worker.rs`: Bounded background ingestion queue and batch writer.
- `retention.rs`: `purge_expired`. Daily rollup and purge of detail records older than retention window.
- `codex_otlp/`:
  - `receiver.rs`: Loopback-only HTTP server receiving `POST /v1/logs` with Bearer auth; 1 MiB body cap.
  - `decoder.rs`: Protobuf OTLP log decoder.
  - `normalizer.rs`: Drops forbidden fields, extracts usage tokens.
  - `secret.rs`: `load_or_create_secret` for local loopback bearer token.
  - `config_manager.rs`, `config_file.rs`: Manages Codex CLI configuration to route OTLP logs to DamHopper.

### 1.8 `server/src/port_forward/` — Port Detection & Forwarding
- `detector.rs`:
  - `port_is_safe`: Rejects ports < 1024 and `DANGER_PORTS` (`[22, 25, 110, 143, 3306, 5432, 6379, 27017]`).
  - `scan_chunk`: Scans ANSI-stripped PTY stdout chunks against regex bank (`PORT_REGEXES`).
  - `linux_poll_loop`: Linux 2s poller reading `/proc/net/tcp` and `/proc/net/tcp6` for `TcpState::Listen`; syncs both PTY-owned and ownerless tunnel ports.
- `manager.rs`: `PortForwardManager`. Tracks discovered ports and coordinates notifications.
- `session.rs`: `DetectedPort`, `DetectedVia` (`Stdout`, `ProcNet`), `PortState`.

### 1.9 `server/src/tunnel/` — Public & Quick Tunnel Management
- `driver.rs`: `TunnelDriver`, `DriverHandle`, `TunnelDriverEvent`.
- `cloudflared.rs`: `CloudflaredDriver`. Spawns `cloudflared` with args: `--no-autoupdate`, `--config ""`, `tunnel`, `--http-host-header localhost`, `--url http://127.0.0.1:{port}`. Parses `https://[a-z0-9-]+\.trycloudflare\.com`.
- `installer.rs`: `TunnelInstaller`. Resolves binary in `PATH` or downloads to `~/.dam-hopper/bin/cloudflared` (Linux x86_64 and arm64).
- `manager.rs`: `TunnelSessionManager`. Controls tunnel lifecycle, handles collision prevention, and manages graceful shutdown.
- `session.rs`: `TunnelSession`, `TunnelStatus` (`Starting`, `Ready`, `Failed`, `Stopped`).

### 1.10 `server/src/diagnostics/` — Backend Diagnostics & Redaction
- `redaction.rs`: `redact_diagnostic_text`, `redact_diagnostic_fields`. Redacts sensitive field names (`authorization`, `cookie`, `token`, `password`, `passphrase`, `apikey`, `secret`, `credential`) and regex patterns (Bearer tokens, Authorization/Cookie headers, key-value assignments).
- `store.rs`: `DiagnosticStore`. Bounded JSONL logger at `~/.config/dam-hopper/diagnostics/backend-log.jsonl` (60 min retention).
- `tracing_layer.rs`: `DiagnosticTracingLayer`. Tracing subscriber layer piping log events into `DiagnosticStore`.
- `types.rs`: `BackendDiagnostics`, `DiagnosticEvent`, `DiagnosticExportRequest`, `DiagnosticExportResponse`.

### 1.11 `server/src/ssh.rs` — SSH Credential Management
- `SshCredStore`: Holds private key path and `Zeroizing<Vec<u8>>` passphrase in memory.
- `KeyringSshCredentialStore`: Linux OS keyring persistence using `secret-tool` CLI (`service: "dam-hopper.ssh-passphrase"`).

---

## 2. Runtime and Data Flow

### 2.1 PTY Spawn and Terminal Lifecycle
```
Client Request (POST /api/terminal)
   |
   v
PtySessionManager::create_with_buffer()
   |-- Allocates monotonic incarnation
   |-- Strips DAM_HOPPER_AGENT_* from client env
   |-- Reserves scoped credential in AgentStatusRuntime
   |-- Injects DAM_HOPPER_AGENT_STATUS_URL, TOKEN, SOCKET into cmd
   |-- ShellIntegration::prepare() wraps interactive shell (Bash/Zsh/Fish) with NONCE
   v
portable_pty::spawn_command()
   |-- Probes ProcessIdentity (/proc/<pid>/stat start ticks)
   |-- Activates credential reservation in AgentStatusRuntime
   |-- Registers terminal root in AgentStatusRuntime
   v
PtyReader Thread
   |-- Reads raw master PTY chunks
   |-- Utf8StreamDecoder & ScrollbackBuffer (1 MiB capacity)
   |-- ShellLifecycle parses OSC 633 markers with constant-time nonce check
   |-- scan_chunk() strips ANSI, regex matches listening ports -> PortForwardManager
   |-- IncarnationEventSink broadcasts terminal data & lifecycle events
```

### 2.2 Agent Status Ingress & Redaction Pipeline
```
Native Hook (Codex/Claude)                 OMP Extension (Bun)
   |                                              |
   | (dam-hopper-server integration ...           | (Private WebSocket connection)
   |  report-hook, 250ms timeout)                 |
   v                                              v
Linux UDS (0600 mode)                       127.0.0.1:<port>/v1/agent-status
   |-- SO_PEERCRED reads peer PID                 |-- Bearer token authenticated
   |-- verify_reporter_ancestry(/proc)            |-- ReporterHello / ReporterReport
   v                                              v
AgentStatusRuntime
   |-- TokenRateLimiter (20/s, burst 40)
   |-- TerminalAgentReducer: validates protocol v1, deduplicates event IDs (max 512)
   |-- Strips all prompts, tool inputs/outputs, model names, transcript paths
   v
AgentStatusRegistry
   |-- Emits TerminalAgentStatusRow (omits raw text/paths)
   +-- Broadcasts AgentStatusBroadcastEvent to connected browsers
```

### 2.3 Idle Suspend Observation, Handoff, and Execution
```
IdleSuspendCoordinator
   |-- Watches PtyFleetState monotonic generation
   |-- Automatic policy:
         * EmptyFleet: live_count == 0 && creating_count == 0 && restart_pending == 0
         * AgentActivity: Sampler polls /proc (lineage) & NETLINK_SOCK_DIAG (TCP deltas)
   |-- Grace period countdown (quiet_period_seconds: 60..=86400)
   v
FinalCheck Phase
   |--pty_manager.try_claim_handoff(expected_generation) atomically locks fleet
   v
Helper IPC Execution (SystemdIdleSuspendExecutor)
   |-- Sends SuspendWithRtcWakeRequest over length-prefixed UDS frame
   v
Privileged Helper (HelperServer / SystemdLogindBackend)
   |-- Peer auth: verifies caller UID / PID via SO_PEERCRED
   |-- Clears /sys/class/rtc/rtc0/wakealarm with "0
" and verifies readback
   |-- Sets wakealarm epoch = since_epoch + wake_after_seconds and verifies readback
   |-- Invokes /usr/bin/systemctl suspend
   v
Host Resumes
   |-- Helper reports SuspendOutcome::ResumedSuccessfully
   |-- Coordinator releases handoff claim and publishes Resumed state
```

### 2.4 Host Resource SSE Pipeline
```
HostResourceMonitor (background sampler)
   |-- Probes sysinfo (CPU, disk), /proc/meminfo, /proc/pressure, cgroups v2, /sys/class/power_supply
   |-- Commits CachedHostResourcePair under lock with monotonic revision
   v
HostResourcePublisher (demand-driven)
   |-- Awakened by active subscribers (watch channel)
   |-- Encodes host-resources data frame (max 256 KiB) and status controls (max 4 KiB)
   v
GET /api/system/resources/v1/events (Axum SSE Route)
   |-- Layer 1: Global semaphore permit (max 32 live streams)
   |-- Layer 2: Origin validation (rejects invalid cross-origin)
   |-- Layer 3: Bearer authentication (2s timeout, rejects --no-auth)
   |-- Layer 4: Per-subject lease (max 4 per user)
   |-- Supervisor: revalidates claims against database every 5s
   v
Client Browser (fetch streaming)
```

---

## 3. Authoritative Commands, Configuration, and Contracts

### 3.1 CLI Commands
- `dam-hopper-server integration codex install [--agent-dir <path>]`: Installs Codex native hooks into `config.toml` or `hooks.json`.
- `dam-hopper-server integration codex uninstall [--agent-dir <path>]`: Cleans managed hooks from Codex configuration.
- `dam-hopper-server integration codex status [--agent-dir <path>]`: Inspects Codex managed hook installation.
- `dam-hopper-server integration claude install [--agent-dir <path>]`: Installs Claude Code hooks into `config.json`.
- `dam-hopper-server integration claude uninstall [--agent-dir <path>]`: Cleans managed hooks from Claude configuration.
- `dam-hopper-server integration claude status [--agent-dir <path>]`: Inspects Claude hook installation.
- `dam-hopper-server integration <codex|claude> report-hook`: Early-dispatch hook reporter invoked by shell hooks; sends envelope to UDS and exits 0.

### 3.2 Configuration Contracts (`[server.idle_suspend]`)
- `enabled`: boolean (immutable startup policy).
- `quiet_period_seconds`: 60..=86400 (default 900s).
- `wake_after_seconds`: 60..=86400 (default 600s; 0 permitted only in manual force-suspend for indefinite sleep).
- `enrollment_reference`: optional helper enrollment string.
- `capability_selection`: `"unavailable" | "fake" | "systemd"`.
- `automatic_policy`: `"empty-fleet" | "agent-activity"`.
- `agent_executables`: array of 1..=32 literal executable basenames/paths (default: `["codex", "omp", "claude", "agy"]`). Disallows interpreters (`node`, `bun`, `bash`, `python`, etc.).

### 3.3 HTTP & IPC Endpoints
- `GET /api/system/idle-suspend/v1/status`: Authoritative status snapshot (`IdleSuspendStatusV1`).
- `PATCH /api/system/idle-suspend/v1/timing`: Mutates `quietPeriodSeconds` and `wakeAfterSeconds`. Rejects `--no-auth`.
- `POST /api/system/idle-suspend/v1/force-suspend`: Initiates manual force sleep handoff (`wakeAfterSeconds: 0 | 60..=86400`, `force: bool`). Rejects `--no-auth`.
- `GET /api/system/resources/v1/snapshot`: Cached REST resource snapshot (`HostResourceSnapshotV1`).
- `GET /api/system/resources/v1/events`: Authenticated SSE stream for resource snapshots and metrics.
- `POST /api/diagnostics/export`: Exports redacted diagnostics bundle (`DiagnosticBundleV1`).
- `POST /v1/logs` (Internal Telemetry Collector): Ingests OTLP protobuf logs on loopback interface only.

---

## 4. Product Capabilities and Limits

| Subsystem | Verified Capabilities | Hard Limits & Constraints |
|---|---|---|
| **PTY Management** | Bash, Zsh, Fish interactive shell integration; OSC 633 prompt tracking; ANSI port scanning; process group killing | 1 MiB scrollback buffer cap; 60s dead-session TTL; 256 max live roots snapshot limit |
| **Agent Status** | OMP (WebSocket), Codex (Hooks), Claude Code (Hooks); causal deduplication; 15s lease expiry | Rate limited to 20/s (burst 40); 4 KiB frame cap; ancestry depth max 64; prompts/tools/outputs discarded |
| **Idle Suspend** | RTC wakealarm programming; systemd inhibit inspection; empty-fleet & agent-activity policies | Quiet/wake timing clamped to 60-86400s; helper IPC frame capped at 4 KiB; Linux only; rejected in `--no-auth` |
| **Host Resource SSE** | Continuous streaming of deep Linux metrics, cgroups v2, battery, PSI | Capped at 32 global streams, 4 per subject; data frame cap 256 KiB; control frame cap 4 KiB |
| **Port Forwarding** | Regex stdout sniffing; Linux `/proc/net/tcp` & `tcp6` polling every 2s | Disallows ports < 1024 and danger ports (22, 25, 110, 143, 3306, 5432, 6379, 27017) |
| **Tunnels** | Cloudflared quick tunnels with Host header rewrite for Vite dev servers | Cloudflared only; Linux x86_64/arm64 auto-install; port collision 409 |
| **Telemetry** | HMAC-SHA256 anonymization of identifiers; OTLP log ingestion; detail retention purge | Loopback receiver only; 1 MiB body cap; strict exclusion of commands/prompts/outputs |
| **Diagnostics** | Automatic redaction of credentials/tokens; JSONL ring storage | 60 min lookback window; 64 KiB terminal tail cap |
| **Host Actions** | Intent challenge & credential re-authentication workflow | Currently disabled (`helperNotEnrolled`); 15 min cache cooldown |
| **SSH Management** | In-memory `Zeroizing` passphrase storage; Linux `secret-tool` OS keyring persistence | Linux only for keyring; plaintext never persisted to disk |

---

## 5. Documentation Updates Needed

1. **`docs/terminal-idle-suspend-security.md` & `docs/api/idle-suspend.md`**:
   - *Evidence*: `server/src/idle_suspend/policy.rs:18-47` and `server/src/config/schema.rs:366-368` enforce `MIN_IDLE_SUSPEND_AGENT_EXECUTABLES = 1` and `MAX_IDLE_SUSPEND_AGENT_EXECUTABLES = 32`. Documentation should clearly emphasize that generic interpreters (node, bun, python, sh) are strictly rejected by lexical validation.
2. **`docs/architecture/agent-status.md`**:
   - *Evidence*: `server/src/agent_status/hook_ingress.rs:198-212` explicitly rejects Codex 0.160+ shared managed daemons (`codex app-server --managed-daemon`) because detached daemons break PTY shell ancestry tracking. Docs must advise running Codex with `codex --no-daemon` for terminal-scoped tracking.
3. **`docs/api/system-services.md`**:
   - *Evidence*: `server/src/host_actions/service.rs:61-75` and `server/src/host_actions/helper_client.rs:25-31` show `HostActionService::capabilities` hardcodes `available: false` with reasons `noAuth`, `reauthUnavailable`, or `helperNotEnrolled`. Docs should clearly document host remediation actions (`dropCleanCaches`, `terminateSameUserProcess`) as planned/pending enrollment rather than currently executable.
4. **`docs/api/system-services.md` (Port Forwarding & Danger Ports)**:
   - *Evidence*: `server/src/port_forward/detector.rs:16` explicitly specifies `DANGER_PORTS = [22, 25, 110, 143, 3306, 5432, 6379, 27017]`. These blocked ports and the `< 1024` restriction should be explicitly cross-referenced in port forwarding API docs.
5. **`docs/configuration/server-runtime-settings.md`**:
   - *Evidence*: `server/src/telemetry/privacy.rs:14-25` documents `FORBIDDEN_CONTENT_FIELDS` and the requirement that `telemetry-hmac-key` be a regular file with mode `0600` opened with `libc::O_NOFOLLOW`. Operational guides should note this security file permission requirement.

---

## 6. Retired versus Active Functionality

- **Active**:
  - PTY Process Group Killing (`nix::sys::signal::killpg`) on Unix (`server/src/pty/session.rs:293-311`).
  - Native Agent Hook Ingress via private UDS (`server/src/agent_status/collector.rs:77-105`).
  - OSC 633 Shell Lifecycle Tracking with Nonce validation (`server/src/pty/shell_lifecycle.rs`).
  - Netlink TCP Socket Observation via `NETLINK_SOCK_DIAG` (`server/src/idle_suspend/activity/tcp.rs`).
  - Real-time Host Resource SSE with multi-tier admission control (`server/src/api/resource_events.rs`).
  - Cloudflared Quick Tunnel supervisor with Host header rewrite (`server/src/tunnel/cloudflared.rs`).
- **Retired / Obsolete**:
  - Codex OSC 9 escape sequence integration: Completely removed; replaced by native hook ingress.
  - Automatic Codex TUI notification setting modification: Retired in favor of native hook report dispatch.
  - Legacy `/etc/dam-hopper/idle-suspend-audit.jsonl`: Unused legacy audit path; server uses canonical path `/var/lib/dam-hopper/idle-suspend-audit.jsonl`.
- **Planned / Staged (Not Active)**:
  - `HostActionService` real execution: `HostActionExecutor` is currently stubbed with `UnavailableExecutor` (`available: false`, returning `helperNotEnrolled`).

---

## 7. Unresolved Questions

1. When will the privileged `HostActionExecutor` IPC helper be implemented to allow `dropCleanCaches` and `terminateSameUserProcess` in production environments?
2. Will future Codex versions provide an attached execution mode for `app-server` hooks to avoid requiring `codex --no-daemon` for PTY ancestry validation?
3. Is Windows OS keyring persistence planned for SSH credentials, or will SSH passphrase persistence remain Linux-only (`secret-tool`)?

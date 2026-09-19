# Windows platform scout: `linux_release` and `idle_suspend`

## Scope and result

Read-only inventory of `server/src/` callers, module declarations, exports, Linux/Unix assumptions, and concrete Windows gating points. Existing Linux implementations are left conceptually intact: the recommended cutover is target-gating Linux backends and supplying explicit fail-closed Windows paths rather than changing Linux behavior.

Target symbols searched:

- `use crate::linux_release::...` and `use dam_hopper_server::linux_release::...`
- `use crate::idle_suspend::...` and `use dam_hopper_server::idle_suspend::...`
- qualified calls, module declarations, startup construction, Unix/Linux APIs, `/proc`, `/sys`, systemd, and Unix sockets.

## 1. Crate/module declarations and binaries

### `server/src/lib.rs`

- `pub mod linux_release;` (line 12): currently compiles the complete Linux release manager on every target.
- `pub mod idle_suspend;` (line 13): currently compiles helper IPC, systemd backend, and Linux activity sampler on every target.
- `probe_inotify_limit()` is already correctly Linux-gated internally (`#[cfg(target_os = "linux")]`); the non-Linux body is a no-op. This is a useful existing pattern to preserve.

### `server/src/main.rs`

`main.rs` is the `dam-hopper-server` binary entrypoint, not a library module declaration. `server/Cargo.toml` declares:

```toml
[[bin]]
name = "dam-hopper-server"
path = "src/main.rs"
```

Relevant startup/shutdown sites:

- Lines 369-384: unconditionally constructs `Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor>` and `SystemdIdleSuspendExecutor` using `/run/dam-hopper/idle-suspend.sock`, then calls `state.start_idle_suspend_coordinator(...)`.
- Lines 402-403: starts `proc_poll_loop`; this function already has a non-Linux warning/no-op implementation in `server/src/port_forward/detector.rs` (lines 125-136), so retain this call or cfg it without changing Linux.
- Lines 416-429: SIGTERM handler is already `#[cfg(unix)]`, with a `ctrl_c`-only `#[cfg(not(unix))]` fallback.
- Lines 525-539: token file writer already has Unix mode 0600 branch and non-Unix `std::fs::write` fallback.
- Shutdown always calls `state.shutdown_idle_suspend_coordinator()`, which is portable if the coordinator remains available with a fail-closed executor.

Recommended main startup change:

```rust
#[cfg(target_os = "linux")]
let idle_suspend_executor = Arc::new(SystemdIdleSuspendExecutor::new(&socket_path));
#[cfg(not(target_os = "linux"))]
let idle_suspend_executor = Arc::new(UnavailableExecutor::new("idle suspend is Linux-only"));
```

Keep coordinator/state/API initialization on Windows; only host suspend execution and Linux activity measurement become unavailable.

### Binaries in `server/src/bin/`

- `dam-hopper.rs` exists and is the Linux release-manager CLI. There is no `server/src/bin/dam-hopper-server.rs`; the server binary is `server/src/main.rs` as confirmed by `Cargo.toml`.
- `dam-hopper-idle-suspend-helper.rs` exists and is a privileged Unix/systemd helper. It unconditionally uses `tokio::net::UnixListener`, `tokio::signal::unix`, and Linux/systemd implementations; only peer credential selection has a non-Linux branch.
- `dam-hopper-web.rs` is portable at the transport layer and already has a Unix/non-Unix shutdown branch; it indirectly consumes `linux_release` portable data APIs (see below).

## 2. All `linux_release` direct imports and callers

### Direct external/library callers

#### `server/src/bin/dam-hopper.rs`

Lines 4-9 import from `dam_hopper_server::linux_release`:

- `acquire_release`
- `current_euid`
- `execute_activation_with_args`
- `execute_manual_rollback`
- `execute_recovery`
- `load_host_config`
- `load_or_init_manager_state`
- `save_host_config`
- `stage_release_bundle`
- `verify_api_service_account`
- `verify_privileges`
- `Cli`
- `CollectorAdapters`
- `Commands`
- `HostConfig`
- `Layout`
- `ReleaseError`
- `RoleCommands`
- `TargetRole`
- `ALL_SERVICE_UNITS`
- `run_diagnose`

Qualified callsites in this binary:

- Lines 16-18: `current_euid`, `verify_privileges` before command dispatch.
- Lines 26-42: `acquire_release` for `Fetch`.
- Lines 45, 90, 137, 153, 303, 319: `verify_host_platform` before install, role set, start, stop, rollback, recover.
- Lines 50, 95: `verify_api_service_account`.
- Lines 66-74: `stage_release_bundle`.
- Lines 99-107 and 309-315: activation/rollback/recovery paths.
- Lines 159-160: `systemctl_is_active` and `systemctl_stop` over `ALL_SERVICE_UNITS`.
- Lines 167-168: `terminate_stray_listeners` on API/web ports.
- Lines 174-183: manager state load/save and cleanup.
- Lines 206 onward: `collect_all_services_status`.
- Lines 339-343: `validate_manifest_and_archive`.
- Lines 365-368: `PROFILE_ID` and `RELEASE_MANIFEST_SCHEMA_VERSION`.
- Lines 377-383: `provision_installed_api_runtime`.

**Proposal:** cfg-gate this binary's current implementation to Linux. Add a Windows `main` that prints a clear “Linux release manager is unavailable on Windows” error and returns failure. Do not make the full deployment API compile on Windows merely to support this binary; that would expose systemd, `/proc`, UID, flock, and Linux descriptor APIs unnecessarily.

#### `server/src/web_host/mod.rs`

- Line 16: `use crate::linux_release::version::validate_version`.
- Used by `run_web_host` release-version validation (lines 37-46).

#### `server/src/web_host/runtime_config.rs`

- Lines 7-9 import `HostPublicConfig`, `validate_web_origin`, and `validate_version` from `linux_release` submodules.
- Line 209 constructs `crate::linux_release::TargetRole::Both` in a test fixture.

**Proposal:** preserve these portable release-contract symbols on all targets. They are schema/validation utilities, not deployment execution. If `linux_release` is split into a Linux-only module and a portable contract module, either move these four symbols to a platform-neutral module or provide a small non-Linux `linux_release` facade containing exactly `version`, `origin`, `HostPublicConfig`, and `TargetRole`/its serde contract.

### Internal `linux_release` caller sites under `server/src/`

These are not external consumers, but they must be included when cfg-gating modules:

- `linux_release/diagnostics/collector.rs`: imports `constants::{API_SERVICE_UNIT, HELPER_SERVICE_UNIT}` and `layout::Layout`; calls `privilege::current_euid` and `load_host_config`; reads `/proc/sys/kernel/osrelease` and `/etc/os-release`.
- `linux_release/diagnostics/host_commands.rs`: imports service-unit constants; compiles/runs `systemctl` and `journalctl` commands.
- `linux_release/diagnostics/host_probes.rs`: imports `Layout`; probes `/sys/power/state`, RTC sysfs, and `/proc/<pid>/exe`.
- `linux_release/diagnostics/output.rs`: imports `Layout` and user diagnostics path resolver; unconditionally imports Unix filesystem extension traits and libc no-follow flags.
- `linux_release/diagnostics/file_sources.rs`: imports idle-suspend audit/event record types; Unix flags are already locally cfg-gated, so its generic file scanning can remain if the Linux-only output/security path is separated.
- `linux_release/diagnostics/redaction.rs`, `tests.rs`: consume idle-suspend record DTOs and can remain with DTOs; platform tests need target cfg.
- `linux_release/diagnostics/phase06_tests.rs`: imports all diagnostics APIs and has unguarded Unix test imports; gate the module/test functions with `#[cfg(all(test, target_os = "linux"))]` or split portable parser tests from Linux filesystem tests.
- `web_host/mod.rs` and `web_host/runtime_config.rs` are the only non-`linux_release` production consumers found outside `dam-hopper.rs`.

## 3. `linux_release` public module/export inventory

`server/src/linux_release/mod.rs` currently declares these modules (all unconditional):

`account`, `api_runtime` (private), `acquire`, `acquire_client`, `activate`, `activate_preflight`, `archive`, `archive_extract`, `attestation`, `cli`, `constants`, `diagnostics`, `durable_fs`, `error`, `health`, `host_config`, `inventory`, `inventory_path` (private), `inventory_validation` (private), `journal`, `layout`, `legacy_format2`, `legacy_format2_inspect`, `legacy_format2_manifest`, `legacy_format2_root`, `legacy_format2_unit`, `lock`, `manifest`, `manifest_validation` (private), `migration`, `origin`, `ownership`, `platform`, `privilege`, `process`, `process_holders`, `recovery`, `retention`, `rollback`, `stage`, `stage_transaction`, `stage_units`, `state`, `state_record`, `status`, `systemd`, `systemd_backup`, `transaction`, `unit`, `unit_parser`, `unit_policy`, `version`.

Public re-exports and exact symbols:

- `account`: `get_group_by_gid`, `get_group_gid_by_name`, `get_user_by_name`, `resolve_api_runtime_identity`, `resolve_service_user`, `verify_api_service_account`, `verify_web_sysuser_account`, `ApiRuntimeIdentity`, `UserInfo`.
- `api_runtime`: `provision_and_start_api_with`, `provision_api_runtime`, `provision_installed_api_runtime`.
- `acquire`: `acquire_release`, `AcquisitionRecord`.
- `activate`: `execute_activation`, `execute_activation_locked`, `execute_activation_locked_with_args`, `execute_activation_with_args`.
- `archive`: `inspect_and_validate_archive`; `archive_extract`: `extract_role_projection`.
- `attestation`: `verify_file_attestation`.
- `cli`: `Cli`, `Commands`, `DiagnoseArgs`, `FetchArgs`, `InstallArgs`, `RoleCommands`, `RoleSetArgs`, `StartArgs`, `StatusArgs`, `StopArgs`, `ValidateArgs`.
- `diagnostics`: `collect_diagnostic_bundle`, `run_diagnose`, `Clock`, `CollectorAdapters`, `CurrentHostProbeReader`, `EuidProvider`, `HostCommand`, `HostCommandRunner`, `LocalIdleStatusClient`, `ProductionCurrentHostProbeReader`, `ProductionHostCommandRunner`, `ProductionLocalIdleStatusClient`, `SystemClock`, `SystemEuidProvider`.
- `constants::*`: `RELEASE_MANIFEST_SCHEMA_VERSION`, `MANAGER_STATE_SCHEMA_VERSION`, `PROFILE_ID`, `LEGACY_PROFILE_ID`, `PROFILE_OS_ID`, `PROFILE_OS_VERSION`, `PROFILE_ARCH`, `PROFILE_TARGET`, `PROFILE_GLIBC_MIN`, `PROFILE_SYSTEMD_MIN`, API/web/recovery/helper unit names, API/web identities/paths/ports/health paths, `ALL_SERVICE_UNITS`, rollback compatibility constants, and manifest/state/archive/path size limits. `expected_archive_name` is also public.
- `durable_fs`: `atomic_symlink`, `atomic_write_file`, `atomic_write_json`, `copy_file_durable`, `sync_dir`.
- `error`: `ReleaseError`.
- `health`: `probe_http_endpoint`, `wait_for_health_stability`, `HealthProbeTarget`, `HttpProbeOutcome`, `DEFAULT_PROBE_INTERVAL`, `DEFAULT_REQUIRED_CONSECUTIVE`, `DEFAULT_STARTUP_DEADLINE`.
- `host_config`: `load_host_config`, `load_host_public_config`, `save_host_config`, `save_host_public_config`, `HostConfig`, `HostPublicConfig`.
- `inventory`: `check_disallowed_files`, `normalize_inventory_path`, `validate_inventory`, `EntryKind`, `InventoryEntry`, `ReleaseRole`, `TargetRole`.
- `journal`: `classify_recovery`, `validate_transition`, `DeploymentState`, `RecoveryAction`.
- `layout`: `resolve_user_diagnostics_dir`, `resolve_user_diagnostics_dir_with`, `Layout`.
- `legacy_format2`: `import_legacy_format2_release`, `inspect_format2_installation`, `inspect_format2_root`, `is_legacy_format2_root`, `validate_format2_unit`, `LegacyFormat2Evidence`, `LegacyFormat2Manifest`, `LEGACY_FORMAT2_PORT`, `LEGACY_FORMAT2_TAG`, `LEGACY_FORMAT2_UNIT`, `LEGACY_FORMAT2_USER`.
- `lock`: `DeploymentLock`.
- `manifest`: `validate_manifest_and_archive`, `ApiServiceContract`, `ArchiveMeta`, `ComponentVersion`, `ComponentsMeta`, `ProfileMeta`, `ReleaseManifest`, `ReleaseMeta`, `RollbackMeta`, `ServicesMeta`, `WebServiceContract`.
- `origin`: `validate_web_origin`, `validate_web_origins`.
- `ownership`: `verify_manager_state_permissions`, `verify_path_permissions`, `verify_release_ownership`.
- `platform`: `get_runtime_glibc_version`, `get_runtime_systemd_version`, `is_systemd_booted`, `parse_os_release`, `parse_systemd_version`, `verify_arch`, `verify_glibc_version`, `verify_host_platform`, `verify_os_release`, `verify_systemd_version`, `OsRelease`.
- `privilege`: `current_euid`, `verify_privileges`.
- `process`: `check_ports_free`, `inspect_service_process`, `is_port_listening`, `parse_proc_net_listening`, `terminate_stray_listeners`, `verify_no_foreign_sqlite_holders`, `ServiceProcessEvidence`.
- `recovery`: `execute_recovery`.
- `retention`: `apply_retention`.
- `rollback`: `execute_manual_rollback`, `rollback_activation_failure`.
- `stage`: `load_pending_state`, `resolve_host_role`, `PendingState`.
- `stage_transaction`: `stage_release_bundle`.
- `stage_units`: `stage_candidate_units`.
- `state`: `backup_state_file`, `load_or_init_manager_state`, `save_manager_state`, `ManagerState`.
- `state_record`: `FailureRecord`, `PendingCandidateRecord`, `ReleaseRecord`, `TransactionPhase`, `TransactionRecord`.
- `status`: `collect_all_services_status`, `inspect_unit_status`, `ServiceStatus`.
- `systemd`: `disable_if_enabled`, `systemctl_daemon_reload`, `systemctl_disable`, `systemctl_enable`, `systemctl_is_active`, `systemctl_is_enabled`, `systemctl_restart`, `systemctl_show_property`, `systemctl_start`, `systemctl_stop`, `systemd_analyze_verify`, `systemd_sysusers`.
- `systemd_backup`: `backup_unit_files`, `install_unit_file`, `remove_unit_file`, `restore_unit_files`.
- `transaction`: `ActivationTransaction`.
- `unit`: `render_recovery_unit`, `render_api_unit`, `render_helper_unit`, `render_unit`, `render_web_unit`, `UnitRenderContext`, `TOKEN_API_GROUP`, `TOKEN_API_HOME`, `TOKEN_API_ORIGINS`, `TOKEN_API_USER`, `TOKEN_PUBLIC_CONFIG`, `TOKEN_RELEASE_ROOT`, `TOKEN_RELEASE_VERSION`.
- `unit_parser`: `ParsedUnit`.
- `version`: `validate_commit_sha`, `validate_release_tag`, `validate_sha256_hex`, `validate_version`.

### Linux-only compile/runtime hotspots in `linux_release`

These files contain unconditional Linux/Unix APIs and require either `#[cfg(target_os = "linux")]` module gating or a Windows fallback:

- `account.rs`: `libc::getpwnam`, `getgrgid`, `getgrnam`; user/group verification cannot be Linux-ABI-free.
- `activate_preflight.rs`: unguarded `std::os::unix::fs::OpenOptionsExt`, `O_NOFOLLOW`, `ELOOP`.
- `api_runtime.rs`: unguarded `RawFd`, Unix `OsStrExt`, `libc::open/openat/fstatat/mkdirat/stat/close` and Linux descriptor flags.
- `archive_extract.rs`: unguarded `PermissionsExt`; can be made portable with cfg permission setting or Linux-only extraction.
- `host_config.rs`: unguarded Unix `OpenOptionsExt` and `O_NOFOLLOW`; its serde DTOs are portable but file loader needs a Windows implementation.
- `legacy_format2_inspect.rs`, `legacy_format2_root.rs`, `legacy_format2_unit.rs`: unguarded Unix `MetadataExt`; these inspect the old Linux/systemd layout.
- `lock.rs`: unguarded Unix `OpenOptionsExt`, `AsRawFd`, and `libc::flock`; Windows fallback should return a typed unsupported/deployment error or use a Windows lock primitive, not silently claim a lock.
- `migration.rs`: unguarded Unix metadata/permissions and symlink creation.
- `ownership.rs`: unguarded Unix `MetadataExt`, UID/mode/root checks.
- `platform.rs`: host verification is Linux/systemd profile-specific; only parsers (`parse_os_release`, `parse_systemd_version`) are portable.
- `privilege.rs`: unguarded `libc::geteuid`; Windows needs a fallback identity/unsupported response, but the Linux CLI should remain Linux-only.
- `process.rs`/`process_holders.rs`: `/proc`, cgroups, `/proc/<pid>`, listener parsing and process killing; only text parsers are portable.
- `rollback.rs`: unguarded Unix symlink creation in legacy rollback path.
- `systemd.rs`: every production function executes systemd commands; `systemctl_disable` also calls `libc::geteuid`.
- `health.rs`: calls systemd status and `journalctl`; HTTP DTOs/parsers can remain portable, production probe should be Linux-only or return unsupported.
- `diagnostics/collector.rs`, `diagnostics/host_commands.rs`, `diagnostics/host_probes.rs`, `diagnostics/output.rs`: systemd/journal/proc/sysfs and Unix secure-file output. `output.rs` has unguarded Unix extension imports, so it currently cannot compile on Windows.

Already-good cross-platform pattern: `durable_fs.rs` has `#[cfg(unix)]` permissions, `#[cfg(not(unix))]` symlink rejection, and `#[cfg(target_os = "linux")]` `renameat2` with a non-Linux error. Keep this behavior; do not turn Windows fallback into a fake atomic symlink/exchange.

### Recommended `linux_release` split

1. Keep portable release-contract code available for web host: `version`, `origin`, manifest/inventory DTOs and parsers, `TargetRole`, `HostPublicConfig`, and generic archive validation if its permission handling is made portable.
2. Gate deployment/host modules to Linux: account, api runtime, activation/preflight, systemd, platform verification, privilege, process/process holders, lock, ownership, migration, rollback/recovery/staging, Linux diagnostics production adapters, and legacy systemd-format modules.
3. For non-Linux, expose only a deliberate facade needed by web host plus typed unsupported functions where a public API must remain source-compatible. Never report Windows as a valid `linux-x86_64-systemd` host: `verify_host_platform` should return an explicit unsupported-platform `ReleaseError`, or the release-manager binary should not compile/use the API on Windows.
4. Gate Linux-only tests, especially `linux_release/diagnostics/phase06_tests.rs`, instead of weakening Linux assertions.

## 4. All `idle_suspend` direct imports and consumers

### Direct imports / qualified consumers

#### `server/src/bin/dam-hopper-idle-suspend-helper.rs`

Lines 7-14 import:

- `audit::HelperAudit`
- `backend::SystemdLogindBackend`
- `helper_server::HelperServer`
- `peer_auth::{EnrolledPeerPolicy, PeerCredentials}`
- `preflight::SysfsPreflightChecker`

Lines 75-78 construct the production preflight, systemd logind backend, audit, and helper server. Lines 98-104 bind `tokio::net::UnixListener`; lines 110-119 install Linux peer credentials (with an existing non-Linux fake credential branch); lines 127-147 use Unix SIGTERM/SIGINT.

**Proposal:** compile the real helper main only on Linux. Add a Windows stub main that logs “privileged idle-suspend helper is Linux-only” and exits nonzero. This avoids compiling Unix listener/signal code and prevents a Windows process from pretending to provide privileged suspend.

#### `server/src/main.rs`

- Lines 373-383: `IdleSuspendExecutor` trait object and `SystemdIdleSuspendExecutor` startup (full path, not `use`).
- Line 384: `state.start_idle_suspend_coordinator`.

On Windows, select `UnavailableExecutor` (capability false; execution returns `UnsupportedCapability`) so status/API continue to work and force-suspend fails closed.

#### `server/src/state.rs`

Fields (lines 74-102 and 105 onward):

- `idle_suspend_policy: Arc<StartupIdleSuspendPolicy>`
- `idle_suspend_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>`
- `idle_suspend_store: Arc<IdleSuspendTimingStore>`
- `idle_suspend_audit: Arc<IdleSuspendServerAudit>`
- `idle_suspend_coordinator: Arc<RwLock<Option<Arc<IdleSuspendCoordinator>>>>`
- `idle_suspend_event_writer: Option<Arc<IdleSuspendEventWriter>>`
- `fallback_warning_onset_ms: u64`

Methods:

- Lines 194-215: `start_idle_suspend_coordinator`, which accepts `Arc<dyn IdleSuspendExecutor>` and calls `IdleSuspendCoordinator::start_with_sink`.
- Lines 219-224: `get_idle_suspend_coordinator`.
- Lines 226 onward: `shutdown_idle_suspend_coordinator`.
- Lines 291-332: `AppState::new` constructs startup policy, runtime timing, timing store, audit, and event writer. Event writer creation already fails soft (`None`) if identity/file setup fails.

**Proposal:** keep these fields/methods portable. The state/API contract should remain present on Windows; only executor and activity sampler are unavailable. Add cfg in event identity/audit implementation or use the existing soft failure if canonical Linux boot identity is intentionally unsupported.

#### `server/src/api/idle_suspend.rs`

- Lines 11 onward import `coordinator::{CoordinatorForceSuspendResult, CoordinatorTimingResult, ForceSuspendCommand, UpdateTimingCommand}`, protocol request/response/error types, and status DTOs.
- `get_status` uses coordinator status when present, otherwise `IdleSuspendStatusV1::fallback_status` (lines 155-168).
- `update_timing` submits `UpdateTimingCommand`; if no coordinator, returns timing-unavailable response.
- `force_suspend` submits `ForceSuspendCommand`; capability/handoff/disabled outcomes map to explicit API errors.

**Proposal:** leave API routes and protocol DTOs unchanged. Windows should expose status/timing endpoints but report capability unavailable for force suspend; do not remove routes or make Windows silently succeed.

#### `server/src/api/router.rs`

- Imports `idle_suspend` API module at lines 29-32.
- Routes lines 329-338:
  - `GET /api/system/idle-suspend/v1/status` -> `idle_suspend::get_status`
  - `PATCH /api/system/idle-suspend/v1/timing` -> `idle_suspend::update_timing`
  - `POST /api/system/idle-suspend/v1/force-suspend` -> `idle_suspend::force_suspend`

Keep routes cross-platform; coordinator fallback is the compatibility boundary.

#### Other production consumers

- `server/src/api/config.rs`: lines 40, 79-149 preserve/reject idle-suspend config and serialize startup-owned policy; portable.
- `server/src/api/settings.rs`: lines 21-22 and `server/src/api/workspace.rs` lines 166-167/193-195 apply authoritative timing to config; portable.
- `server/src/api/ws.rs`: lines 240-241 subscribe to idle-suspend event hints and lines 2543 onward pump them to clients; portable.
- `server/src/linux_release/diagnostics/file_sources.rs`: imports `HelperAuditRecord`, `IdleSuspendEventEnvelopeV1`, `ServerAuditRecord` for diagnostic projection; DTO-level dependency.
- `server/src/linux_release/diagnostics/redaction.rs`: imports helper/server event/audit types and maps `IdleSuspendModeV1`; DTO-level dependency.
- `server/src/linux_release/diagnostics/tests.rs`: imports idle-suspend audit records.

### Direct internal `idle_suspend` imports

- `audit.rs`: event UUID and protocol outcome/version types.
- `coordinator.rs`: activity module, event module, executor, policy, protocol, server audit, status, timing store.
- `event.rs`: protocol request ID validation.
- `executor.rs`: protocol and helper client; `SystemdIdleSuspendExecutor` owns `HelperClient`.
- `helper_client.rs`: protocol frames/outcomes and UnixStream transport.
- `helper_server.rs`: audit, backend, peer auth, preflight, and protocol; generic connection handler itself can remain transport-agnostic.
- `server_audit.rs`: protocol `SuspendOutcome`.
- `status.rs`: policy/protocol and PTY fleet snapshot.
- `timing_store.rs`: policy validation and generic atomic write.
- `activity/mod.rs`, `activity/netlink.rs`, `activity/process.rs`, `activity/sampler.rs`: Linux activity implementation and its internal types.
- `tests.rs`: all production components plus many Unix sockets/filesystem tests.

## 5. `idle_suspend` module/export inventory

`server/src/idle_suspend/mod.rs` currently declares unconditionally:

`policy`, `protocol`, `timing_store`, `server_audit`, `coordinator`, `status`, `executor`, `peer_auth`, `preflight`, `audit`, `backend`, `helper_client`, `helper_server`, `event`, and `activity` (the latter `pub(crate)`).

Public re-exports:

- `policy`: `validate_timing_pair`, `AgentExecutableEntry`, `AgentExecutableSet`, `IdleSuspendAutomaticPolicy`, `RuntimeIdleSuspendTiming`, `StartupIdleSuspendPolicy`.
- `protocol`: `decode_frame`, `encode_frame`, `read_frame_async`, `validate_request_id`, `validate_suspend_wake_seconds`, `write_frame_async`, `ForceSuspendAcceptedResponse`, `ForceSuspendRequest`, `HelperRequestFrame`, `HelperRequestPayload`, `HelperResponseFrame`, `HelperResponsePayload`, `IdleSuspendConflictResponse`, `IdleSuspendErrorCode`, `IdleSuspendTimingPatchRequest`, `IdleSuspendTimingPatchResponse`, `ProtocolError`, `RequestDeduplicator`, `SuspendOutcome`, `SuspendWithRtcWakeRequest`, `HELPER_PROTOCOL_VERSION`, `MAX_HELPER_FRAME_BYTES`.
- `peer_auth`: `EnrolledPeerPolicy`, `PeerAuthError`, `PeerCredentials`.
- `preflight`: `parse_systemd_inhibit_output`, `ActiveInhibitor`, `FakeInhibitorProvider`, `FakePreflightChecker`, `InhibitorProvider`, `PreflightChecker`, `PreflightError`, `SysfsPreflightChecker`, `SystemdInhibitCliProvider`.
- `timing_store`: `IdleSuspendTimingStore`.
- `server_audit`: `AuditError`, `IdleSuspendServerAudit`, `IdleSuspendTimingAudit`, `ManualAuditRecord`, `ManualAuditResult`, `ServerAuditRecord`, `TimingAuditRecord`, `TimingAuditResult`.
- `coordinator`: `CoordinatorForceSuspendResult`, `CoordinatorTimingCommand`, `CoordinatorTimingResult`, `ForceSuspendCommand`, `IdleSuspendCoordinator`, `UpdateTimingCommand`.
- `executor`: `FakeExecutor`, `IdleSuspendExecutor`, `SystemdIdleSuspendExecutor`, `UnavailableExecutor`.
- `status`: `ActivityMeasurementState`, `ActivityObservationReason`, `CoordinatorState`, `IdleSuspendActivityStatusV1`, `IdleSuspendMeasurementWarningV1`, `IdleSuspendStatusV1`, `IdleSuspendWarningProcessV1`, `MeasurementWarningReasonCode`.
- `audit`: `HelperAudit`, `HelperAuditError`, `HelperAuditRecord`, `HelperAuditRecordType`, `HelperOutcomeCode`, `HelperReasonCode`, `HELPER_AUDIT_SCHEMA_VERSION`.
- `backend`: `FakeActionBackend`, `SuspendActionBackend`, `SystemdLogindBackend`.
- `helper_client`: `HelperClient`.
- `helper_server`: `HelperServer`.
- `event`: `validate_canonical_uuid`, `validate_canonical_uuid_v4`, `ActionCorrelationId`, all v1 event payload/data enums and structs (`ArmCancelledDataV1`, `ArmStartedDataV1`, `AttemptStartedDataV1`, `AutomaticPolicyV1`, `CoordinatorStartedDataV1`, `EventValidationError`, `EventWriteError`, `FinalCheckCompletedDataV1`, `FinalCheckStartedDataV1`, `HandoffClaimAcceptedDataV1`, `HandoffClaimRejectedDataV1`, `HelperOutcomeReceivedDataV1`, `HelperRequestDispatchedDataV1`, `IdleSuspendEventDataV1`, `IdleSuspendEventEnvelopeV1`, `IdleSuspendEventWriter`, `IdleSuspendModeV1`, `MeasurementRecoveredDataV1`, `MeasurementUnavailableDataV1`, `ProducerIdentity`, `ReconciliationCompletedDataV1`, `ServerIdleSuspendEventTypeV1`, `ServerIdleSuspendReasonCodeV1`, `TerminalRejectedDataV1`), and `DEFAULT_IDLE_SUSPEND_EVENTS_PATH`, `IDLE_SUSPEND_EVENT_SCHEMA_VERSION`, `MAX_EVENT_LINE_BYTES`.

### Exact platform-sensitive idle symbols

- `backend.rs`: `SuspendActionBackend` is portable as an abstraction; `SystemdLogindBackend` hardcodes `/sys/class/rtc/rtc0/wakealarm`, `/usr/bin/systemctl`/`/bin/systemctl`, and executes `systemctl suspend`. Keep the Linux implementation; add a non-Linux implementation returning `UnsupportedCapability`/`Err` if the public type must remain available. `FakeActionBackend` is portable.
- `preflight.rs`: `SystemdInhibitCliProvider` executes `systemd-inhibit`; `SysfsPreflightChecker` probes `/sys/power/state` and RTC sysfs. Keep Linux; Windows fallback must return `PreflightError::UnsupportedSuspend` or `UnsupportedRtc`, never pass.
- `helper_client.rs`: `HelperClient::check_capability` and `execute_suspend` use `tokio::net::UnixStream` (not available as a Windows transport). Gate Unix transport; on Windows return `ProtocolError::IoError` with an unsupported-platform detail, or avoid constructing this client by selecting `UnavailableExecutor`.
- `peer_auth.rs`: `PeerCredentials::from_unix_stream` is already Linux-gated. `PeerCredentials::new`, `EnrolledPeerPolicy`, and policy validation are portable. Keep the existing Linux credential check and do not use fake credentials in a production Windows helper.
- `helper_server.rs`: generic `HelperServer::handle_connection<S: AsyncReadExt + AsyncWriteExt + Unpin>` and protocol logic are portable; the real Unix listener belongs only in the Linux helper binary.
- `executor.rs`: `IdleSuspendExecutor`, `UnavailableExecutor`, and `FakeExecutor` are portable. `SystemdIdleSuspendExecutor` must be Linux-gated or given a non-Linux fail-closed implementation. Its public methods are `new`, `from_client`, and `client`; preserve only if downstream API compatibility requires them.
- `server_audit.rs`: top-level imports unconditionally use `std::os::unix::fs::{MetadataExt, OpenOptionsExt}` and `open_verified` unconditionally calls `custom_flags`, `libc::O_NOFOLLOW/O_CLOEXEC/O_NONBLOCK`, `geteuid/getegid`, uid/gid/mode checks. Split Unix hardened path from a Windows regular-file fallback, or disable server audit writer on non-Unix while retaining DTO readers.
- `event.rs`: `ProducerIdentity::load` always reads `/proc/sys/kernel/random/boot_id`; append path has Unix security branch and a non-Unix append branch. Add explicit non-Linux identity behavior (or cfg event writer initialization) so Windows does not repeatedly attempt Linux `/proc`; keep event DTO validation portable.
- `audit.rs`: Unix hardening blocks are already cfg-gated and there is a non-Unix file path. `HelperAudit::new` still depends on `ProducerIdentity::load`, so the event identity decision applies here.
- `activity/mod.rs`: exports internal sampler types and currently includes Linux `process`, `netlink`, `tcp_info`, and `tcp` modules unconditionally. `NetworkNamespaceIdentity::current_thread` already has a non-Linux error fallback, but this is insufficient because the child modules contain unguarded Unix imports/libc.
- `activity/process.rs`: unguarded Unix `MetadataExt`, Linux `/proc` process discovery (`LinuxProcSource`), and procfd/net namespace scanning. Gate production source to Linux. Preserve shared DTOs/reason enums; supply a non-Linux source/sampler that emits `ActivityUnavailableReason::ProcAccess`/`UnsupportedTransport` without claiming availability.
- `activity/netlink.rs`: Linux `NETLINK_SOCK_DIAG`, `AF_NETLINK`, raw libc socket/bind/recv/close and Linux UAPI encoding. Gate entire implementation to Linux.
- `activity/tcp.rs`: `LinuxSocketDiagnostics` delegates to netlink; gate production implementation and provide a non-Linux unavailable diagnostics source if sampler type compatibility is retained.
- `activity/sampler.rs`: `ActivitySampler::new` unconditionally constructs `LinuxProcSource` and `LinuxSocketDiagnostics`; coordinator creates it whenever policy is `AgentActivity`. Add `#[cfg]` constructor branch or an unavailable sampler. Do not let Windows `AgentActivity` report a usable measurement or mint a handoff ticket.
- `coordinator.rs`: state machine is portable, but its `AgentActivity` branch invokes Linux sampler. On Windows, either map `AgentActivity` to a fail-closed unavailable measurement (status warning, no ticket) or add a cfg-selected unavailable sampler source. `EmptyFleet` policy can continue to operate as a logical policy, but final suspend still fails through `UnavailableExecutor`.

## 6. Concrete cfg/fallback proposal (preserves Linux)

### Library/module level

Recommended minimum changes:

```rust
// lib.rs
#[cfg(target_os = "linux")]
pub mod linux_release;
#[cfg(not(target_os = "linux"))]
#[path = "linux_release_non_linux.rs"]
pub mod linux_release;

pub mod idle_suspend; // keep portable contracts; cfg internals below
```

The non-Linux release facade should expose only web-host contract symbols (`validate_version`, origin validators, `HostPublicConfig`, `TargetRole`, required manifest DTOs/constants), unless a caller explicitly needs an unsupported function. Do not re-export Linux deployment APIs as no-op success.

Alternative (less file churn): leave `linux_release` declared on all targets, add cfg to each Linux-only child module, and add `linux_release::unsupported` fallback functions/types. This is more invasive because `mod.rs` currently re-exports every Linux API unconditionally.

### Idle suspend module level

- Keep `policy`, `protocol`, `timing_store`, DTO portions of `status`, coordinator state machine, event/audit record schemas, and `UnavailableExecutor` on all targets.
- Gate Linux transport/backend implementation: `helper_client` Unix methods, `SystemdIdleSuspendExecutor`, `SystemdLogindBackend`, `SysfsPreflightChecker` production probing, `SystemdInhibitCliProvider`, helper listener startup, peer credential extraction.
- Gate `activity/process.rs`, `activity/netlink.rs`, `activity/tcp.rs`, and Linux sampler wiring to `target_os = "linux"`. Add an unavailable sampler/result path for non-Linux that carries `measurement_state = Unavailable`, a stable reason, and no claim ticket.
- Keep `HelperServer` protocol handler generic if desired, but do not expose/bind a Unix listener on Windows.
- In `main.rs`, choose `SystemdIdleSuspendExecutor` only on Linux and `UnavailableExecutor` elsewhere.
- In helper binary, choose full Linux main only; Windows stub exits nonzero. Never use the existing non-Linux fake `PeerCredentials::new(0,0,0)` in a production listener.

### Caller-facing behavior on Windows

- Server starts normally.
- Idle-suspend status endpoint remains available and reports capability unavailable / measurement unavailable where relevant.
- Timing configuration remains validated and persisted.
- Force-suspend returns the existing capability-unavailable/fail-closed response; no host suspend attempt occurs.
- Web host still validates runtime config/version/origins.
- Linux release CLI and privileged helper report unsupported platform and do not attempt systemd, `/proc`, `/sys`, Unix sockets, UID, flock, or Linux descriptor operations.
- Linux code paths remain unchanged under `#[cfg(target_os = "linux")]`.

## 7. Tests needing target cfg treatment

Production compilation blockers are more important than tests, but these test sites also contain Unix-only imports/APIs:

- `server/src/idle_suspend/tests.rs`: top-level Unix `OpenOptionsExt`; multiple Unix listener/stream tests and permissions/FIFO tests. Gate Unix helper/backend/security tests with `#[cfg(target_os = "linux")]` (or `#[cfg(unix)]` where semantics truly cover all Unix), retain protocol/policy/fake-executor tests on Windows.
- `server/src/linux_release/diagnostics/phase06_tests.rs`: top-level Unix permissions and symlink/`geteuid` tests; gate Linux deployment diagnostics tests.
- `server/src/linux_release/diagnostics/tests.rs`: symlink-specific branch already has `#[cfg(unix)]`; retain and add Windows-safe generic parser tests.
- `server/src/pty/tests.rs`: Unix permission test code and Linux process identity assertions; existing Linux cfg around some assertions is good, but any unguarded Unix imports/functions need target cfg.
- `server/src/idle_suspend/activity/tcp.rs` real Linux socket diagnostic test already has `#[cfg(target_os = "linux")]`; preserve this pattern.
- `server/src/idle_suspend/activity/process.rs` real process-tree test already has `#[cfg(target_os = "linux")]`; preserve it.

## 8. Unresolved design choices for implementation

1. Whether Windows should expose a minimal `linux_release` facade for web-host contract types or whether those types should move to a new platform-neutral module. Moving avoids a misleading module name but touches more callers.
2. Whether non-Linux canonical event/audit writing should use a regular-file fallback (without Unix ownership/mode/no-follow guarantees) or be disabled explicitly; current event writer already soft-fails during `AppState::new`.
3. Whether `AgentActivity` on Windows should remain configurable but permanently unavailable (recommended fail-closed behavior) or be rejected during config validation. The former preserves config/API compatibility and makes status explain the limitation.
4. Whether to implement a true Windows named-pipe/credentialed helper in a later feature. This inventory does not propose one; the safe current behavior is no helper and no suspend attempt.


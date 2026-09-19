---
title: "Windows compilation gates for dam-hopper-server"
description: "Add Linux-only compilation boundaries and fail-closed Windows fallbacks without changing Linux release or idle-suspend behavior."
status: completed
priority: P1
effort: 10h
branch: main
tags: [bugfix, backend, rust, windows, linux, cfg, idle-suspend]
created: 2026-09-19
---

# Windows build fix

## Overview

Make `server` compile and start on `x86_64-pc-windows-msvc` while preserving the existing Linux implementation byte-for-byte in behavior. The fix is a target boundary, not a Windows implementation of systemd, procfs, netlink, Unix sockets, UID/GID checks, or release deployment.

Primary inputs:

- [Windows compiler diagnosis](../reports/debugger-260919-2248-windows-build-errors.md): 180 errors, concentrated in `linux_release` (131) and `idle_suspend` (49).
- [Codebase/scout inventory](../reports/scout-260919-2248-windows-codebase-locations.md): callers, exports, test gates, and platform-sensitive symbols.
- Existing architecture sections in [`docs/system-architecture.md`](../../docs/system-architecture.md): server-authoritative idle suspend, Linux systemd helper boundary, activity sampler/ticket invariants, and diagnostics evidence rules.

## Contract and non-goals

### Required Windows behavior

- `dam-hopper-server` library and server binary compile and start.
- `web_host` keeps release-version/origin validation and `HostPublicConfig`/`TargetRole` JSON contracts.
- Idle-suspend policy, timing persistence, status, and API routes remain available.
- `AgentActivity` remains a valid stored/configured policy, but its measurement is `Unavailable` with a stable unsupported reason; it never mints a claim ticket.
- Force suspend reports the existing capability-unavailable/fail-closed result; it never attempts host suspend.
- `dam-hopper` and `dam-hopper-idle-suspend-helper` compile as informative non-Linux stubs and exit non-zero.

### Linux invariants

- Every Linux release-manager module and Linux activity backend remains selected only by `target_os = "linux"` and otherwise unchanged.
- Linux keeps `/proc`, netlink, systemd, Unix-socket, EUID/GID/mode, `flock`, descriptor, atomic-exchange, and helper credential behavior.
- Linux-only tests retain their current assertions; do not weaken them to make Windows pass.
- Existing API/protocol/serde field names, enum values, reason codes, sequence rules, and coordinator admission fences do not change.

### Explicit non-goals

- No Windows equivalent for systemd release deployment, RTC wake, `systemctl suspend`, netlink socket diagnostics, procfs process attribution, or privileged named-pipe helper.
- No new `windows-sys` activity implementation.
- No move of shared release contracts to a new `models` module in this fix.
- No Cargo feature that silently omits a declared binary; stubs are intentional for discoverability.

## Architecture decision

### Selected approach: Linux module plus non-Linux contract facade (Approach A)

`server/src/lib.rs` selects the complete existing release manager only on Linux and selects a new small facade on all other targets:

```rust
#[cfg(target_os = "linux")]
pub mod linux_release;
#[cfg(not(target_os = "linux"))]
#[path = "linux_release_non_linux.rs"]
pub mod linux_release;
```

`linux_release_non_linux.rs` exposes only the contracts consumed by `web_host` (portable validators, error type, `HostPublicConfig`, and `TargetRole`). It must not re-export deployment verbs as fake successes. The facade reuses the existing portable `error.rs`, `version.rs`, and `origin.rs` via `#[path]`; it defines the minimal DTO/role portions whose current files also import Unix deployment I/O. This keeps Linux files untouched and avoids compiling 21 Linux-only files on Windows.

The idle-suspend module remains present on every target so configuration, status, protocol, coordinator, audit DTOs, and API routes continue to compile. Its Linux transports are selected internally:

```text
Linux:
  coordinator -> ActivitySampler -> LinuxProcSource + LinuxSocketDiagnostics
              -> SystemdIdleSuspendExecutor -> Unix helper socket
              -> Linux helper binary -> systemd/logind/RTC

Non-Linux:
  coordinator -> UnavailableSampler result (UnsupportedTransport, no ticket)
              -> UnavailableExecutor (capability false, UnsupportedCapability)
  helper binary -> informative exit(1); no listener, peer credentials, or systemd
```

For event identity, Linux continues reading `/proc/sys/kernel/random/boot_id`. Non-Linux `ProducerIdentity::load` generates two UUID v4 values in memory (an ephemeral boot boundary plus process instance) and never probes `/proc`; the existing non-Unix regular-file append branch is used. This preserves event schema validity while making the loss of a host-stable boot ID explicit and conservative.

### Rejected alternatives

| Alternative | Decision | Reason |
|---|---|---|
| Add Windows branches throughout all 21 `linux_release` files | Reject | Large diff, repeated unsafe stubs, high risk of changing Linux security/transaction behavior. |
| Remove `linux_release` from non-Linux builds | Reject | Breaks `web_host` validators and DTO imports. |
| Implement Windows netlink/procfs substitutes now | Reject | Not required to compile; creates a new activity/security product surface. |
| Exclude binaries in Cargo config | Reject | Hides commands and weakens operator feedback; explicit stubs meet the requested contract. |
| Use fake `PeerCredentials::new(0, 0, 0)` on Windows | Reject | Could make a production helper appear enrolled; helper is stubbed instead. |

## Phase order and dependencies

| Phase | Deliverable | Depends on | Estimate |
|---|---|---|---:|
| 0 | Contract freeze, target matrix, baseline evidence | Reports | 45m |
| 1 | `linux_release` target boundary and non-Linux facade | 0 | 1h 45m |
| 2 | Linux release/helper binary stubs | 1 | 45m |
| 3 | Linux activity modules and Windows unavailable sampler | 1 | 2h 30m |
| 4 | Audit, helper IPC, identity, executor selection, server startup | 3 | 1h 45m |
| 5 | Target-aware tests and Windows behavior checks | 1–4 | 1h 30m |
| 6 | Windows qualification plus Linux regression gate | 5 | 1h 40m |

## Phase 0 — Freeze contracts and map the change

1. Re-read both primary reports and confirm the compiler target is `x86_64-pc-windows-msvc`.
2. Record the current Windows failure as the pre-change baseline (`cargo check --all-targets` fails in the library before tests/binaries can be qualified).
3. Freeze the following source-compatible contracts before editing:
   - `crate::linux_release::version::{validate_version, validate_release_tag, validate_commit_sha, validate_sha256_hex}`.
   - `crate::linux_release::origin::{validate_web_origin, validate_web_origins}`.
   - `crate::linux_release::host_config::HostPublicConfig` fields, `#[serde(rename_all = "camelCase", deny_unknown_fields)]`, and `HostPublicConfig::new` validation.
   - `crate::linux_release::TargetRole` variants (`Server`, `Web`, `Both`), serde lowercase encoding, `as_str`, `Display`, `matches`, `includes_server`, and `includes_web`.
   - Idle-suspend public DTOs/protocol/error strings and status reason mapping.
4. Do not begin with broad `#[cfg(unix)]` replacements. Use `target_os = "linux"` for systemd/release/activity selection; use `unix` only for reusable Unix security/transport branches.
5. Implementation gate: after each phase, run only the scoped target check needed for that phase; defer project-wide build/test to Phase 6.

## Phase 1 — `linux_release` library boundary and facade

### Files and symbols

#### Modify `server/src/lib.rs`

- Replace unconditional `pub mod linux_release;` with the two target-specific declarations shown above.
- Keep `pub mod idle_suspend;` unconditional.
- Leave `probe_inotify_limit`’s existing Linux-gated body unchanged.

#### Create `server/src/linux_release_non_linux.rs`

Implement a deliberately minimal public facade:

1. Reuse portable source modules without compiling their Linux siblings:
   - `#[path = "linux_release/error.rs"] pub mod error;`
   - `#[path = "linux_release/version.rs"] pub mod version;`
   - `#[path = "linux_release/origin.rs"] pub mod origin;`
2. Define `pub mod inventory` containing the exact `TargetRole` enum and methods from `linux_release/inventory.rs`; retain serde `lowercase` and `clap::ValueEnum` derives.
3. Define `pub mod host_config` containing the exact public `HostPublicConfig` fields/derives and `HostPublicConfig::new` validation from `linux_release/host_config.rs`:
   - schema version remains `1`;
   - validate all allowed origins and optional API origin;
   - validate stable release version with `validate_version`;
   - require UUID v4 `profile_id`;
   - preserve `camelCase` JSON and unknown-field rejection.
4. Re-export `ReleaseError`, `TargetRole`, `HostPublicConfig`, all four version validators, and both origin validators at the same root paths used by existing callers.
5. Do not define/re-export `Layout`, `Cli`, `Commands`, `ReleaseRecord`, `systemctl_*`, staging/activation/recovery/diagnostics APIs, UID/privilege APIs, or file-I/O loaders. Those callers are Linux-only binaries/modules.
6. Add facade-only tests for role serialization and `HostPublicConfig::new` acceptance/rejection; keep the existing `web_host/runtime_config.rs` fixture as an end-to-end contract test.

### Invariants and review points

- `server/src/web_host/mod.rs` and `server/src/web_host/runtime_config.rs` require no import rewrite; their existing `crate::linux_release::version`, `origin`, `host_config`, and root `TargetRole` paths must resolve on Windows.
- Full Linux `server/src/linux_release/mod.rs` stays unchanged and continues exporting every deployment API on Linux.
- Because the full Linux module is absent on non-Linux, its Linux tests and diagnostics tests are naturally not compiled there; do not add fake Linux APIs merely to satisfy tests that should be target-gated.

## Phase 2 — Explicit non-Linux binary behavior

### Modify `server/src/bin/dam-hopper.rs`

- Add `#[cfg(target_os = "linux")]` to every current Linux-only `use` group, the `#[tokio::main] async fn main() -> ExitCode`, and `persist_service_user_selection`.
- Preserve all current Linux command dispatch, privilege checks, `verify_host_platform` calls, release staging, activation, rollback, and diagnostics behavior unchanged.
- Add a non-Linux `fn main() -> ExitCode` that prints a stable message such as `dam-hopper release management is only supported on Linux with systemd` and returns `ExitCode::from(1)`.
- Do not parse commands or call any facade release function on Windows.

### Modify `server/src/bin/dam-hopper-idle-suspend-helper.rs`

- Add `#[cfg(target_os = "linux")]` to the current imports, `Cli`, and async Linux main.
- Preserve Linux UnixListener bind, Unix signal handling, permissions, `PeerCredentials::from_unix_stream`, `HelperServer`, `SysfsPreflightChecker`, `SystemdLogindBackend`, and `HelperAudit` flow unchanged.
- Add a non-Linux `fn main()` that emits `dam-hopper-idle-suspend-helper is only supported on Linux with systemd` and exits with status 1.
- Ensure the Windows branch never compiles `tokio::net::UnixListener`, `tokio::signal::unix`, or the current fake non-Linux peer-credential branch.

No Cargo binary is removed. No non-Linux process may claim to provide release management or privileged suspend.

## Phase 3 — Linux activity backends and fail-closed sampler

### Module declarations (`server/src/idle_suspend/activity/mod.rs`)

- Gate `pub(crate) mod process;`, `mod netlink;`, and `pub(crate) mod tcp;` with `#[cfg(target_os = "linux")]`.
- Keep `sampler` unconditional because coordinator types and the fallback are required on Windows.
- Keep `tcp_info` unconditional only if its pure byte-parser tests remain useful; otherwise gate it with netlink/tcp. It contains no platform imports, so retaining it is the lower-churn choice.
- Leave shared types (`NetworkNamespaceIdentity`, `OwnedSocketSet`, `ProcessSample`, `ActivityUnavailableReason`, `ActivityObservationReason` mapping inputs, and failure context) available on all targets. The existing non-Linux `NetworkNamespaceIdentity::current_thread` must continue returning `ProcAccess`.

### Linux-only files

`server/src/idle_suspend/activity/process.rs`, `netlink.rs`, and `tcp.rs` must not be modified for behavior. Their `MetadataExt`, `/proc`, netlink UAPI, raw socket, `tcp_info`, and Linux tests disappear from non-Linux compilation through the module gates. Preserve all Linux tests and real-kernel checks.

### Modify `server/src/idle_suspend/activity/sampler.rs`

Keep the request/result contract and all observation/ticket structs unconditional, then split implementation by target:

#### Linux branch

- Gate imports of `LinuxProcSource`, `ProcessDiscovery`, `ProcessSource`, `LinuxSocketDiagnostics`, `TcpObserver`, and `SocketDiagnosticsSource` with `#[cfg(target_os = "linux")]`.
- Gate `Worker<P, T>`, its implementation, the Linux `ActivitySampler` fields (`SharedState`, join handle), `ActivitySampler::with_sources`, and the existing Linux `ActivitySampler::new` wiring.
- Preserve coalescing, cancellation, transactional baselines, output fences, ticket admission, deadlines, retries, and shutdown/join semantics exactly.

#### Non-Linux branch

- Keep the same `ActivitySampler::new(Arc<PtySessionManager>, Arc<AgentExecutableSet>, mpsc::Sender<ActivitySamplerResult>)` signature so `coordinator.rs` remains unchanged.
- Store the manager, result sender, and a bounded observation sequence; do not spawn a process or socket worker.
- Implement `try_send_scheduled`, `send_final`, and `send_recovery` by sending an `ActivitySamplerResult` immediately (or returning `false` when the channel is full) with:
  - `measurement_state = ActivityMeasurementState::Unavailable`;
  - `reason = Some(ActivityObservationReason::UnsupportedTransport)`;
  - `failure_reason = Some(ActivityUnavailableReason::UnsupportedTransport)`;
  - `delta = ActivityDelta::Unchanged`;
  - current fleet/input revisions from `PtySessionManager::capture_activity_snapshot()`;
  - no recognized/monitored counts, no failure ticket, empty output fences, and `ticket = None`.
- `cancel_current` and `shutdown_and_join` are no-ops on the fallback; `Drop` must not wait on a nonexistent worker.
- Do not mint an `ActivityClaimTicket`, report `Available`, or convert unsupported transport into genuine activity.
- Keep `ActivitySampler::with_sources` Linux-only; all tests constructing mock proc/socket sources must be target-gated.

This preserves coordinator/API behavior: `AgentActivity` remains visible/configurable, but the status transitions from initializing/reconciling to unavailable with a stable unsupported warning and cannot reach automatic handoff.

## Phase 4 — Idle-suspend audit, IPC, identity, and startup executor

### Modify `server/src/idle_suspend/server_audit.rs`

- Move `std::os::unix::fs::{MetadataExt, OpenOptionsExt}` behind `#[cfg(unix)]`.
- Split `IdleSuspendServerAudit::open_verified`:
  - Unix branch remains exact: `O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK`, regular-file check, effective UID/GID match, and exact `0600` mode.
  - Non-Unix branch uses ordinary `OpenOptions` (`read`, plus `write().append(true)` when requested), opens the pre-provisioned path without Unix flags, and checks only `metadata.file_type().is_file()`; no UID/GID/mode methods.
- Keep the no-create/pre-provisioned audit contract. Do not silently create or repair a Windows audit file. Keep record serialization, locking, sync, and read limits unchanged.

### Modify `server/src/idle_suspend/helper_client.rs`

- Keep `HelperClient` storage, path inspection, and public method signatures unchanged.
- In `check_capability` and `execute_suspend`, place current `tokio::net::UnixStream` frame exchange under `#[cfg(unix)]`.
- Add `#[cfg(not(unix))]` branches returning `ProtocolError::IoError(std::io::Error::new(ErrorKind::Unsupported, ...))` with a stable Unix-domain-socket-unavailable message.
- Do not emulate Unix sockets with TCP, named pipes, or a fake success response. Production Windows startup will not construct this client through `main.rs`.

### Modify `server/src/idle_suspend/event.rs`

- Keep `ProducerIdentity::load_from_path` and its deterministic validation behavior for fixtures.
- Split `ProducerIdentity::load`:
  - Linux: current `/proc/sys/kernel/random/boot_id` path and hardened loader.
  - Non-Linux: generate canonical UUID v4 `boot_id` and `producer_instance_id` in memory; never open `/proc`.
- Keep `IdleSuspendEventWriter::append_and_sync_verified`’s existing Unix security branch and non-Unix regular-file append/sync branch.
- Document that non-Linux boot ID is process-lifetime/ephemeral, not a Windows host boot identity; event schema and UUID validation remain unchanged.

### Modify `server/src/main.rs`

Replace only the executor construction at current lines 369–384 with two target branches sharing the existing trait object type:

```rust
#[cfg(target_os = "linux")]
let idle_suspend_executor: Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor> = {
    let socket_path = std::env::var("DAM_HOPPER_IDLE_SUSPEND_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/run/dam-hopper/idle-suspend.sock"));
    tracing::info!(socket = %socket_path.display(), socket_exists = socket_path.exists(),
        "Enrolling SystemdIdleSuspendExecutor with privileged helper socket");
    Arc::new(dam_hopper_server::idle_suspend::SystemdIdleSuspendExecutor::new(&socket_path))
};

#[cfg(not(target_os = "linux"))]
let idle_suspend_executor: Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor> =
    Arc::new(dam_hopper_server::idle_suspend::UnavailableExecutor::new(
        "Idle suspend helper and systemd suspend are only supported on Linux",
    ));
```

Keep `state.start_idle_suspend_coordinator`, `proc_poll_loop` (its existing non-Linux no-op), API routes, shutdown, token handling, and all unrelated startup logic unchanged. The Windows server must still expose status/timing routes; only execution capability is unavailable.

### Leave unchanged unless the scoped check proves otherwise

- `executor.rs`: retain `UnavailableExecutor`, `SystemdIdleSuspendExecutor`, and public re-exports. The Linux executor remains selected only on Linux; the helper client’s non-Unix branch makes accidental construction compile-safe and fail closed.
- `backend.rs`, `preflight.rs`, `audit.rs`, `peer_auth.rs`, and generic `helper_server.rs`: their protocol/fake abstractions are portable and do not need broad gates. The real helper binary is already gated, so Windows never binds a listener or uses fake production credentials.

## Phase 5 — Tests and target-specific compilation

### Unit tests under `server/src`

1. `server/src/idle_suspend/tests.rs`:
   - Put the top-level `OpenOptionsExt` import behind `#[cfg(unix)]`.
   - Make `preprovisioned_server_audit` set mode only on Unix; use ordinary `create_new + write` on Windows.
   - Keep config, policy, protocol framing, fake executor, fake preflight, DTO, event serde, and generic coordinator tests cross-platform.
   - Gate tests that require `UnixListener`, `UnixStream`, Unix peer credentials, systemd/logind execution, FIFO, Unix symlink, `MetadataExt`, `PermissionsExt`, or mode mutation with `#[cfg(target_os = "linux")]` or `#[cfg(unix)]` according to the actual contract. This includes helper IPC tests around `test_helper_server_client_*`, malformed/audit-failure socket tests, indefinite/busy/RTC helper tests, and the Linux `AgentActivity` tests that import `process::tests::MockProcessSource`/`tcp::tests::FakeDiagnosticsSource` (functions around lines 2940–3389 and 4597 onward).
   - Keep event writer/coordinator tests portable by making `setup_trusted_diagnostics_dir` apply `0700` only on Unix; gate only exact mode/symlink/security and sequence-gap-by-permission tests. Add a Windows event writer test that proves append/sequence/serde behavior without asserting Unix modes.
   - Add a Windows-only server-audit test proving a pre-existing regular file can be appended/read without Unix metadata APIs.
2. `server/src/idle_suspend/activity/sampler.rs`:
   - Gate the existing mock proc/netlink sampler test module to Linux.
   - Add a non-Linux fallback test that sends one request and asserts `Unavailable`, `UnsupportedTransport`, and `ticket == None`.
3. `server/src/idle_suspend/event.rs`/`tests.rs`:
   - Add a non-Linux `ProducerIdentity::load` smoke assertion for canonical UUID v4 IDs and no `/proc` dependency.
   - Keep deterministic `load_from_path` validation tests on all targets.
4. `server/src/linux_release_non_linux.rs`:
   - Test exact role serde and `HostPublicConfig::new` validation; this protects the web-host facade that otherwise would be uncompiled on Linux.
5. `server/src/linux_release/diagnostics/phase06_tests.rs` and all other full release-manager tests remain Linux-only automatically because the full `linux_release` module is not declared on non-Linux. Do not weaken assertions.
6. Preserve existing Unix/Linux gates in `server/src/pty/tests.rs`, `server/src/pty/activity.rs`, and shell integration tests; no unrelated PTY behavior changes.

### Integration tests under `server/tests`

- Add `#![cfg(target_os = "linux")]` to integration crates that import full `dam_hopper_server::linux_release` modules or Linux diagnostics. At minimum:
  - `linux_release_unit_policy.rs`
  - `linux_release_manifest.rs`
  - `linux_release_manifest_errors.rs`
  - `linux_release_preflight_sqlite.rs`
  - `linux_release_state_machine.rs`
  - `linux_release_publisher_contract.rs`
  - `linux_release_staging.rs`
  - `linux_release_archive.rs`
  - `linux_release_format2_migration_exchange.rs`
  - `linux_release_format2_migration_drift.rs`
  - `linux_release_format2_migration_fixture.rs`
  - `linux_release_health.rs`
  - `linux_release_acquisition.rs`
  - `linux_release_cli.rs`
  - `linux_release_ownership.rs`
  - `linux_release_platform.rs`
  - `idle_suspend_diagnostics.rs` and its `idle_suspend_diagnostics/*` child modules
  - `idle_suspend_diagnostics_linux_smoke.rs`
- Keep `linux_release_web_host.rs` cross-platform. It is the integration proof that web-host behavior resolves through the non-Linux facade.
- Keep `idle_suspend.rs` and `idle_suspend_phase07.rs` cross-platform where their Unix permission/socket setup is already locally cfg-gated; adjust only any newly exposed unguarded imports, never remove Linux assertions.
- Keep unrelated test files unchanged; existing `#[cfg(unix)]` symlink/permission tests remain the pattern to follow.

## Phase 6 — Validation and acceptance gates

### Windows compile gate (required)

Run on the stated Windows 11 MSVC host, with the Windows target/toolchain available:

1. `cargo check --manifest-path server/Cargo.toml --target x86_64-pc-windows-msvc --all-targets`
   - Must compile library, server, web, release-manager stub, helper stub, and test targets.
   - Must show no unresolved `std::os::unix`, `libc` Linux symbol, netlink, procfs, or `tokio::net::UnixStream` errors.
2. `cargo build --manifest-path server/Cargo.toml --target x86_64-pc-windows-msvc --bins`.
3. `cargo test --manifest-path server/Cargo.toml --target x86_64-pc-windows-msvc -j 1`.
   - Unix/Linux-only tests are filtered at compile time, not weakened.
   - Portable config/protocol/web-host/fallback tests pass.
4. Run each stub binary and verify non-zero exit plus informative stderr:
   - `dam-hopper.exe`: Linux release manager/systemd unsupported.
   - `dam-hopper-idle-suspend-helper.exe`: Linux/systemd helper unsupported.
5. Launch `dam-hopper-server.exe` with a temporary config and query:
   - status endpoint remains reachable;
   - timing validation/persistence still works;
   - force suspend returns capability-unavailable/unsupported, with no Unix socket or host suspend attempt;
   - an `agent-activity` policy reports unavailable measurement with `unsupportedTransport` (or the chosen stable equivalent), no counts/ticket, and no automatic handoff.
6. Run `dam-hopper-web.exe`/web-host integration tests with runtime config fixture; version/origin validation and serialized `HostPublicConfig` behavior remain unchanged.

### Linux regression gate (required after Windows gate)

On Linux, run the repository’s normal server validation once after all changes:

- `cargo check --manifest-path server/Cargo.toml --all-targets`
- `cargo test --manifest-path server/Cargo.toml`
- Existing Linux release-manager, activity sampler/netlink, helper IPC, mode/ownership, event security, and diagnostics smoke suites.

Confirm Linux still selects `server/src/linux_release/mod.rs`, Linux activity sources, `SystemdIdleSuspendExecutor`, and the real helper binary. Compare Linux behavior against the pre-change test baseline; no test should be made conditional merely to hide a regression.

### Review checklist

- [x] Exactly one release module is compiled per target family.
- [x] Non-Linux facade exports every symbol used by `web_host` and no deployment API that could falsely succeed.
- [x] Windows server startup chooses `UnavailableExecutor` before any socket-path probing.
- [x] Windows activity fallback produces an unavailable observation and never a claim ticket.
- [x] No Windows code opens `/proc`, netlink, `/sys`, `systemctl`, Unix sockets, or Unix credential APIs.
- [x] Unix audit/event hardening remains identical.
- [x] Event identity on Windows is canonical and explicit about ephemeral boot identity.
- [x] Release/helper stubs exit non-zero with actionable messages.
- [x] All Linux tests remain runnable and assertions unchanged.
- [x] No unrelated Cargo, API, schema, config, or frontend changes.

## File modification manifest

### Create

- `server/src/linux_release_non_linux.rs` — non-Linux portable release-contract facade and facade tests.

### Modify

- `server/src/lib.rs` — target-select `linux_release` module.
- `server/src/bin/dam-hopper.rs` — Linux implementation gate and non-Linux exit stub.
- `server/src/bin/dam-hopper-idle-suspend-helper.rs` — Linux implementation gate and non-Linux exit stub.
- `server/src/idle_suspend/activity/mod.rs` — Linux gates for `process`, `netlink`, `tcp`; retain shared sampler/types.
- `server/src/idle_suspend/activity/sampler.rs` — Linux worker versus non-Linux unavailable result path.
- `server/src/idle_suspend/server_audit.rs` — Unix hardened open versus non-Unix regular-file open.
- `server/src/idle_suspend/helper_client.rs` — Unix socket methods versus unsupported non-Unix errors.
- `server/src/idle_suspend/event.rs` — target-specific producer identity loading.
- `server/src/main.rs` — Linux systemd executor versus non-Linux `UnavailableExecutor`.
- `server/src/idle_suspend/tests.rs` — target-aware imports, fixtures, and tests.
- `server/src/idle_suspend/activity/sampler.rs` tests — target split/fallback coverage.
- Linux-only `server/tests/*.rs` and `server/tests/idle_suspend_diagnostics/*.rs` listed in Phase 5 — crate-level target gates only; Linux test bodies unchanged.

### Intentionally unchanged

- All Linux release implementation files under `server/src/linux_release/`.
- `server/src/idle_suspend/coordinator.rs`, protocol/status/policy DTOs, API routes, and state wiring, except where compiler feedback proves a target annotation is necessary.
- `server/Cargo.toml` dependency list and binary declarations.
- Existing Linux service assets and deployment scripts.

## Rollback and failure handling

- Land/commit phases in order; Phase 1 is the reversible boundary. Reverting `lib.rs` plus deleting the facade restores the previous Linux-only module declaration without touching Linux files.
- If Windows compilation fails after the facade, first restore the facade export list and inspect the exact non-Linux caller; do not re-enable the full Linux module or add broad stubs to deployment files.
- If fallback runtime behavior is wrong, revert only the non-Linux sampler/main/audit branches; Linux cfg branches remain independently reviewable.
- If Linux tests regress, compare the pre/post Linux cfg expansion and restore the Linux branch verbatim. Never solve a Linux failure by broadening non-Linux gates or weakening security assertions.
- No data migration or rollback script is required. Existing Linux audit/event files, host config, release state, and service units are untouched.

## Unresolved questions / future work

No implementation blocker remains for the requested compile fix. Deferred choices are explicit:

1. A native Windows activity tracker (Toolhelp32/GetExtendedTcpTable) is future work; current Windows behavior is intentionally unavailable and fail-closed.
2. A native Windows privileged helper transport/RTC suspend integration is future work; no named-pipe or credential emulation is included.
3. Moving `HostPublicConfig`, `TargetRole`, validators, and `ReleaseError` to a neutral `models`/`contracts` module could remove the small facade duplication later, but is deliberately excluded to minimize Linux risk.
4. If product requirements later demand a stable Windows host boot ID, replace the ephemeral UUID branch with a reviewed Windows identity source and update event continuity tests; do not silently reinterpret the current UUID as a host boot guarantee.

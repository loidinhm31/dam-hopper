# Diagnostic Report: Windows Build Failures in `dam-hopper-server`

- **Date:** 2026-09-19
- **Target Crate:** `dam-hopper-server` (monorepo `server/`)
- **Host Environment:** Windows 11 Pro x64 (MSVC toolchain, `x86_64-pc-windows-msvc`)
- **Source Log:** `./logs.txt` (1,995 lines)
- **Status:** Failed compilation (`error: could not compile dam-hopper-server (lib) due to 180 previous errors; 7 warnings emitted`)

---

## 1. Executive Summary

- **Issue:** Attempting `cargo build` on Windows fails immediately during lib compilation with 180 rustc errors across 25 source files.
- **Scope & Impact:** Monorepo backend crate (`dam-hopper-server`) fails to build on Windows development hosts and Windows CI targets. Web and native apps consuming server binaries/libraries blocked on Windows.
- **Root Cause:** Zero compilation gates (`#[cfg(target_os = "linux")]` / `#[cfg(unix)]`) guard two Linux-native subsystems:
  1. `src/linux_release/` (131 errors, 21 files): Fedora 44 systemd deployment manager using POSIX syscalls (`openat`, `fstatat`, `renameat2`, `fchmod`, `fchown`), `flock`, and `std::os::unix`.
  2. `src/idle_suspend/` (49 errors, 4 files): Systemd RTC-wake coordinator using Linux Netlink (`NETLINK_SOCK_DIAG`), procfs (`/proc/<pid>/exe`, `/proc/<pid>/ns/net`), Unix domain sockets (`tokio::net::UnixStream`), and POSIX file permission invariants (`geteuid`, `getegid`, `0o600`).
- **Priority & Fix Strategy:**
  - **P0 (Immediate fix):** Add `#[cfg(target_os = "linux")]` / `#[cfg(not(target_os = "linux"))]` gates around Linux-only submodules and provide platform fallbacks/stubs so `dam-hopper-server` compiles cleanly on Windows without modifying any Linux behavior.
  - **P1 (Runtime safety):** Default `idle_suspend` coordinator on Windows to existing `UnavailableExecutor`, bypassing procfs/netlink/helper daemon.
  - **P2 (Architecture cleanup):** Decouple platform-agnostic configuration models (`HostPublicConfig`, `TargetRole`, `validate_version`, `validate_web_origin`) from the Linux systemd release orchestrator.

---

## 2. Technical Analysis

### 2.1 Error Distribution by Module

All 180 errors reside strictly within 2 top-level modules across 25 files:

| Module | Error Count | Percentage | Files Affected | Primary Failure Modes |
|---|---|---|---|---|
| `src/linux_release/` | 131 | 72.8% | 21 | Missing POSIX libc syscalls (`openat`, `fstatat`), `flock`, `std::os::unix` extension traits, mode/UID checks |
| `src/idle_suspend/` | 49 | 27.2% | 4 | Netlink UAPI constants, `/proc` metadata (`dev`/`ino`), Unix domain sockets, audit file POSIX flags |
| **Total** | **180** | **100%** | **25** | |

### 2.2 Error Distribution by Failure Category

| Category | Count | Description | Primary Manifestation |
|---|---|---|---|
| **Missing libc POSIX / Linux Symbols** | 82 | Symbols declared in Linux `libc` missing from Windows MSVCRT `libc` | `openat`, `fstatat`, `fchmod`, `fchown`, `flock`, `AF_NETLINK`, `O_NOFOLLOW`, `O_CLOEXEC`, `geteuid`, `getegid` |
| **Missing Unix Extension Traits (`std::os::unix`)** | 38 | Methods from `PermissionsExt`, `MetadataExt`, `OpenOptionsExt`, `DirBuilderExt` | `.mode()`, `.uid()`, `.gid()`, `.from_mode()`, `.custom_flags()` |
| **Unresolved `std::os::unix` Import** | 23 | Direct imports of `std::os::unix` (does not exist on Windows) | `cannot find unix in os` |
| **Type Mismatches from Windows ABI / libc** | 13 | Struct/integer discrepancies between Windows and Linux libc definitions | `libc::close(fd: c_int)` receiving `usize`; `st_mode` `u16 & i32`; signed/unsigned conversions |
| **Missing Inode/Device Tracking (`MetadataExt`)** | 11 | Linux filesystem identity checking via `dev()` and `ino()` | `meta.dev()`, `meta.ino()` missing on Windows `std::fs::Metadata` |
| **Missing Unix Domain Sockets in Tokio** | 2 | `tokio::net::UnixStream` missing on Windows | Connection to privileged helper daemon fails compile |
| **Other Platform-Specific Compiler Errors** | 11 | Direct Unix FD imports (`std::os::fd`), `OsStrExt::as_bytes`, `AsRawFd::as_raw_fd` | `std::os::fd::RawFd` missing, `OsStr::as_bytes()` missing |

---

### 2.3 Detailed Breakdown by File (All 25 Files)

| # | File Path | Module | Errors | Error Codes | Key Missing Symbols / Methods / Issues |
|---|---|---|---|---|---|
| 1 | `src/linux_release/api_runtime.rs` | `linux_release` | 48 | `E0277`, `E0308`, `E0425`, `E0432`, `E0433`, `E0531`, `E0599` | `std::os::unix`; `std::os::fd::RawFd`; `libc` (`openat`, `fstatat`, `mkdirat`, `fchmod`, `fchown`, `fsync`, `renameat2`, `unlinkat`, `O_DIRECTORY`, `O_NOFOLLOW`, `O_CLOEXEC`, `O_PATH`, `AT_SYMLINK_NOFOLLOW`, `AT_REMOVEDIR`, `S_IFLNK`); 10 type mismatches (`st_mode`, `st_uid`, `st_gid`); `OsStrExt::as_bytes` |
| 2 | `src/idle_suspend/activity/netlink.rs` | `idle_suspend` | 30 | `E0308`, `E0422`, `E0425` | `libc` (`AF_INET`, `AF_INET6`, `AF_NETLINK`, `AF_UNIX`, `IPPROTO_TCP`, `IPPROTO_UDP`, `SOCK_RAW`, `SOCK_CLOEXEC`, `SOCK_NONBLOCK`, `sockaddr_nl`, `socklen_t`, `poll`, `pollfd`, `recv`, `send`); 3 type mismatches (`libc::close(fd)` expected `i32`, found `usize`) |
| 3 | `src/linux_release/legacy_format2_root.rs` | `linux_release` | 13 | `E0433`, `E0599` | `std::os::unix::fs::MetadataExt`; missing `.mode()`, `.uid()` on `std::fs::Metadata` |
| 4 | `src/idle_suspend/server_audit.rs` | `idle_suspend` | 10 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::{MetadataExt, OpenOptionsExt}`; `libc` (`O_CLOEXEC`, `O_NOFOLLOW`, `O_NONBLOCK`, `geteuid`, `getegid`); missing `.custom_flags()`, `.uid()`, `.gid()`, `.mode()` |
| 5 | `src/linux_release/lock.rs` | `linux_release` | 9 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::OpenOptionsExt`; `std::os::unix::io::AsRawFd`; `libc` (`flock`, `LOCK_EX`, `LOCK_NB`, `LOCK_UN`); missing `.mode()`, `.as_raw_fd()` |
| 6 | `src/linux_release/migration.rs` | `linux_release` | 9 | `E0433`, `E0599` | `std::os::unix::fs::{MetadataExt, PermissionsExt}`; missing `.dev()` on `Metadata`; missing `from_mode()` on `Permissions` |
| 7 | `src/linux_release/stage_transaction.rs` | `linux_release` | 9 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::{MetadataExt, PermissionsExt, OpenOptionsExt}`; `libc::O_NOFOLLOW`; missing `.custom_flags()`, `from_mode()` |
| 8 | `src/linux_release/diagnostics/output.rs` | `linux_release` | 7 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt}`; `libc::O_NOFOLLOW`; missing `.mode()` on `DirBuilder` & `Permissions`, `.uid()` on `Metadata`, `.custom_flags()` on `OpenOptions` |
| 9 | `src/idle_suspend/activity/process.rs` | `idle_suspend` | 7 | `E0433`, `E0599` | `std::os::unix::fs::MetadataExt`; missing `.dev()`, `.ino()` on `std::fs::Metadata` |
| 10 | `src/linux_release/ownership.rs` | `linux_release` | 4 | `E0433`, `E0599` | `std::os::unix::fs::MetadataExt`; missing `.mode()`, `.uid()` |
| 11 | `src/linux_release/activate_preflight.rs` | `linux_release` | 3 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::OpenOptionsExt`; `libc::O_NOFOLLOW`; missing `.custom_flags()` |
| 12 | `src/linux_release/archive_extract.rs` | `linux_release` | 3 | `E0433`, `E0599` | `std::os::unix::fs::PermissionsExt`; missing `from_mode()` |
| 13 | `src/linux_release/host_config.rs` | `linux_release` | 3 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::OpenOptionsExt`; `libc::O_NOFOLLOW`; missing `.custom_flags()` |
| 14 | `src/linux_release/legacy_format2_unit.rs` | `linux_release` | 3 | `E0433`, `E0599` | `std::os::unix::fs::MetadataExt`; missing `.mode()`, `.uid()` |
| 15 | `src/linux_release/state.rs` | `linux_release` | 3 | `E0425`, `E0433`, `E0599` | `std::os::unix::fs::OpenOptionsExt`; `libc::O_NOFOLLOW`; missing `.custom_flags()` |
| 16 | `src/linux_release/systemd_backup.rs` | `linux_release` | 3 | `E0433`, `E0599` | `std::os::unix::fs::PermissionsExt`; missing `.mode()`, `from_mode()` |
| 17 | `src/linux_release/transaction.rs` | `linux_release` | 3 | `E0433`, `E0599` | `std::os::unix::fs::PermissionsExt`; missing `.mode()`, `from_mode()` |
| 18 | `src/linux_release/account.rs` | `linux_release` | 3 | `E0425` | `libc` (`getpwnam`, `getgrgid`, `getgrnam`) |
| 19 | `src/linux_release/legacy_format2_inspect.rs` | `linux_release` | 2 | `E0433`, `E0599` | `std::os::unix::fs::MetadataExt`; missing `.dev()` |
| 20 | `src/linux_release/stage_units.rs` | `linux_release` | 2 | `E0433`, `E0599` | `std::os::unix::fs::PermissionsExt`; missing `from_mode()` |
| 21 | `src/idle_suspend/helper_client.rs` | `idle_suspend` | 2 | `E0433` | `tokio::net::UnixStream` missing on Windows |
| 22 | `src/linux_release/rollback.rs` | `linux_release` | 1 | `E0433` | `std::os::unix::fs::PermissionsExt` missing |
| 23 | `src/linux_release/privilege.rs` | `linux_release` | 1 | `E0425` | `libc::geteuid` missing |
| 24 | `src/linux_release/systemd.rs` | `linux_release` | 1 | `E0425` | `libc::geteuid` missing |
| 25 | `src/linux_release/durable_fs.rs` | `linux_release` | 1 | `E0599` | `PermissionsExt::from_mode()` missing |

---

### 2.4 Deep Dive: Module Root Causes

#### A. `src/linux_release/` (131 Errors)
- **Design Context:** Written specifically to manage atomic self-updates, systemd service units, and rollback state for Fedora 44 Linux hosts. Relies on `/opt/dam-hopper/releases`, `/etc/dam-hopper`, `/var/lib/dam-hopper`, systemd unit files, and root EUID (0).
- **Core Incompatibilities:**
  1. Direct POSIX Syscalls in `api_runtime.rs`: Implements `RuntimeSyscalls` with `LinuxSyscalls` calling `libc::openat`, `libc::fstatat`, `libc::fchmod`, `libc::fchown`, `libc::renameat2`, `libc::mkdirat`. None of these exist on Windows (MSVCRT libc).
  2. Advisory File Locking in `lock.rs`: Uses `libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB)`. Windows does not support `flock` (requires Win32 `LockFileEx` or cross-platform crates like `fs2`/`fd-lock`).
  3. POSIX User/Group Database in `account.rs`, `privilege.rs`, `systemd.rs`: Queries `libc::getpwnam`, `libc::getgrnam`, `libc::getgrgid`, `libc::geteuid`. Windows does not have Unix UIDs/GIDs.
  4. Permission Modes in `archive_extract.rs`, `stage_transaction.rs`, `ownership.rs`: Calls `PermissionsExt::from_mode(0o755)` and tests `meta.mode() & 0o777`. Windows NTFS uses DACLs/security descriptors; `mode()` is Unix-only.
- **External Dependencies on `linux_release` across the Monorepo:**
  - `server/src/web_host/runtime_config.rs` & `server/src/web_host/mod.rs` import:
    - `crate::linux_release::version::validate_version` (Pure SemVer parsing, no OS dependency)
    - `crate::linux_release::origin::validate_web_origin` (Pure URL/string validation, no OS dependency)
    - `crate::linux_release::host_config::HostPublicConfig` (Pure serde data struct, no OS dependency)
    - `crate::linux_release::inventory::TargetRole` (Pure enum with serde, no OS dependency)
  - `server/src/bin/dam-hopper.rs` (CLI entry point) imports release management commands (`install`, `start`, `stop`, `rollback`, `recover`). Already guards commands with `verify_host_platform()`.

#### B. `src/idle_suspend/` (49 Errors)
- **Design Context:** Server-authoritative inactivity detection for headless servers. Shuts down/suspends the host via a privileged helper connecting to systemd-logind and sets an RTC wake alarm.
- **Core Incompatibilities:**
  1. Netlink Transport in `activity/netlink.rs` (30 errors): Opens `AF_NETLINK` / `SOCK_RAW` sockets to query kernel `NETLINK_SOCK_DIAG` for TCP byte traffic. Netlink is a Linux-only kernel socket protocol; completely non-existent on Windows.
  2. Linux `/proc` Traversal in `activity/process.rs` (7 errors): Reads `/proc/<pid>/cmdline`, `/proc/<pid>/exe`, and `/proc/<pid>/ns/net`. Uses `meta.dev()` and `meta.ino()` to track network namespace inode identities. Windows has no `/proc` filesystem and NTFS metadata has no POSIX inode numbers.
  3. Pre-provisioned Audit File Hardening in `server_audit.rs` (10 errors): Opens audit logs with `custom_flags(O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)` and checks `metadata.uid() == libc::geteuid()` and `metadata.mode() & 0o7777 == 0o600`. Fails on Windows because POSIX flags and UID methods do not exist.
  4. Helper IPC in `helper_client.rs` (2 errors): Connects to `/run/dam-hopper/idle-suspend.sock` using `tokio::net::UnixStream`. On Windows, `UnixStream` is not in `tokio::net` without specific Windows Unix socket configurations.
- **External Dependencies on `idle_suspend` across the Monorepo:**
  - `server/src/state.rs`: Stores `idle_suspend_policy`, `idle_suspend_timing`, `idle_suspend_store`, `idle_suspend_audit`, `idle_suspend_coordinator`.
  - `server/src/main.rs`: Launches `SystemdIdleSuspendExecutor` and starts the coordinator.
  - `server/src/api/idle_suspend.rs`: REST routes (`GET /status`, `PATCH /timing`, `POST /force-suspend`).
  - `server/src/bin/dam-hopper-idle-suspend-helper.rs`: Privileged helper daemon binary (Linux-only).

---

## 3. Actionable Recommendations

### 3.1 Strategy for `src/linux_release/`

To prevent breaking Linux deployments while enabling Windows compilation:

1. **Retain Platform-Agnostic Models at Module Root:**
   Keep the following submodules platform-unconditional since they contain zero OS-specific code:
   - `version.rs` (`validate_version`, `validate_release_tag`)
   - `origin.rs` (`validate_web_origin`, `validate_web_origins`)
   - `inventory.rs` (`TargetRole`, `ReleaseRole`, `EntryKind`)
   - In `host_config.rs`, separate data types (`HostConfig`, `HostPublicConfig`) from file I/O operations (`read_config_file`, `load_host_public_config`).
2. **Conditional Compilation Gates for Linux-Specific Submodules:**
   Gate Linux-specific submodules in `server/src/linux_release/mod.rs`:
   ```rust
   #[cfg(target_os = "linux")]
   pub mod account;
   #[cfg(target_os = "linux")]
   mod api_runtime;
   #[cfg(target_os = "linux")]
   pub mod activate;
   #[cfg(target_os = "linux")]
   pub mod lock;
   #[cfg(target_os = "linux")]
   pub mod migration;
   #[cfg(target_os = "linux")]
   pub mod stage_transaction;
   // ... other Linux-only modules
   ```
3. **Windows Stubs for Public API Contract:**
   For non-Linux targets (`#[cfg(not(target_os = "linux"))]`), provide clean stubs returning `ReleaseError`:
   ```rust
   #[cfg(not(target_os = "linux"))]
   pub fn verify_host_platform() -> Result<(), ReleaseError> {
       Err(ReleaseError::UnsupportedPlatform(
           "dam-hopper release management and systemd deployments are only supported on Linux".into(),
       ))
   }
   ```
4. **Binary Target Gate in `server/src/bin/dam-hopper.rs`:**
   In `dam-hopper.rs`, the CLI already checks `verify_host_platform()`. With the stub returning `UnsupportedPlatform`, the binary gracefully halts with an informative error on Windows.

---

### 3.2 Strategy for `src/idle_suspend/`

The idle suspend subsystem must continue providing configuration models and HTTP status responses to the frontend without crashing or failing compilation on Windows:

1. **`server_audit.rs` Cross-Platform File Opening:**
   In `IdleSuspendServerAudit::open_verified()`:
   - On Unix (`#[cfg(unix)]`): Keep current strict `O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK` and UID/GID/0600 verification.
   - On Windows (`#[cfg(not(unix))]`): Open standard file with `OpenOptions::new().read(true).write(true).append(true).open(&*self.path)` without POSIX flags or UID verification.
2. **`activity` Subsystem Platform Abstraction:**
   - Gate `netlink.rs` with `#[cfg(target_os = "linux")]`.
   - In `activity/sampler.rs` and `activity/process.rs`:
     - On Linux: Run full `LinuxProcSource` and `LinuxSocketDiagnostics`.
     - On non-Linux (`#[cfg(not(target_os = "linux"))]`): Provide a stub `UnavailableProcSource` and `UnavailableSocketDiagnostics` that return `ActivityUnavailable::new(ActivityUnavailableReason::ProcAccess)` or a new variant `UnsupportedPlatform`.
     - `IdleSuspendCoordinator` already handles `ActivityObservation::Unavailable` cleanly without panicking.
3. **`helper_client.rs` & `executor.rs`:**
   - In `helper_client.rs`: Gate `tokio::net::UnixStream` with `#[cfg(unix)]`. On Windows, `HelperClient` methods return `ProtocolError::IoError(io::Error::new(ErrorKind::Unsupported, "Unix domain sockets unavailable on Windows"))`.
   - In `server/src/main.rs`:
     ```rust
     #[cfg(target_os = "linux")]
     let idle_suspend_executor: Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor> = {
         let socket_path = ...;
         Arc::new(dam_hopper_server::idle_suspend::SystemdIdleSuspendExecutor::new(&socket_path))
     };
     #[cfg(not(target_os = "linux"))]
     let idle_suspend_executor: Arc<dyn dam_hopper_server::idle_suspend::IdleSuspendExecutor> = {
         Arc::new(dam_hopper_server::idle_suspend::UnavailableExecutor::new(
             "Terminal idle-suspend helper daemon is only supported on Linux systemd hosts"
         ))
     };
     ```
4. **Helper Binary `src/bin/dam-hopper-idle-suspend-helper.rs`:**
   - Add a top-level gate or main-body gate:
     ```rust
     #[cfg(not(target_os = "linux"))]
     fn main() -> anyhow::Result<()> {
         eprintln!("dam-hopper-idle-suspend-helper is only supported on Linux with systemd.");
         std::process::exit(1);
     }
     ```

---

### 3.3 Target Configuration Summary

```
Target OS Gates Matrix:
├── Linux (target_os = "linux")
│   ├── src/linux_release/        -> Full systemd release orchestrator (production)
│   ├── src/idle_suspend/netlink  -> Direct NETLINK_SOCK_DIAG socket dumps
│   ├── src/idle_suspend/process  -> Full /procfs traversal and namespace tracking
│   ├── src/idle_suspend/audit    -> 0600 UID/GID verified audit logs
│   └── helper daemon bin         -> Operational privileged systemd daemon
└── Windows (target_os = "windows")
    ├── src/linux_release/        -> Metadata models (HostPublicConfig, TargetRole) + stubbed verbs
    ├── src/idle_suspend/netlink  -> Omitted (stubbed sampler returns Unavailable)
    ├── src/idle_suspend/process  -> Omitted / stubbed
    ├── src/idle_suspend/audit    -> Standard File open without POSIX flags
    ├── src/idle_suspend/executor -> UnavailableExecutor (fails closed, reports unsupported)
    └── helper daemon bin         -> Clean exit stub with descriptive error
```

---

## 4. Unresolved Questions

1. Should the CLI binary `dam-hopper` be excluded completely from Windows release builds in CI via Cargo profile / target configuration, or should it remain a stub binary informing the user that release commands require Linux?
2. Does Windows require a future native background activity tracker (e.g. using `GetExtendedTcpTable` via `windows-sys` and Toolhelp32 process snapshots), or will Windows hosts strictly run DamHopper in local desktop mode where idle host suspension is disabled by design?
3. Should platform-agnostic models (`HostPublicConfig`, `TargetRole`, `validate_version`, `validate_web_origin`) be migrated to a dedicated `server/src/models/` or `server/src/config/` module in a future refactoring to avoid importing from `linux_release` on non-Linux platforms?

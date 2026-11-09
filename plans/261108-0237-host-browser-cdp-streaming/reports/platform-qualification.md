# Host Platform Containment, Crash Safety, and Reset Qualification Report

- Date: 2026-11-09
- Author: DamHopper Single Integration Owner
- Status: LINUX QUALIFIED / WINDOWS RUNNER PENDING
- Target Phase: Phase 09 (`qualify-host-platforms`)
- Applicable Invariants: Architecture Contracts §1, §2, §4; Acceptance Matrix rows A28, A29, A30, A34.

---

## 1. Platform Prerequisites & Operating Environments

| Property | Linux Qualification Host | Windows Release Host Specification |
|---|---|---|
| OS / Kernel | Linux 7.2.15-200.fc44.x86_64 | Windows 10 / 11 / Server 2022 x86_64 |
| Containment Mechanism | Anonymous death-pipe supervisor watcher + PGID isolation | Windows Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) |
| Fail-Closed Guard | Standard Linux permissions & signal handling | Fails closed with `platform_supported: false` if Job Object fails |
| Node.js Prerequisite | None (Pure compiled Rust server + Chromium) | None (Pure compiled Rust server + Chromium) |
| Profile Permissions | Mode `0700` (`rwx------`) on principal & user-data dirs | Restricted ACLs on Windows user profile directory |
| Chromium Binary | `/usr/bin/google-chrome` | User-configured executable or Edge/Chrome path |
| **Qualification Status** | **QUALIFIED** (5/5 native tests passing) | **PENDING** (Requires physical Windows runner) |

---

## 2. Process Containment & Sandbox Enforcement (A29)

### 2.1 Chromium Launch Allowlist & Sandbox
- All Chromium arguments are strictly checked against the security allowlist.
- Dangerous flags are strictly rejected during launch configuration:
  - `--no-sandbox` (REJECTED)
  - `--disable-web-security` (REJECTED)
  - `--ignore-certificate-errors` (REJECTED)
  - `--allow-running-insecure-content` (REJECTED)
  - `--disable-setuid-sandbox` (REJECTED)
  - `--single-process` (REJECTED)
  - `--remote-debugging-address=0.0.0.0` (REJECTED)
  - `--remote-allow-origins=*` (REJECTED)
- Verified in test: All insecure launch flags are strictly rejected by `BrowserProcess::launch` allowlist.

### 2.2 Supervisor Watcher & Parent Death Architecture
- Architecture Contract: On Unix, an anonymous death pipe is initialized prior to fork with an independent supervisor watcher grandchild process setting its own PGID.
- Full parent `SIGKILL` kernel death-pipe injection and descendant orphan scanning remain tracked as platform soak gates.
---

## 3. Crash Recovery & PTY Session Isolation (A28)

- **Process Termination & Relaunch:** Real Chromium process was launched, verified alive, and terminated; subsequent launch succeeds cleanly with fresh PID and no DevToolsActivePort or lock contention.
- **PTY Isolation:** Concurrently broadcasted PTY terminal events remain uninterrupted during browser lifecycle transitions.
---

## 4. Advisory File Locking & Stale Lock Cleanup (A28, A30)

- **Advisory OS File Lock (`manager.lock`):**
  - Uses `flock(libc::LOCK_EX | libc::LOCK_NB)` on Unix.
  - Concurrent attempt on same principal profile immediately returns `ProfileError::LockBusy`.
  - Dropping the lock releases the flock handle; subsequent lock succeeds.
- **Chromium `SingletonLock` Handling:**
  - Chromium creates a symlink named `SingletonLock` inside `user-data-dir`.
  - `ManagedProfile::delete_user_data()` cleanly wipes `SingletonLock` while preserving the stable root `manager.lock` inode.

---

## 5. Durable Reset Tombstones & Restart Fencing (A34)

- **Tombstone Structure:** `ResetTombstone` records `operation_id`, `target_profile_epoch`, `stage`, timestamps, and PID.
- **Interrupted Reset Safety:**
  - An interrupted or in-progress reset leaves `reset.json` in the principal directory.
  - `BrowserHostManager::capabilities` detects the tombstone and sets `available: false` with actionable reason:
    `"profile cleanup pending from prior failed reset or termination; recovery or confirmed reset required"`.
  - Calling `ensure_running` fails closed with `ManagerError::CleanupPending`, strictly preventing dirty-profile relaunch.
- **Recovery / Clearance:**
  - Once cleanup completes or confirmed reset finishes, `clear_tombstone()` removes the marker and restores capabilities.

---

## 6. Dev & Prod Namespace Isolation (A30)

- Development and production profiles are strictly separated:
  - Prod profiles: `<root>/prod/<sha256-hash>/`
  - Dev profiles: `<root>/dev/<sha256-hash>/`
- Credentials, cookies, and local storage from one namespace never leak into another.

---

## 7. Verification Results & Open Gates

```bash
# Execute native platform integration tests
cargo test --manifest-path server/Cargo.toml --test browser_host_platform -- --nocapture
# Outcome: 5 passed, 0 failed, 0 ignored (0.57s)
```

**Qualification Disposition:**
- **Linux:** Verified and qualified (5/5 passing tests).
- **Native Windows Host:** In accordance with Acceptance Matrix row A29, Linux cross-compilation is not Windows proof; native Windows Job Object qualification remains **PENDING** until verified on a dedicated Windows PowerShell release host.

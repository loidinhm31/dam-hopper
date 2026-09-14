# Code Review: Phase 03 — Preflight SQLite discovery, installer/reset scripts, and smoke tests

Date: 2026-09-14
Reviewer: Phase03Reviewer
Target: System daemon state configuration migration — Phase 03
Plan: `plans/260914-0854-system-daemon-state-config/phase-03-preflight-installer-reset-and-smoke-tests.md`

---

## Code Review Summary

### Scope
- Reviewed files:
  - `server/src/linux_release/activate_preflight.rs`
  - `server/tests/linux_release_preflight_sqlite.rs`
  - `deploy/release/dam-hopper-install.sh`
  - `deploy/reset-linux-production.sh`
  - `tests/deploy/linux-release-clean-install.sh`
  - `tests/deploy/linux-release-security.sh`
- Lines of code analyzed: ~650 lines across Rust, Bash, and Python
- Review focus: Phase 03 SQLite discovery, installer cleanup, reset script hardening, test qualification, security, performance, YAGNI/KISS/DRY.
- Updated plans: `plans/260914-0854-system-daemon-state-config/phase-03-preflight-installer-reset-and-smoke-tests.md`

### Score
**9/10** (Solid, safe, conformant implementation; minor edge-case recommendations noted below)

---

### Overall Assessment
The Phase 03 changes strictly satisfy the contract and architectural constraints:
1. **Zero-Mutation Read-Only Discovery:** Preflight SQLite discovery is strictly read-only, bounds reads to 64 KiB, enforces `O_NOFOLLOW` and `fstat` regular file checks, rejects unsupported `~user` forms, and correctly gates on `candidate.role.includes_server()`.
2. **Proper Precedence & Deduplication:** Checks canonical `/var/lib/dam-hopper/dam-hopper.toml` first, legacy `/etc/dam-hopper/dam-hopper.toml` second, falls back to canonical default `/var/lib/dam-hopper/.config/dam-hopper/sessions.db` if neither exists, retains legacy fallback `/etc/dam-hopper/sessions.db`, and stably deduplicates after normalization.
3. **Fail-Closed Unsafe State:** Symlinks, directories, oversized files, invalid UTF-8, and invalid TOML are fatal errors and never silently skipped.
4. **Installer Clean Cutover:** Installer deleted the legacy `/etc/dam-hopper/dam-hopper.toml` creation and chmod blocks without introducing premature `/var/lib` replacements.
5. **Atomic Identity-Preserving Reset:** Reset script drops root privileges to the exact parsed API User/Group before creating a temporary file and atomically renaming it (`os.replace` + directory `fsync`), ensuring the resulting file maintains `0600` API user ownership without `sed -i` root takeover.

---

### Critical Issues
*None.*

---

### Warnings

1. **Silent Fallback on Non-String `server.session_db_path` in Preflight**
   - **Location:** `server/src/linux_release/activate_preflight.rs:112-117`
   - **Problem:** If `server.session_db_path` is present in TOML but not a string (e.g. integer `123`, boolean `false`, or list), `.and_then(|path| path.as_str())` returns `None`, causing `.unwrap_or(DEFAULT_SESSION_DB_PATH)` to silently fall back to `~/.config/dam-hopper/sessions.db` instead of raising a configuration error.
   - **Impact:** Malformed TOML key passes preflight holder discovery without error, only to crash later when the server deserializes `ServerConfig`.
   - **Fix Recommendation:** Explicitly match `toml::Value::String` and return `ReleaseError::Config` if the key exists but is not a string.

2. **Stale Release Artifact in `artifacts/final/`**
   - **Location:** `artifacts/final/dam-hopper-install.sh`
   - **Problem:** `artifacts/final/dam-hopper-install.sh` still retains the old `/etc/dam-hopper/dam-hopper.toml` creation and permission lines because packaging hasn't been re-run.
   - **Impact:** While `deploy/release/dam-hopper-install.sh` (source of truth) is clean, any test or user consuming `artifacts/final/` directly would run obsolete provisioning.
   - **Fix Recommendation:** Re-run release packaging flow (`pnpm release:package-twice`) to regenerate checked-in artifacts once all phase changes land.

---

### Suggestions

1. **Resource Cleanup in Reset Script Python Helper**
   - **Location:** `deploy/reset-linux-production.sh:212-228`
   - **Recommendation:** Place `dir_fd` and `temp_fd` operations inside structured `try...finally` blocks or context managers so file descriptors are explicitly closed on any mid-write exception before process exit.

2. **Add `--api-unit` Flag to Reset Script CLI**
   - **Location:** `deploy/reset-linux-production.sh:28-46`
   - **Recommendation:** Expose `--api-unit <path>` in the argument parser alongside the existing `DAM_HOPPER_API_UNIT` environment variable to assist operators in non-standard test harness or isolated deployments.

---

### Positive Observations

- **Exact Runtime Identity Parity:** The Python unit parser in `deploy/reset-linux-production.sh` implements the exact same validation rules as Rust's `resolve_api_runtime_identity` (single non-root User/Group, primary group verification via libc).
- **True Atomic File Replacement:** Avoids `sed -i` pitfalls by performing same-directory `mkstemp`, `fchmod 0600`, payload write, `fsync`, atomic `os.replace`, and parent directory `fsync`.
- **Thorough Test Coverage:** `server/tests/linux_release_preflight_sqlite.rs` adds 10 comprehensive tests validating both absent, canonical only, legacy relative, dual config dedup, tilde expansion, symlink/non-regular refusal, zero FS mutation, and mock `/proc` foreign process holder detection for DB, WAL, and SHM files.
- **Regression Prevention:** `tests/deploy/linux-release-clean-install.sh` explicitly verifies installer source code does not contain `dam-hopper.toml` creation or modification commands.

---

### Validation Commands & Results

| Command | Status | Details |
|---|---|---|
| `cargo test --test linux_release_preflight_sqlite` | PASS | 10/10 tests passed (0.00s) |
| `bash -n deploy/release/dam-hopper-install.sh deploy/reset-linux-production.sh tests/deploy/linux-release-clean-install.sh tests/deploy/linux-release-security.sh` | PASS | Clean syntax across all bash scripts |
| `bash tests/deploy/linux-release-clean-install.sh` | PASS | Clean install verified for server, web, and both roles |
| `bash tests/deploy/linux-release-security.sh` | PASS | Sandboxing, role identities, and secret exclusion verified |
| `bash tests/deploy/linux-release-rootless-smoke.sh` | PASS | Rootless process smoke passed (ports 47719/57985) |
| `bash tests/deploy/fedora44-format2-migration.sh` | PASS | Format-2 fixture migration and rollback rehearsal passed |
| `bash tests/deploy/linux-release-upgrade-rollback.sh` | PASS | Upgrade, role change, and rollback journeys verified |
| `bash tests/deploy/linux-release-crash-recovery.sh` | PASS | Crash recovery and reconciliation boundaries verified |
| `bash tests/deploy/linux-release-web-contract.sh` | PASS | Web contract, health schema, and runtime config verified |
| Reset Script Synthetic Scenarios (Dry-Run & Live) | PASS | Verified identity parsing, metadata validation, symlink refusal, mode mismatch refusal, and atomic TOML disablement |

---

### Unresolved Questions
*None.*

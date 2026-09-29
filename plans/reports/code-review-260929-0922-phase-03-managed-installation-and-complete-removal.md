# Code Review: Phase 03 — Managed Installation and Complete Removal

**Review Date:** 2026-09-29  
**Review Target:** Phase 03 — Managed installation and complete removal  
**Review Score:** 9/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/agent_status/codex_integration.rs` (new, 779 lines)
  - `server/src/agent_status/claude_integration.rs` (new, 629 lines)
  - `server/src/agent_status/assets/native-agent-status.sh` (new, 5 lines)
  - `server/src/agent_status/integration.rs` (+280 / -13 lines)
  - `server/src/agent_status/mod.rs` (+18 lines)
  - `server/src/api/agent_status.rs` (+197 lines)
  - `server/src/api/router.rs` (+6 lines)
  - `server/src/error.rs` (+6 lines)
  - `server/src/main.rs` (+144 lines)
  - `server/tests/agent_status_integration.rs` (+455 lines)
  - `server/tests/agent_status_runtime.rs` (+3 lines)
- **Lines of code analyzed:** ~2,500 LOC
- **Review focus:** Security, architecture, state consistency, atomicity, idempotency, YAGNI/KISS/DRY, and task completion.
- **Updated plans:**
  - `plans/260929-0140-agent-status-codex-claude/phase-03-managed-hook-installation.md`
  - `plans/260929-0140-agent-status-codex-claude/plan.md`

---

### Overall Assessment
High-quality, production-ready implementation of native hook lifecycle management for Codex CLI and Claude Code. The design exhibits meticulous attention to configuration integrity:
- Atomic file writes via tempfiles on the same filesystem boundary (`atomic_write_file`).
- Clean separation between installation status (`Absent`, `Current`, `Outdated`, `Modified`) and runtime readiness (`Ready`, `TrustRequired`, `PolicyDisabled`, `PermissionDenied`, `RestartRequired`, `Unverified`).
- Safe native config mutations:
  - Codex preserves existing `[hooks]` in `config.toml` without duplicating into `hooks.json`, preserving TOML comments and custom formatting via `toml_edit`.
  - Claude preserves sibling matchers and unrelated top-level settings in `settings.json`.
- Strict manifest tracking (`ManagedHookManifest`) with SHA-256 integrity fencing to refuse overwriting or deleting locally modified assets.
- Complete cleanup: empty files/directories are only removed if recorded in `created_files`/`created_directories` by DamHopper.
- CLI subcommands and REST API endpoints mirror identical behavior with zero guessed user substitutions.

---

### Critical Issues
None. Zero breaking security vulnerabilities, data loss risks, or regressions.

---

### Warnings (High / Medium Priority Findings)

1. **[High] Unhandled HTTP 428 status code in `ApiError::into_response`**
   - **File:** `server/src/api/error.rs:44-53` & `server/src/error.rs:125`
   - **Problem:** `AppError::AgentStatusIntegration(IntegrationError::RestartRequired(_))` returns HTTP status code `428`. However, `ApiError::into_response` does not include `428` in its `match self.0.status_code()` block, falling through to `_ => StatusCode::INTERNAL_SERVER_ERROR` (500).
   - **Impact:** An intended `428 Precondition Required` becomes a confusing `500 Internal Server Error` to API clients.
   - **Fix:** Add `428 => StatusCode::PRECONDITION_REQUIRED` to `ApiError::into_response` or use `StatusCode::from_u16(self.0.status_code()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)`.

2. **[Medium] `get_agent_paths_verification` verifies only `config.toml` for Codex**
   - **File:** `server/src/api/agent_status.rs:270-290`
   - **Problem:** Path verification checks `codex_config_dir_buf.join("config.toml").is_file()`. However, `codex_integration.rs` defaults to `hooks.json` when `[hooks]` is absent in `config.toml`. If a user installs Codex hooks via DamHopper, `hooks.json` is created, but `get_agent_paths_verification` reports `codex_config_exists = false` and `codex_can_enable = false`.
   - **Impact:** UI/notification verification in Phase 05 may falsely report Codex configuration missing when `hooks.json` is present.
   - **Fix:** Update check to `config_file.is_file() || codex_config_dir_buf.join("hooks.json").is_file()`.

3. **[Medium] Config file symlink and bounded size validation**
   - **Files:** `server/src/agent_status/codex_integration.rs` & `server/src/agent_status/claude_integration.rs`
   - **Problem:** While `launcher_path` and `manifest_path` are validated via `validate_safe_file`, `config_path` (`hooks.json`, `config.toml`, `settings.json`) is read directly via `std::fs::read_to_string` without checking `validate_safe_file(&config_path)` or checking file size bounds (`metadata.len() > 1024 * 1024`).
   - **Impact:** A symlinked configuration target would be followed on read; unbounded file size could cause excessive memory consumption.
   - **Fix:** Call `validate_safe_file(&config_path)?` and check `metadata.len() <= 1024 * 1024` before `read_to_string`.

---

### Suggestions (Low Priority Improvements)

1. **[Low] Unused test imports in `server/tests/agent_status_integration.rs`**
   - `check_native_integration_status`, `install_native_integration`, `uninstall_native_integration`, and `MANAGED_MANIFEST_SUBPATH` trigger compiler warnings. Clean up imports or add assertions exercising the generic dispatch functions.
2. **[Low] Path traversal validation on environment variables**
   - In `resolve_native_target_dir`, validate `CODEX_HOME` and `CLAUDE_CONFIG_DIR` with `expand_and_validate_path` rather than bare `p.is_absolute()`, ensuring no `ParentDir` (`..`) components are accepted.
3. **[Low] JSONC resilience for Claude `settings.json`**
   - User-edited `settings.json` files in development environments sometimes contain comments or trailing commas. Consider JSONC parsing or documenting strict JSON formatting requirement.
4. **[Low] Stale in-memory hook invocations during uninstall**
   - Active native sessions cache hook configurations in memory. Deleting `launcher_path` immediately during `uninstall` can lead to `ENOENT` if the active session fires an event before restarting. Rendering a no-op script (`exit 0`) during intermediate removal mitigates native process error logs.

---

### Positive Observations
- **Comment-preserving TOML editing:** Utilizing `toml_edit` prevents destructively rewriting user comments and formatting in Codex `config.toml`.
- **Atomic mutations:** `atomic_write_file` cleanly writes to a `.dh-tmp-*.tmp` file in the destination directory, enforces Unix permission bits before publishing, flushes and syncs to disk, and atomically replaces the destination.
- **Rollback on partial failure:** If hook registration fails after staging launcher and manifest, staged assets are rolled back cleanly.
- **Polite ownership cleanup:** Uninstallation checks `created_files` before removing configuration files, ensuring user-created configurations are never deleted.
- **CLI/API parity:** Both interfaces consume the same business logic and error mapping.

---

### Recommended Actions
1. Map `428 => StatusCode::PRECONDITION_REQUIRED` in `server/src/api/error.rs`.
2. Update `get_agent_paths_verification` in `server/src/api/agent_status.rs` to recognize `hooks.json` alongside `config.toml`.
3. Add `validate_safe_file(&config_path)?` and a 1 MiB length check in `codex_integration.rs` and `claude_integration.rs`.
4. Clean up unused imports in `server/tests/agent_status_integration.rs`.

---

### Metrics
- **Compilation:** 0 errors, 0 warnings in `server/src`.
- **Test Results:** 1,641 passed, 0 failed, 5 ignored (`cargo test --manifest-path server/Cargo.toml`).
- **Integration Test Suite:** 14 passed, 0 failed (`agent_status_integration`).

---

### Unresolved Questions
1. Does Phase 05 intend to enable notification channels based on `ManagedReadinessStatus::TrustRequired` (requiring user confirmation in Codex `/hooks`) or will notification enablement await live observed events?
2. Should uninstallation replace the launcher with a temporary no-op script (`exit 0`) to prevent ENOENT errors in active sessions that have not yet reloaded configuration?

# Code Review: Phase 03 — Managed Installation and Complete Removal (Cycle 2)

**Review Date:** 2026-09-29  
**Review Target:** Phase 03 — Managed installation and complete removal  
**Review Score:** 9.5/10  

---

## Code Review Summary

### Scope
- **Files reviewed:**
  - `server/src/agent_status/codex_integration.rs` (779 lines)
  - `server/src/agent_status/claude_integration.rs` (629 lines)
  - `server/src/agent_status/integration.rs` (609 lines)
  - `server/src/agent_status/assets/native-agent-status.sh` (5 lines)
  - `server/src/agent_status/mod.rs` (32 lines)
  - `server/src/api/agent_status.rs` (487 lines)
  - `server/src/api/error.rs` (76 lines)
  - `server/src/api/router.rs` (934 lines)
  - `server/src/error.rs` (172 lines)
  - `server/src/main.rs` (1051 lines)
  - `server/tests/agent_status_integration.rs` (732 lines)
  - `server/tests/agent_status_runtime.rs` (660 lines)
- **Lines of code analyzed:** ~3,100 LOC (targeted review across integration and runtime suites)
- **Review focus:** Cycle 1 fix verification, security boundaries, atomic mutations, symlink/size bounds, YAGNI/KISS/DRY, and task completeness.
- **Updated plans:**
  - `plans/260929-0140-agent-status-codex-claude/phase-03-managed-hook-installation.md`

---

### Overall Assessment
Cycle 2 confirms all four Cycle 1 recommendations resolved cleanly:
1. HTTP 428 (`Precondition Required`) mapped in `ApiError::into_response`.
2. Codex path verification checks `hooks.json` alongside `config.toml`.
3. `read_bounded_safe_file` enforces symlink rejection and 1 MiB size ceiling on config reads.
4. Generic dispatch functions and manifest constants covered by integration test `test_generic_native_integration_dispatch`.

Codebase exhibits high discipline: atomic writes via tempfiles in target parent directory, symlink rejection across directory and file operations, comment-preserving TOML editing via `toml_edit`, surgical JSON mutations preserving sibling matchers and user hooks, strict ownership manifests with SHA-256 integrity fencing, polite cleanup deleting only DamHopper-created files/directories, and CLI/API parity.

---

### Critical Issues
None. Zero vulnerabilities, breaking regressions, or data loss risks.

---

### Warnings (High / Medium Priority Findings)

1. **[Medium] DRY Inconsistency: Unused `NATIVE_LAUNCHER_ASSET` template**
   - **Files:** `server/src/agent_status/assets/native-agent-status.sh`, `server/src/agent_status/integration.rs:12,273-285`, `server/src/agent_status/mod.rs:29`
   - **Problem:** `native-agent-status.sh` asset is bundled via `include_str!` as `NATIVE_LAUNCHER_ASSET` and re-exported in `mod.rs`. However, `render_launcher_script` constructs the script via an independent inline `format!` macro instead of substituting placeholders into `NATIVE_LAUNCHER_ASSET`.
   - **Impact:** Modifications to `native-agent-status.sh` will not propagate to generated launchers. Duplication violates DRY.
   - **Fix:** In `render_launcher_script`, replace placeholders in `NATIVE_LAUNCHER_ASSET` (e.g. `__AGENT_KIND__`, `__MANAGED_VERSION__`, `__BINARY_PATH__`, `__ESCAPED_BINARY_PATH__`), or remove the redundant asset file and constant.

---

### Suggestions (Low Priority Improvements)

1. **[Low] Path traversal validation on environment variables**
   - **Files:** `server/src/api/agent_status.rs:161-177,251-255,298-302`
   - **Observation:** `CODEX_HOME` and `CLAUDE_CONFIG_DIR` only check `p.is_absolute()`. Validating with `expand_and_validate_path(&dir, effective_home.as_deref())` rejects `ParentDir` (`..`) components and supports `~/` expansion for custom environment variables.
2. **[Low] JSONC parsing resilience for Claude `settings.json`**
   - **File:** `server/src/agent_status/claude_integration.rs`
   - **Observation:** Claude Code configs in developer environments may contain trailing commas or comments. Standard `serde_json` fails on syntax. Preprocessing or using a JSONC parser improves robustness.
3. **[Low] File size management / Modularization**
   - **Files:** `codex_integration.rs` (779 lines), `claude_integration.rs` (629 lines), `integration.rs` (609 lines)
   - **Observation:** Modules exceed the 200 LOC guideline from `development-rules.md`. Consider splitting TOML and JSON helpers into dedicated submodules during future maintenance.
4. **[Low] Stale in-memory hook invocations during uninstallation**
   - **Files:** `server/src/agent_status/codex_integration.rs:431`, `server/src/agent_status/claude_integration.rs:409`
   - **Observation:** If an active session invokes hooks before restart/reload, deleted launcher triggers `ENOENT`. Staging a no-op script (`exit 0`) during intermediate removal prevents harmless stderr noise.

---

### Positive Observations & Cycle 1 Remediation Verification
- **HTTP 428 Resolution:** `server/src/api/error.rs` line 51 maps `428 => StatusCode::PRECONDITION_REQUIRED`, properly communicating restart requirements to HTTP clients.
- **Path Verification Resilience:** `server/src/api/agent_status.rs` lines 271-272 check `config_file.is_file() || hooks_file.is_file()`, preventing false "config missing" errors when users rely on `hooks.json`.
- **Symlink & Bounded Read Protection:** `read_bounded_safe_file` in `integration.rs` verifies non-symlink status and caps file reads at 1 MiB (`MAX_CONFIG_FILE_BYTES`) before decoding, preventing unbounded memory consumption and symlink attacks.
- **Test Coverage for Generic Dispatch:** `server/tests/agent_status_integration.rs` lines 713-732 added `test_generic_native_integration_dispatch`, covering `check_native_integration_status`, `install_native_integration`, `uninstall_native_integration`, and `MANAGED_MANIFEST_SUBPATH` with 0 compiler warnings.

---

### Recommended Actions
1. Substitute placeholders into `NATIVE_LAUNCHER_ASSET` in `render_launcher_script` to eliminate string duplication.
2. Route `CODEX_HOME` and `CLAUDE_CONFIG_DIR` through `expand_and_validate_path` to reject `ParentDir` components.

---

### Metrics
- **Compilation:** 0 errors, 0 warnings across all `agent_status` library, binary, and test modules.
- **Test Results:** 87 passed, 0 failed, 0 ignored across agent status test suites:
  - `cargo test --manifest-path server/Cargo.toml --test agent_status_integration`: 15 passed, 0 failed
  - `cargo test --manifest-path server/Cargo.toml --lib agent_status`: 59 passed, 0 failed
  - `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime`: 8 passed, 0 failed
  - `cargo test --manifest-path server/Cargo.toml --test agent_status_hooks`: 5 passed, 0 failed
- **Task Completeness:** 100% (all TODO items in `phase-03-managed-hook-installation.md` completed and verified).

---

### Unresolved Questions
1. In Phase 05, will notification channel toggling for Codex require manual trust verification in `/hooks` prior to enablement, or will it remain gated strictly on observed runtime events?
2. Should launcher scripts during uninstall write a temporary `exit 0` no-op stub before final deletion to avoid `ENOENT` in active agent sessions before restart?

# Code Review: Agent Store Settings & Install Path Implementation

- **Date:** 2026-09-28
- **Plan:** `plans/260928-2225-agent-store-settings-install-path/plan.md`
- **Review Score:** 6/10
- **Status:** Action Required (Critical architectural & security gaps identified)

---

## Executive Summary

The implementation establishes the frontend tab restructuring (replacing the legacy Integrations tab with **Agent Settings**), deletes obsolete extension management components, adds the `AgentSettingsPaths` configuration schema, and introduces the server-side `GET /api/agent-status/paths` verification endpoint.

However, several core security and architectural invariants mandated in the plan were omitted or bypassed:
1. **Missing Backend Policy Gate:** `update_global_ui_at_path_with_codex_home` allows enabling OMP and Codex notifications without verifying extension presence or configuration existence.
2. **Side-Effect Auto-Creation:** `sync_codex_tui_config` creates `~/.codex` and a blank `config.toml` upon enablement, directly violating the contract to require pre-existing regular, valid configuration files.
3. **Dispatch-Time Bypass:** Notification dispatch in `terminal-agent-notification-integration.ts` checks only `policy.enabled`, failing to enforce runtime path eligibility or fail-closed invalidation.
4. **Arbitrary Directory Creation:** `install_omp_extension` creates non-existent directory trees on user input rather than requiring an existing OMP directory.
5. **File Permission Lockdown:** `sync_codex_tui_config` writes `config.toml` with `0o600` permissions under the API identity, preventing the terminal user from accessing their own configuration.

---

## Critical Issues

### 1. Missing Backend Policy Gate on Enablement
- **Location:** `server/src/api/config.rs:321-354`
- **Problem:** When an incoming UI configuration patch sets `terminalAgentNotifications.agents.codex.enabled: true` or `omp.enabled: true`, the server commits the state without verifying that:
  - The configured path matches the effective runtime path.
  - The OMP extension is installed and current.
  - The Codex `config.toml` exists and is parseable.
- **Impact:** Any client or API caller can bypass UI toggle guards, enabling notifications in invalid, unverified, or mismatched environments.
- **Fix:** In `update_global_ui_at_path_with_codex_home`, inspect `previous` vs `next` enabled flags and path changes. If transitioning to `enabled: true` or changing paths while enabled, evaluate `get_agent_paths_verification` or internal verification helpers; return `AppError::InvalidInput` (HTTP 400) if `can_enable` is false.

### 2. Auto-Creation of Codex Directory and Config File
- **Location:** `server/src/api/config.rs:390-395`
- **Problem:** If `config_path.exists()` is false when enabling, `sync_codex_tui_config` executes `std::fs::create_dir_all(&codex_dir)` and creates a new `config.toml` containing default TUI keys.
- **Impact:** Violates Plan Contract Item 4: *"never create a different ~/.codex, and require existing readable, regular, parseable config.toml before turning on."*
- **Fix:** Reject enablement when `!config_path.is_file()`. Only allow writes to existing, regular `config.toml` files.

### 3. Fail-Open Dispatch-Time Bypass
- **Location:** `packages/ui/src/lib/terminal-agent-notification-integration.ts:41-43, 174-175`
- **Problem:** Notification delivery (`deliverSemanticAgentAttention` for OMP and `handleTerminalSignal` for Codex) only checks `policy.enabled`.
- **Impact:** Stale, offline, or mismatched configurations with `enabled: true` continue emitting sound, toast, and browser notifications if the extension or configuration is removed externally.
- **Fix:** Revalidate profile eligibility at dispatch time (or subscribe to active verification state in `stores/agent-status.ts`), dropping alerts when unverified or mismatched.

### 4. Arbitrary Directory Creation via OMP Install
- **Location:** `server/src/api/agent_status.rs:280-283`
- **Problem:** `install_omp_extension` executes `std::fs::create_dir_all(&agent_dir)` before calling `install_extension(&agent_dir)`.
- **Impact:** Authenticated requests with arbitrary paths (e.g. `/tmp/bogus/path`) create directory structures under the API user account. Violates Acceptance Phase 1: *"install must not create an arbitrary home path on mistaken input (existing OMP directory required)."*
- **Fix:** Remove `create_dir_all(&agent_dir)`. Require `agent_dir` to exist as a directory prior to extension installation.

### 5. Codex File Permissions Lockdown (`0o600`)
- **Location:** `server/src/utils/fs.rs:47` called by `server/src/api/config.rs:424`
- **Problem:** `atomic_write` sets mode `0o600` on newly written files.
- **Impact:** When the DamHopper server runs as system service user `dam-hopper`, writing to a target user's `~/.codex/config.toml` locks file permissions to `dam-hopper:dam-hopper (0600)`. The terminal user running Codex in a PTY cannot read or write their own configuration.
- **Fix:** Retain existing file permissions and ownership when updating `config.toml`, or ensure group-read permissions (`0o644`/`0o664`) when safe.

---

## Warnings

### 1. Un-debounced Keystroke API Flooding
- **Location:** `packages/ui/src/components/organisms/AgentSettings.tsx:90-103`
- **Problem:** `useAgentPathsVerification` and `useOmpExtensionStatus` query parameters are tied directly to raw input states `ompPathDraft` and `codexPathDraft`.
- **Impact:** Every keystroke triggers immediate concurrent backend requests with partial paths (`/h`, `/ho`, `/hom`), generating disk I/O and log noise.
- **Fix:** Debounce draft path inputs (e.g., 300-500ms) or trigger verification only on blur/save.

### 2. UI Draft vs Mutation Path Decoupling
- **Location:** `packages/ui/src/components/organisms/AgentSettings.tsx:119-161`
- **Problem:** Clicking "Install Extension" or "Remove Extension" calls mutations with `ompPathDraft` instead of the verified, saved path `agentSettingsPaths.ompAgentDir`.
- **Impact:** Users can type an arbitrary path without saving, click install, and modify a directory different from their saved configuration.
- **Fix:** Require saving the path or ensure install actions execute only against the persisted, verified path.

### 3. Profile Switching State Invalidation Ignored
- **Location:** `packages/ui/src/components/organisms/AgentSettings.tsx:23-26, 45`
- **Problem:** `profileId` is received in props but never destructured or observed in `useEffect`.
- **Impact:** Switching server profiles leaves `ompPathDraft`, `codexPathDraft`, and feedback messages stale.
- **Fix:** Add `profileId` to dependency arrays, resetting draft inputs and feedback banners on profile switch.

### 4. Incomplete Codex Verification in Paths Endpoint
- **Location:** `server/src/api/agent_status.rs:217-218`
- **Problem:** Codex path verification checks only `config_file.is_file()`.
- **Impact:** Follows symlinks without validating against symlink escapes, does not test file readability, and does not check for valid TOML syntax.
- **Fix:** Check symlink metadata, file readability, and attempt basic TOML parsing before returning `codexCanEnable: true`.

### 5. Silent Auto-Re-enablement on Verification Recovery
- **Location:** `packages/ui/src/components/organisms/AgentSettings.tsx:385, 536`
- **Problem:** Switch checked state is computed as `policy.enabled && verification.canEnable`.
- **Impact:** If verification fails, the switch renders off, but `policy.enabled` remains `true` in `useSettingsStore`. If verification later recovers, notifications turn on automatically without user interaction.
- **Fix:** Explicitly set `policy.enabled: false` upon verification failure, or require re-enabling.

### 6. Missing Phase 2 Negative/Failure Test Coverage
- **Location:** `server/src/api/tests.rs`
- **Problem:** Only one positive persistence test was added. Missing tests for off→on rejection, path change while on, missing/malformed config, disable after deletion, and failed write.
- **Fix:** Implement the test suite specified in Plan Phase 2 Acceptance.

---

## Suggestions

1. **Async or Cached Host Config Read:** In `server/src/api/agent_status.rs:70`, `std::fs::read_to_string("/etc/dam-hopper/host.toml")` executes synchronous I/O in an async handler. Cache via `LazyLock` or read asynchronously.
2. **DRY User Lookup:** Consolidate user account resolution between `server/src/pty/manager.rs` (`resolve_current_user_account`) and `server/src/api/agent_status.rs` (`resolve_user_home_by_name`).
3. **Fix Test Event Dispatch:** In `packages/ui/src/components/organisms/AgentSettings.test.tsx:160-181`, use proper React event simulation so `saveAgentSettingsPaths` tests against the typed input rather than the fallback.
4. **Documentation Updates:** Complete documentation updates across `docs/configuration-guide.md`, `docs/linux-systemd.md`, and `docs/CHANGELOG.md` as outlined in Phase 4.

---

## Reviewed Files

| File | Status | Notes |
|---|---|---|
| `server/src/agent_status/integration.rs` | Modified | Added `AgentPathsVerification` DTO. Clean. |
| `server/src/agent_status/mod.rs` | Modified | Re-exported `AgentPathsVerification`. Clean. |
| `server/src/api/agent_status.rs` | Modified | Path resolution and `/api/agent-status/paths` endpoint. Needs fix for `create_dir_all`. |
| `server/src/api/router.rs` | Modified | Route registration. Clean. |
| `server/src/config/schema.rs` | Modified | Added `AgentSettingsPaths` struct. Clean. |
| `server/src/config/global.rs` | Modified | TOML casing normalization. Clean. |
| `server/src/api/config.rs` | Modified | Codex sync path forward. Missing policy gate and auto-create prohibition. |
| `server/src/api/tests.rs` | Modified | Added paths persistence test. Missing negative tests. |
| `server/src/config/tests.rs` | Modified | Serde roundtrip test updated. Clean. |
| `server/tests/agent_status_runtime.rs` | Modified | Added paths verification API test. Clean. |
| `packages/ui/src/api/agent-status-types.ts` | Modified | Types and runtime decoders. Clean. |
| `packages/ui/src/api/client.ts` | Modified | Client methods and config interfaces. Clean. |
| `packages/ui/src/api/ws-transport.ts` | Modified | Transport routing for paths endpoint. Clean. |
| `packages/ui/src/api/queries.ts` | Modified | Query hooks and cache invalidation. Clean. |
| `packages/ui/src/lib/ui-config.ts` | Modified | Config defaults preservation. Clean. |
| `packages/ui/src/stores/settings.ts` | Modified | Added paths store action and persistence. Clean. |
| `packages/ui/src/components/organisms/AgentSettings.tsx` | Added | Unified settings organism. Needs debouncing & profileId handling. |
| `packages/ui/src/components/organisms/AgentSettings.test.tsx` | Added | Unit tests. Clean; minor input dispatch quirk. |
| `packages/ui/src/components/pages/AgentStorePage.tsx` | Modified | Cutover to Agent Settings tab. Clean. |
| `packages/ui/src/components/pages/AgentStorePage.test.tsx` | Modified | Updated tab tests. Clean. |
| `packages/ui/src/components/organisms/SettingsAppearanceSection.tsx` | Modified | Removed notification section. Clean. |
| `packages/ui/src/components/organisms/OmpExtensionManager.tsx` | Deleted | Verified removal. |
| `packages/ui/src/components/organisms/OmpExtensionManager.test.tsx` | Deleted | Verified removal. |
| `packages/ui/src/lib/terminal-agent-notification-integration.ts` | Unchanged | **Gap:** Missing Phase 4 dispatch-time eligibility gate. |
| `docs/architecture/agent-status.md` | Modified | Added 8 lines of design summary. |

---

## Validation Commands & Results

| Command | Results |
|---|---|
| `cargo test --manifest-path server/Cargo.toml agent_status` | 17 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_runtime` | 8 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml --test agent_status_integration` | 6 passed, 0 failed |
| `cargo test --manifest-path server/Cargo.toml update_global_ui_at_path` | 12 passed, 0 failed |
| `pnpm --filter @dam-hopper/ui test` | 1,939 passed across 277 test suites |

---

## Unresolved Questions

1. **Permission Architecture for Production API:** When running DamHopper under the dedicated `dam-hopper` systemd account, writing user-owned files like `~/.codex/config.toml` fails or locks out the user (`0o600`). Should DamHopper require same-user deployment for Codex notification syncing, or should it use dedicated POSIX ACLs documented in `docs/linux-systemd.md`?
2. **Draft Path UI Workflow:** Should draft path modifications auto-save with debounce, or should the "Install Extension" action be disabled until the user explicitly saves and verifies the path?

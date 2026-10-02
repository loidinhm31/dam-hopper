# Code Review: Phase 06 — Delete Dam-Hopper Plugin Runtime, SDK and Bridge

**Date:** 2026-10-02  
**Reviewer:** Phase06Reviewer  
**Status:** Approved  
**Score:** 9.5/10  

---

## Code Review Summary

### Scope
- **Files reviewed:** 112 files (111 git modified/deleted + `.gitignore`)
  - **Deleted:** 101 files
    - `packages/plugin-sdk/**` (33 files: schemas, fixtures, src, tsconfig, package.json, packed tgz)
    - `packages/ui/src/plugins/**` (9 files: bridge-host, validators, document, metadata, use-plugin-host, tests)
    - `packages/ui/src/components/{PluginHost.tsx, PluginFrame.tsx, PluginUnavailableState.tsx}`
    - `packages/ui/src/components/pages/settings-page/{PluginAccessModal.tsx, PluginManagementSection.tsx, PluginManagementSection.test.tsx}`
    - `packages/ui/src/api/plugin-types.ts`
    - `packages/ui/scripts/plugin-test-client.mjs`
    - `packages/ui/browser-tests/{plugin-frame.browser.tsx, plugin-isolation.browser.tsx}`
    - `server/src/plugins/**` (22 files: full plugin platform module)
    - `server/src/bin/{dam-hopper-plugin-runner.rs, dam-hopper-plugin-test-server.rs}`
    - `server/src/api/{plugins.rs, plugin_admin.rs, plugin_assets.rs}`
    - `server/tests/plugin_*.rs` (10 integration suites)
  - **Modified:** 11 files
    - `.github/workflows/release-linux.yml` (removed runner binary packaging/checks)
    - `package.json` (removed plugin runner test scripts)
    - `packages/ui/src/api/client.ts` (removed `plugins` namespace, `PluginTransportSeam`)
    - `packages/ui/src/api/ws-transport.ts` (removed plugin endpoints, epoch tracking, `getPluginEpoch`)
    - `packages/ui/src/index.css` (pruned isolated plugin host/frame styles)
    - `server/Cargo.toml` (removed runner/test-server binary definitions)
    - `server/src/api/agent_status.rs` (removed `plugin_owner_user` table lookup fallback)
    - `server/src/api/auth.rs` (removed `revoke_actor` call on logout)
    - `server/src/api/mod.rs` (removed plugin submodule exports)
    - `server/src/api/router.rs` (removed plugin routes and `X_PLUGIN_UI_SHA256` CORS header)
    - `server/src/api/ws.rs` & `server/src/api/ws_protocol.rs` (surgically excised plugin epoch logic & wire messages)
    - `server/src/lib.rs` & `server/src/state.rs` (removed `plugin_service` and `plugins` module)
    - `.gitignore` (removed stale plugin-sdk fixture unignore rule)
- **Lines of code analyzed:** 26,735 deletions, ~10 additions
- **Review focus:** Phase 06 deletion completeness, surgical detachment from auth/WS, security, performance, build integrity
- **Updated plans:**
  - `plans/261002-0246-native-advisor-migration/phase-06-remove-dam-hopper-plugin-platform.md`
  - `plans/261002-0246-native-advisor-migration/progress.md`

---

## Overall Assessment
Phase 06 executed a clean, disciplined deletion of the entire Dam-Hopper plugin platform. Surgical decoupling of plugin epochs from the WebSocket connection pipeline left core auth, session lifecycle, heartbeat, and generation fencing 100% operational. Zero shim or compatibility layers were introduced (clean cutover). All unit, integration, and UI build suites pass with zero regressions.

---

## Critical Issues
None.

---

## Warnings

1. **Stale Lockfile Entry (`pnpm-lock.yaml`)**:
   - `packages/plugin-sdk:` remains declared in `pnpm-lock.yaml`.
   - **Impact:** Low; does not fail builds (`packages/*` glob excludes it as directory is removed).
   - **Action:** Run `pnpm install` during Phase 07 / closeout integration to cleanly refresh `pnpm-lock.yaml`.

2. **Unused Middleware (`server/src/api/auth.rs:297`)**:
   - `require_bearer_auth` remains defined with error message `"Bearer token required for plugin management operations..."`, but has no remaining active route mounts in `router.rs`.
   - **Impact:** Harmless dead code.
   - **Action:** Can be purged or generalized in Phase 07 / Phase 09 cleanup.

---

## Suggestions

1. **Pre-existing Cargo Test Warnings**:
   - `tests/idle_suspend.rs`: unused imports and dead `TestClaims` struct.
   - `tests/browser_debug_artifacts.rs`: unused `jsonwebtoken` imports.
   - `src/pty/tests.rs`: unused `atomic::Ordering` import.
   - Recommend a quick cleanup pass when convenient.

2. **Phase 07 Handoff**:
   - Linux release manager and systemd templates under `deploy/` and `server/src/linux_release/` (`dam-hopper-plugin-runner.service.in`, tmpfiles, account provisioning) are ready for retirement in Phase 07.

---

## Positive Observations

- **Surgical WebSocket Decoupling:** In `server/src/api/ws.rs` and `ws_protocol.rs`, only plugin epoch registration and wire variants (`PluginGetEpoch`, `PluginEpoch`, `PluginRevoked`) were removed. Session expiry watchers, disconnect cleanup, and connection generation fencing were preserved intact.
- **True Clean Cutover:** Complete removal of obsolete code without leaving stubbed fallback handlers, no-ops, or deprecated shims.
- **Strict Route Invalidation:** `/api/plugins*` endpoints strictly return 404 without crashing or polluting error journals.
- **CSS Hygiene:** Removed 155 lines of dead iframe host/viewport styles from `packages/ui/src/index.css`.
- **Browser-Bridge Preserved:** Retained `@dam-hopper/browser-bridge` required by native desktop build (`apps/native/src-tauri/build.rs`).

---

## Validation Commands & Results

| Check | Command | Result |
|---|---|---|
| Rust Compilation | `cargo check` (server) | Pass (0 errors, 0 warnings) |
| Rust Test Compilation | `cargo check --tests` (server) | Pass (0 errors, 5 pre-existing warnings in unrelated tests) |
| Server Test Suite | `cargo test` (server) | Pass (1,719 passed, 0 failed, 6 ignored across 54 suites) |
| UI TypeScript Check | `pnpm --filter @dam-hopper/ui build` | Pass (`tsc -p tsconfig.json` clean, 0 errors) |
| UI Unit Tests | `pnpm --filter @dam-hopper/ui test` | Pass (2,206 passed, 0 failed across 293 test files) |
| Web Client Build | `pnpm --filter @dam-hopper/web build` | Pass (6,097 modules transformed, production assets generated in 30.2s) |
| Live HTTP Route Smoke | `GET /api/plugins` -> `GET /api/health` | Pass (404 Not Found, followed by 200 OK) |

**Total passing tests:** 3,925 passed, 0 failed.

---

## Metrics
- **Score:** 9.5 / 10
- **Type Coverage:** 100% strict TypeScript build without error
- **Regression Count:** 0
- **Lines Removed:** 26,735

---

## Unresolved Questions
None.

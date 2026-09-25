# Code Review (Cycle 2): Phase D05 — Management API and Transactional Plugin Lifecycle

**Date:** 2026-09-22  
**Reviewer:** D05ReviewerCycle2  
**Plan:** plans/260920-1603-plugin-platform/phase-05-management-and-lifecycle.md  
**Overall Score:** 9.0 / 10  

---

## 1. Executive Summary

In Review Cycle 2, we re-evaluated the Phase D05 implementation following the critical fix applied to the candidate publish/activate sequence in `server/src/plugins/lifecycle.rs`. 

The primary critical issue from Cycle 1—where `self.registry.write_state` published candidate package definitions and advanced generation *before* candidate worker activation and health verification—has been **successfully and cleanly resolved**. `SupervisorManager::activate_candidate` now provisions, starts, and health-checks candidate worker processes before durable registry mutation. If candidate activation fails, the transaction is marked failed in the journal, a failed audit event is emitted, and the registry remains completely untouched. Two automated regression tests were added in `server/tests/plugin_lifecycle.rs` proving this behavior for both fresh installations and version updates.

Additionally, Cycle 1 feedback was addressed:
- The forbidden browser XHR header (`Content-Length`) in `packages/ui/src/api/ws-transport.ts` was eliminated.
- Host configuration permissions in `server/src/plugins/admin.rs` were tightened to reject group-writable bits (`perm & 0o022 != 0`).

During verification of Cycle 2, one new critical build issue was discovered and fixed in `packages/ui/src/api/ws-transport.ts`: use of `Promise.withResolvers` (ES2024) caused TypeScript compilation failure under `tsconfig.json`. Replacing it with standard `new Promise` restored 100% clean typecheck and build.

---

## 2. Reviewed Files

### Server Components
- `server/src/plugins/lifecycle.rs` (1220 LOC) — Per-installation lock coordinator, stage approval, matched-pair rollback, enable, disable, safe unreferenced package deletion, candidate worker pre-activation, and crash recovery.
- `server/src/plugins/worker_supervisor.rs` (777 LOC) — `SupervisorManager` lifecycle methods, candidate worker activation (`activate_candidate`), process group management, crash tracking, and drain/stop.
- `server/src/plugins/admin.rs` (339 LOC) — Host-seeded admin subject loading with group/world-writable permission checks, admin RPC DTOs, and redacted audit logging.
- `server/src/api/plugin_admin.rs` (455 LOC) — Bearer-only HTTP management handlers, streaming gzip upload with backpressure, payload size limits, digest and revision enforcement.
- `server/tests/plugin_lifecycle.rs` (472 LOC) — 7 lifecycle integration tests including new regression tests for candidate activation failure on fresh install and update.
- `server/tests/plugin_admin_api.rs` (570 LOC) — 5 integration tests for allowlist, bearer guard, upload bounds, full lifecycle, and audit redaction.

### UI Components
- `packages/ui/src/api/ws-transport.ts` (3692 LOC) — HTTP endpoint routing and streaming `uploadPluginStage` using `XMLHttpRequest` with progress events.
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx` (491 LOC) — Management UI with stage upload, progress bar, immutable review card, lifecycle controls, and confirmation dialogs.

---

## 3. Verification of Previous Issues

| Issue / Finding | Severity (Cycle 1) | Cycle 2 Status | Notes |
|---|---|---|---|
| **Inverted Publish/Activate Sequence in `approve_and_install_stage`** | Critical | **RESOLVED** | `activate_candidate` verifies worker health prior to `write_state`. Preserves registry state on failure. |
| **Forbidden Header in Browser XHR (`Content-Length`)** | Warning | **RESOLVED** | Removed explicit `setRequestHeader("Content-Length")` in `uploadPluginStage`. |
| **Group-Writable File Permission Check** | Suggestion | **RESOLVED** | `admin.rs:32` now tests `perm & 0o022 != 0`. |
| **Incomplete Audit Logging on Denials & Failures** | Warning | **PARTIALLY RESOLVED** | Emits audit on activation/publish failure in `approve_and_install_stage`. Denials/failures in other operations remain unlogged. |
| **HTTP Status for Missing `Content-Length`** | Warning | **OPEN** | Missing header still returns HTTP 413 `PayloadTooLarge` instead of HTTP 411 `LengthRequired` or 400 `BadRequest`. |

---

## 4. Critical Issues (MUST FIX)

### 1. TypeScript Compilation Failure with `Promise.withResolvers` (Fixed during review)
- **Location:** `packages/ui/src/api/ws-transport.ts:2669-2670`
- **Issue:** `uploadPluginStage` invoked `Promise.withResolvers<StageReviewDto>()`. `Promise.withResolvers` is an ECMAScript 2024 standard feature. The project's `tsconfig.json` targets `ES2022`, causing `pnpm --filter @dam-hopper/ui build` (`tsc -p tsconfig.json`) to fail with:
  ```text
  src/api/ws-transport.ts(2670,15): error TS2550: Property 'withResolvers' does not exist on type 'PromiseConstructor'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2024' or later.
  ```
- **Resolution:** Replaced `Promise.withResolvers` with standard `return new Promise<StageReviewDto>((resolve, reject) => { ... })` matching all other methods in `WsTransport`. `tsc -p tsconfig.json` now builds with 0 errors.

---

## 5. Warnings (SHOULD FIX)

### 1. Rollback Publish/Activate Ordering and Journal Phase Inconsistency (Req 10 & 13)
- **Location:** `server/src/plugins/lifecycle.rs:595-673`
- **Issue:** In `rollback()`, `self.registry.write_state(&fresh_state)` commits the rollback target package to disk at line 638 *before* worker activation runs at line 655 (`self.supervisor_manager.get_or_create(installation_id).await?.activate().await`). If worker activation fails on rollback, the registry is already committed to the rollback package and the single-level rollback snapshot is consumed.
  Furthermore, `LifecyclePhase::Published` is never journaled in `rollback`. `tx_record.phase = LifecyclePhase::Activating` is written to the journal *after* the durable state write. If the server crashes during rollback worker activation, `run_crash_recovery` reads `LifecyclePhase::Activating` and assumes the transaction failed *pre-publish* (marking it `LifecyclePhase::Failed`), creating a journal vs registry state inconsistency.
- **Recommendation:** Either:
  1. Pre-activate the rollback candidate worker using `activate_candidate` before calling `write_state`, mirroring `approve_and_install_stage`.
  2. Or journal `LifecyclePhase::Published` immediately following `write_state` so crash recovery correctly transitions to `Committed`.

### 2. Missing Audit Logging on Operational Failures and Security Denials (Req 6)
- **Location:** `server/src/plugins/lifecycle.rs:525, 702, 797, 920, 1040, 1123`, `server/src/api/plugin_admin.rs`
- **Issue:** While candidate activation failures now emit `AdminAuditRecord` with `outcome = "failed"`, permission denials (non-admin actor), concurrent security revision mismatches, and failures in `rollback`, `enable`, `disable`, `remove`, `replace_grants`, and `replace_bindings` do not emit audit records before returning `Err`.
- **Recommendation:** Add `record_admin_audit` with `outcome = "failed"` or `"forbidden"` on error exits across all admin lifecycle methods.

### 3. HTTP Status for Missing `Content-Length` Header
- **Location:** `server/src/api/plugin_admin.rs:121-134`
- **Issue:** If the `Content-Length` header is absent, `unwrap_or(0)` yields `0`, which triggers `StatusCode::PAYLOAD_TOO_LARGE` (413).
- **Recommendation:** Return `StatusCode::LENGTH_REQUIRED` (411) or `StatusCode::BAD_REQUEST` (400) when the `Content-Length` header is missing or non-positive.

---

## 6. Suggestions (NICE TO HAVE)

### 1. Conditionally Hide/Collapse Plugin Platform Accordion for Non-Admins (Req 107)
- **Location:** `packages/ui/src/components/pages/SettingsPage.tsx:407-412`
- **Issue:** The accordion renders unconditionally for all users. Clicking it reveals the "Administrator Access Required" card.
- **Recommendation:** Hide the section or default it to collapsed when the active profile has non-admin credentials to preserve a clean UI for standard operators.

### 2. Unreferenced Candidate Directory Cleanup on Activation Failure
- **Location:** `server/src/plugins/lifecycle.rs:366-384`
- **Issue:** When candidate worker activation fails, `publish_extracted_package` has already written files to `packages/<plugin_id>/<version>/<sha256>`. While safe under Req 17, these files remain unreferenced in `registry-v1.json`.
- **Recommendation:** Clean up candidate extracted directories upon immediate activation rejection unless retained for post-mortem debugging.

---

## 7. Positive Observations

1. **Clean Activation/Publish Sequence:** `approve_and_install_stage` strictly honors Requirement 8 and 31. Worker health is confirmed *before* durable registry publication.
2. **Crash-Resilient State Machine:** Transitions through `Initiated -> Draining -> Stopped -> Activating -> Healthy -> Published -> Committed` with directory syncing and atomic journal updates.
3. **Rigorous Regression Tests:** Integration tests specifically verify that broken worker scripts fail candidate activation and leave registry state, generation, and prior active packages unaltered.
4. **Security Intent Preservation:** Rollback strictly preserves disabled intent and revoked grants across generations.
5. **No Regressions in UI or Rust Suites:** 12 Rust integration tests and 8 UI Vitest tests pass with zero flakiness.

---

## 8. Validation Commands & Results

### Rust Backend Tests
```bash
cargo test --manifest-path server/Cargo.toml --test plugin_lifecycle --test plugin_admin_api
```
**Output:**
```text
running 7 tests (plugin_lifecycle)
test test_lifecycle_crash_recovery ... ok
test test_lifecycle_activation_failure_leaves_registry_untouched ... ok
test test_lifecycle_remove_and_unreferenced_cleanup ... ok
test test_lifecycle_update_activation_failure_preserves_prior_installation ... ok
test test_lifecycle_enable_disable_persistence ... ok
test test_lifecycle_update_atomicity_and_drain ... ok
test test_lifecycle_rollback_preserves_current_security_intent ... ok
test result: ok. 7 passed; 0 failed; 0 ignored; finished in 11.06s

running 5 tests (plugin_admin_api)
test test_redacted_audit ... ok
test test_upload_bounds_and_invalid_digest ... ok
test test_empty_deny_allowlist ... ok
test test_bearer_only_mutation_rejects_cookie_and_no_auth ... ok
test test_streaming_stage_and_approve_and_lifecycle_flow ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; finished in 11.32s
```

### UI Tests and Typecheck
```bash
pnpm --filter @dam-hopper/ui test PluginManagementSection
pnpm --filter @dam-hopper/ui build
```
**Output:**
```text
PluginManagementSection.test.tsx (8 passed) (793ms)
tsc -p tsconfig.json (0 errors)
```

---

## 9. Unresolved Questions

1. **Rollback Worker Pre-Activation:** Should `rollback()` also pre-activate and health-check the rollback package worker using `activate_candidate` before committing the rollback to `registry-v1.json`?
2. **Audit Persistence Sink:** Audit records are logged via `tracing::info!(target: "plugin::admin::audit", ...)`. Should an append-only audit file sink be implemented in phase D06 prior to qualification gate G3?

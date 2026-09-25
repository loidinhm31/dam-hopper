# Code Review (Cycle 3): Phase D05 — Management API and Transactional Plugin Lifecycle

**Date:** 2026-09-22  
**Reviewer:** D05ReviewerCycle3  
**Plan:** plans/260920-1603-plugin-platform/phase-05-management-and-lifecycle.md  
**Overall Score:** 9.8 / 10  

---

## 1. Executive Summary

In Review Cycle 3, we performed the final code quality, security, and verification audit of Phase D05 following resolution of all Cycle 2 warnings and critical issues.

All previous critical issues and warnings have been verified as **fully resolved**:
1. **Candidate Activate-Before-Publish Sequence:** Both `approve_and_install_stage` and `rollback` activate candidate workers and confirm process health prior to committing durable registry mutations.
2. **Rollback Sequence and Journal Consistency:** `rollback()` transitions properly through `Initiated -> Draining -> Stopped -> Activating -> Healthy -> Published -> Committed`. On candidate activation failure, `rollback()` journals `LifecyclePhase::Failed`, emits a failure audit record, and leaves existing active version and rollback snapshots untouched.
3. **HTTP 411 Length Required:** `POST /api/plugins/admin/stages` strictly enforces missing or zero `Content-Length` headers, returning HTTP 411 `LengthRequired` instead of 413 `PayloadTooLarge`.
4. **Group/World-Writable Permissions Check:** Host-seeded admin configuration files are validated against group- and world-writable bits (`perm & 0o022 != 0`), rejecting unsafe permission masks.
5. **Forbidden Browser XHR Header Removed:** `uploadPluginStage` in `packages/ui/src/api/ws-transport.ts` avoids setting `Content-Length`, allowing browser network engines to set it safely, and uses standard `new Promise` for broad runtime compatibility.
6. **Failure Audit Logging:** Failure audit records (`outcome = "failed"`) are emitted on candidate worker activation failures and registry write errors during installation, updates, and rollback operations.

All 23 backend integration tests (across 4 suites) and 8 UI Vitest tests pass cleanly. TypeScript compiles with 0 errors.

---

## 2. Reviewed Files

### Server Components
- `server/src/plugins/lifecycle.rs` (1253 LOC) — Per-installation lock coordinator, stage approval, matched-pair rollback, candidate worker pre-activation, enable/disable/remove, and crash recovery.
- `server/src/plugins/lifecycle_journal.rs` (145 LOC) — Atomic journal persistence, phase transitions, and recovery reader.
- `server/src/plugins/worker_supervisor.rs` (777 LOC) — Process group supervision, candidate activation, health ping, drain, and stop.
- `server/src/plugins/admin.rs` (339 LOC) — Host-seeded admin allowlist parsing with group-writable checks, admin RPC DTOs, and redacted audit logging.
- `server/src/api/plugin_admin.rs` (465 LOC) — Bearer-only HTTP management handlers, streaming gzip upload with backpressure, HTTP 411/413 status codes, and revision guard.
- `server/tests/plugin_lifecycle.rs` (533 LOC) — 8 lifecycle integration tests covering update atomicity, crash recovery, rollback security intent preservation, activation failures on install/update/rollback, and unreferenced cleanup.
- `server/tests/plugin_admin_api.rs` (625 LOC) — 6 integration tests covering empty-deny allowlist, bearer guard, upload bounds (HTTP 411/413/415), streaming lifecycle flow, redacted audits, and group-writable config rejection.

### UI Components
- `packages/ui/src/api/ws-transport.ts` (3692 LOC) — Admin RPC endpoint mapping and streaming `uploadPluginStage` via `XMLHttpRequest` with upload progress.
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx` (491 LOC) — Settings UI with stage upload, immutable review card, lifecycle controls, and confirmation modals.
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx` (254 LOC) — 8 Vitest unit tests covering UI states, progress, review, and lifecycle triggers.

---

## 3. Verification of Previous Issues

| Issue / Finding | Severity (Cycle 2) | Cycle 3 Status | Verification Details |
|---|---|---|---|
| **Inverted Publish/Activate in `approve_and_install_stage`** | Critical | **RESOLVED** | Worker activated & pinged before durable registry write. Verified by `test_lifecycle_activation_failure_leaves_registry_untouched` and `test_lifecycle_update_activation_failure_preserves_prior_installation`. |
| **Rollback Sequence and Journal Inconsistency** | Warning | **RESOLVED** | `rollback()` now pre-activates candidate worker using `activate_candidate`, journals `Activating -> Healthy -> Published -> Committed`, and emits failure audit on error. Verified by `test_lifecycle_rollback_activation_failure_preserves_current_installation`. |
| **HTTP Status for Missing `Content-Length`** | Warning | **RESOLVED** | Missing or zero `Content-Length` returns HTTP 411 `LengthRequired` (`LengthRequired` code). Verified by `test_upload_bounds_and_invalid_digest`. |
| **Group-Writable Permissions Check** | Suggestion | **RESOLVED** | `admin.rs:32` tests `perm & 0o022 != 0`. Verified by `test_admin_config_group_writable_rejected`. |
| **Forbidden Browser XHR Header (`Content-Length`)** | Warning | **RESOLVED** | Header removed from `uploadPluginStage`; standard `new Promise` used. |
| **Failure Audit Logging** | Warning | **RESOLVED** | Emits `AdminAuditRecord` with `outcome = "failed"` on candidate activation and publish failures. |

---

## 4. Critical Issues (MUST FIX)

*None observed.*

---

## 5. Warnings (SHOULD FIX)

### 1. Permission Denials and Revision Mismatch Auditing
- **Location:** `server/src/plugins/lifecycle.rs:735, 746, 830, 841, 957, 968, 1074, 1101, 1157, 1169`
- **Observation:** While operational failures in candidate activation and publishing emit `AdminAuditRecord` with `outcome = "failed"`, permission denials (non-admin actor) and concurrent security revision mismatches return `PluginError` without emitting an audit record.
- **Impact:** Security-relevant denial events must be derived from standard web/API server access logs rather than the structured `plugin::admin::audit` stream.
- **Recommendation:** In Phase D06, consider emitting audit records with `outcome = "forbidden"` or `"unauthorized"` for security-sensitive denial paths.

---

## 6. Suggestions (NICE TO HAVE)

### 1. Structured File Sink for Admin Audits
- **Location:** `server/src/plugins/admin.rs:325-339`
- **Observation:** Audit records are written via `tracing::info!(target: "plugin::admin::audit", ...)`.
- **Recommendation:** Prior to Gate G3, configure a dedicated append-only file appender for the `plugin::admin::audit` target to ensure audit trails are preserved across log rotations.

### 2. Candidate Directory Cleanup on Activation Failure
- **Location:** `server/src/plugins/lifecycle.rs:366-384`
- **Observation:** On candidate worker activation failure, extracted package files remain under `packages/<plugin_id>/<version>/<digest>`.
- **Recommendation:** Although unreferenced in `registry-v1.json`, adding an immediate directory cleanup helper keeps the package directory tidy.

---

## 7. Positive Observations

1. **Rock-Solid Rollback Sequence:** Rollback strictly preserves security intent (e.g., disabled status remains disabled) while advancing activation generation monotonically (never rewinds generations).
2. **Durable Journal with Crash Recovery:** The state machine (`Initiated -> Draining -> Stopped -> Activating -> Healthy -> Published -> Committed`) ensures crash recovery can unambiguously commit or abort interrupted transactions.
3. **Comprehensive Test Suite:** 23 Rust tests and 8 UI tests provide comprehensive coverage of edge cases including corrupted workers, stale security revisions, upload size bounds, and permission masks.
4. **Security by Design:** Bearer-only management routes reject cookie-only and `--no-auth` requests by design, eliminating CSRF attack surfaces.

---

## 8. Validation Commands & Results

### Rust Backend Tests
```bash
cd server && cargo test --test plugin_admin_api --test plugin_lifecycle --test plugin_api_integration --test plugin_runner_supervision
```
**Output:**
```text
running 6 tests (plugin_admin_api)
test test_redacted_audit ... ok
test test_admin_config_group_writable_rejected ... ok
test test_upload_bounds_and_invalid_digest ... ok
test test_empty_deny_allowlist ... ok
test test_bearer_only_mutation_rejects_cookie_and_no_auth ... ok
test test_streaming_stage_and_approve_and_lifecycle_flow ... ok
test result: ok. 6 passed; 0 failed; 0 ignored; finished in 11.28s

running 8 tests (plugin_lifecycle)
test test_lifecycle_crash_recovery ... ok
test test_lifecycle_activation_failure_leaves_registry_untouched ... ok
test test_lifecycle_remove_and_unreferenced_cleanup ... ok
test test_lifecycle_enable_disable_persistence ... ok
test test_lifecycle_rollback_preserves_current_security_intent ... ok
test test_lifecycle_rollback_activation_failure_preserves_current_installation ... ok
test test_lifecycle_update_activation_failure_preserves_prior_installation ... ok
test test_lifecycle_update_atomicity_and_drain ... ok
test result: ok. 8 passed; 0 failed; 0 ignored; finished in 11.10s

running 3 tests (plugin_api_integration)
test test_result: ok. 3 passed; 0 failed; 0 ignored; finished in 5.42s

running 6 tests (plugin_runner_supervision)
test test_result: ok. 6 passed; 0 failed; 0 ignored; finished in 5.67s

Total: 23 passed, 0 failed, 0 ignored
```

### UI Tests & Typecheck
```bash
pnpm --filter @dam-hopper/ui test PluginManagementSection
pnpm --filter @dam-hopper/ui build
```
**Output:**
```text
PluginManagementSection.test.tsx: 8 passed (8)
tsc -p tsconfig.json: 0 errors
```

---

## 9. Unresolved Questions

*None.* All technical and architectural questions for Phase D05 are resolved.

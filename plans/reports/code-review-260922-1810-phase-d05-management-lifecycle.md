# Code Review: Phase D05 — Management API and Transactional Plugin Lifecycle

**Date:** 2026-09-22  
**Reviewer:** D05Reviewer  
**Plan:** plans/260920-1603-plugin-platform/phase-05-management-and-lifecycle.md  
**Overall Score:** 8.5 / 10  

---

## 1. Executive Summary

Phase D05 introduces root-seeded admin authorization, bearer-only management endpoints, a durable per-installation lifecycle coordinator with a crash-resilient journal, atomic generation publishing, single-level rollback isolating non-security snapshots from security intent, safe unreferenced package garbage collection, and a complete Settings UI section for staging, inspecting, approving, and managing plugin instances.

Overall implementation quality is high, adhering closely to the architectural specifications and requirements with strict type safety, defensive validation, and comprehensive automated test coverage (10 Rust unit/integration tests and 8 Vitest UI component tests passing).

---

## 2. Reviewed Files

### Server Components
- `server/src/plugins/admin.rs` (339 LOC) — Host-seeded admin subject loading, world-writable permission check, admin RPC DTOs, redacted audit logging.
- `server/src/plugins/lifecycle_journal.rs` (209 LOC) — Strict durable transaction records, phases, atomic writes with fsync (`atomic_write_file` + `sync_dir`), startup crash recovery listing.
- `server/src/plugins/lifecycle.rs` (1191 LOC) — Per-installation lock coordinator, stage approval, matched-pair rollback, enable, disable, safe unreferenced package deletion, security revision checking, crash recovery.
- `server/src/api/plugin_admin.rs` (455 LOC) — Bearer-only HTTP management handlers, streaming gzip upload with backpressure, payload size limits, digest and revision enforcement.
- `server/src/api/auth.rs` (diff +68 lines) — Credential mechanism tracking (`Bearer`, `Cookie`, `NoAuthDev`), `require_bearer_auth` middleware rejecting cookie/no-auth mutation.
- `server/src/api/router.rs` (diff +60 lines) — Route mounting under layered `require_auth` + `require_bearer_auth`, payload body limits.
- `server/src/plugins/runner_server.rs` (diff +193 lines) — Management method dispatch over UDS RPC socket.
- `server/src/plugins/runner_client.rs` (diff +190 lines) — Client RPC methods for management stage/approve/rollback/enable/disable/remove.
- `server/src/plugins/worker_supervisor.rs` (diff +71 lines) — `SupervisorManager` lifecycle methods (`drain_and_stop`, `get_or_create`, status query).
- `server/src/plugins/registry_state.rs` (diff +57 lines) — `RollbackPackageSnapshot` (package-only, no security data), `SecurityIntent`, `InstallationRecord` generation validation.
- `server/src/bin/dam-hopper-plugin-runner.rs` (diff +13 lines) — `--admin-config` CLI flag and host-seeded config loader integration.
- `server/tests/plugin_admin_api.rs` (570 LOC) — 5 comprehensive integration tests for allowlist, bearer guard, upload bounds, full lifecycle, and audit redaction.
- `server/tests/plugin_lifecycle.rs` (384 LOC) — 5 lifecycle tests for update atomicity, rollback security intent preservation, enable/disable persistence, unreferenced retention, and crash recovery.

### UI Components
- `packages/ui/src/api/plugin-types.ts` (diff +96 lines) — DTO interfaces for admin installations, stage review, rollback snapshots, and lifecycle revision push events.
- `packages/ui/src/api/client.ts` (diff +133 lines) — `ApiClient["plugins"]` methods for admin management and lifecycle subscription.
- `packages/ui/src/api/ws-transport.ts` (diff +144 lines) — HTTP endpoint routing and streaming `uploadPluginStage` using `XMLHttpRequest` with progress events.
- `packages/ui/src/api/connections.ts` (diff +18 lines) — `getApiClientForProfile` helper.
- `packages/ui/src/components/pages/SettingsPage.tsx` (diff +8 lines) — Accordion integration of `PluginManagementSection`.
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.tsx` (491 LOC) — Management UI with stage upload, progress bar, immutable review card, lifecycle controls, and confirmation dialogs.
- `packages/ui/src/components/pages/settings-page/PluginManagementSection.test.tsx` (482 LOC) — 8 Vitest unit tests covering unauthorized state, empty state, plugin listing, disable, stage upload, approval, rollback dialog, and remove dialog.

---

## 3. Critical Issues (MUST FIX)

### 1. Inverted Publish/Activate Sequence in `approve_and_install_stage` (Req 8 & 31)
- **Location:** `server/src/plugins/lifecycle.rs:353-449`
- **Issue:** `self.registry.write_state(&fresh_state)` commits the candidate package and advances the installation generation to disk *before* `self.supervisor_manager.get_or_create(&installation_id).await?.activate().await` runs. If worker candidate activation or healthcheck fails at line 433, `approve_and_install_stage` returns an error, but the candidate package remains committed in `registry-v1.json`. Any subsequent API call or restart serves the failed candidate version in `plugin.list` and UI asset endpoints.
- **Requirement Violation:** Req 8: *"Publish only after backend handshake/health and exact UI digest validation"*; Req 31: *"UI/navigation must never advertise a candidate whose worker failed health"*; Req 120/140: *"Implement failure rollback from the previous matched pair."*
- **Fix:** If candidate worker activation fails in `approve_and_install_stage`, revert registry state (restore `existing_inst` if an update, or remove if a fresh install) before returning `Err`, or activate and health-check the candidate worker prior to durable registry publish.

---

## 4. Warnings (SHOULD FIX)

### 1. Incomplete Audit Logging on Denials and Failures (Req 6)
- **Location:** `server/src/plugins/lifecycle.rs`, `server/src/api/plugin_admin.rs`
- **Issue:** `record_admin_audit` is currently only invoked on successful completion (`outcome = "success"`). Failed operations (e.g. revision mismatches, unauthorized actor attempts, validation failures, worker activation failures) do not emit audit records.
- **Fix:** Emit `AdminAuditRecord` with `outcome = "failed"` or `"forbidden"` on error exit paths in `lifecycle.rs` and `plugin_admin.rs`.

### 2. Forbidden Header in Browser XHR (`Content-Length`)
- **Location:** `packages/ui/src/api/ws-transport.ts:2680`
- **Issue:** `xhr.setRequestHeader("Content-Length", String(file.size))` attempts to set `Content-Length`. In browser environments, `Content-Length` is on the WHATWG/W3C list of forbidden request headers. Browsers automatically compute and send `Content-Length` on `xhr.send(file)`, but `setRequestHeader` triggers browser console warnings.
- **Fix:** Remove explicit `Content-Length` header setting from `uploadPluginStage` in `ws-transport.ts` (let browser set it), or guard it inside `try { ... } catch {}`.

### 3. HTTP Status for Missing `Content-Length`
- **Location:** `server/src/api/plugin_admin.rs:122-134`
- **Issue:** When `Content-Length` header is absent, `unwrap_or(0)` evaluates to `0`, which returns HTTP 413 `PAYLOAD_TOO_LARGE` ("Invalid Content-Length: must be between 1 and 33554432 bytes").
- **Fix:** If `Content-Length` header is missing, return HTTP 411 `LENGTH_REQUIRED` or HTTP 400 `BAD_REQUEST`.

---

## 5. Suggestions (NICE TO HAVE)

### 1. Group-Writable File Permission Check
- **Location:** `server/src/plugins/admin.rs:32`
- **Issue:** `perm & 0o002 != 0` checks only other-writable bit. If admin config file permissions are `0o664` and group is non-root, group members could edit the file.
- **Recommendation:** Check `perm & 0o022 != 0` for stricter host permission safety.

### 2. Conditionally Hide Accordion on `SettingsPage` for Non-Admins (Req 107)
- **Location:** `packages/ui/src/components/pages/SettingsPage.tsx:407-412`
- **Issue:** The `SettingsSectionAccordion` titled "Plugin Platform" is rendered for all users. Clicking it displays the "Administrator Access Required" card.
- **Recommendation:** Query or probe admin status, or collapse/hide the accordion when unauthorized, to keep the Settings page clean for non-administrative users.

---

## 6. Positive Observations

1. **Strict Decoupling of Security Intent from Rollback:** `RollbackPackageSnapshot` intentionally omits grants, enabled status, and security revisions. Rollback advances activation generation monotonically and strictly preserves current disabled intent and revoked grants.
2. **Robust Multi-Layer Auth Architecture:** `require_auth` (JWT validation) layered with `require_bearer_auth` (rejects `--no-auth` and cookie credentials) reliably enforces bearer-only administration.
3. **Stream Backpressure and Early Cutoff:** `stage_package_upload_handler` validates Content-Type, Content-Length, and SHA-256 header upfront, stream-chunks data with bounded base64 buffers, and aborts immediately if stream exceeds maximum package size.
4. **Reference-Safe Cleanup:** `remove` verifies whether package digests are referenced by any other installation or rollback snapshot before removing files on disk, and never accesses workspace project roots.
5. **Durable Journaling:** Uses atomic writes with directory sync (`atomic_write_file` and `sync_dir`), UUID validation, and startup recovery that cleanly transitions interrupted transactions.

---

## 7. Validation Commands & Results

- **Rust Test Suite:**
  ```bash
  cargo test --manifest-path server/Cargo.toml --test plugin_admin_api --test plugin_lifecycle
  ```
  **Result:** 10 passed (5 in `plugin_admin_api`, 5 in `plugin_lifecycle`), 0 failed, 0 ignored (11.06s).

- **UI Test Suite:**
  ```bash
  pnpm --filter @dam-hopper/ui test PluginManagementSection
  ```
  **Result:** 1 test file passed, 8 tests passed, 0 failed (833ms).

---

## 8. Unresolved Questions

1. **Candidate Activation Failure Recovery Policy:** Should candidate worker activation failure during an update automatically roll back to the previously running worker, or mark the installation in an explicit `Unavailable` state pending manual admin action?
2. **Audit Log Persistence Sink:** Audit records currently emit via `tracing::info!(target: "plugin::admin::audit", ...)`. Is a dedicated durable file/database audit sink required prior to Gate G3?

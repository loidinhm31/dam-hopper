# Validation Report: Device Login Management

- **Phase**: `phase-03-validation`
- **Plan**: `plans/261022-0322-device-login-management`
- **Branch**: `feat/device-login-management`
- **Status**: **Partial Validation — Application E2E Failed; Live Revocation Cutoff Pending**
- **Date**: 2026-10-22

---

## 1. Test Results Overview

| Tier / Suite | Command | Result | Pass | Fail | Skip / Ignore | Time |
|---|---|---|---|---|---|---|
| **Aggregate Runner Baseline** | `bash scripts/run-all-tests.sh` | FAILED (Fast fail) | - | 1 | - | 496.20s |
| **Rust Server Tests (without Mongo)** | `pnpm test` (inside aggregate) | FAILED (exit 101) | ~1950 | 6 | 7 | 496.20s |
| **Rust Server Tests (with isolated Mongo)** | `TEST_MONGODB_URI="mongodb://127.0.0.1:27017" cargo test --manifest-path server/Cargo.toml` | **PASS** | 2015 | 0 | 7 | 103.35s |
| **Shared Package Tests** | `CI=1 pnpm --filter @dam-hopper/shared test` | **PASS** | 15 (2 files) | 0 | 0 | 0.16s |
| **Browser Bridge Tests** | `CI=1 pnpm --filter @dam-hopper/browser-bridge test` | **PASS** | 19 (5 files) | 0 | 0 | 0.48s |
| **UI Unit Tests** | `CI=1 pnpm --filter @dam-hopper/ui test` | **PASS** | 3115 (338 files) | 0 | 0 | 27.20s |
| *— Targeted New UI Feature Unit Tests* | `vitest run LoginDevicesSection.test.tsx auth-client.test.ts ServerSettingsDialog.test.tsx` | **PASS** | 61 (3 files) | 0 | 0 | 1.19s |
| **Native Host Tests** | `CI=1 pnpm --filter @dam-hopper/native test` | **PASS** | 48 (4 files) | 0 | 0 | 1.60s |
| **UI Browser Tests** | `CI=1 pnpm --filter @dam-hopper/ui test:browser` | **PASS** | 326 (58 files) | 0 | 4 (2 files) | 82.80s |
| *— Targeted Login Devices Browser Test* | `vitest run --config vitest.browser.config.ts login-devices.browser.tsx` | **PASS** | 2 (1 file) | 0 | 0 | 2.09s |
| **Application E2E Test** | `CONTAINER_ENGINE=docker E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts` | **FAILED** | 0 | 1 | 0 | 124.09s |
| **Native SSH-Forward E2E** | `RUN_NATIVE_E2E=0` | SKIPPED | - | - | - | - |

---

## 2. Static Analysis & Build Verification

| Check | Command | Status | Notes |
|---|---|---|---|
| **Web & Extension Build** | `pnpm build` | **PASS** | `apps/browser-extension` + `apps/web` compiled cleanly via Vite (38.40s) |
| **Linter** | `pnpm lint` | **PASS** | 0 errors, 170 warnings across codebase (2 in modified files: unused imports) |
| **UI E2E Typecheck** | `pnpm --filter @dam-hopper/ui test:e2e:typecheck` | **PASS** | `tsc -p tsconfig.e2e.json` exited 0 (1.86s) |
| **Server Examples Typecheck** | `cargo check --manifest-path server/Cargo.toml --examples` | **PASS** | Clean compilation |
| **E2E Seed Executable Build** | `cargo build --manifest-path server/Cargo.toml --example application_e2e_seed` | **PASS** | Built target binary successfully (0.24s) |
| **E2E Runtime Image Build** | `CONTAINER_ENGINE=docker pnpm --filter @dam-hopper/ui test:e2e:build-images` | **PASS** | Built `dam-hopper:production-test` (511.35s) |

---

## 3. Targeted Feature Test Breakdown

### 3.1 Backend Store & Route Regressions (`server/tests/`)
- `auth_device_session_store.rs` (2 tests, 0.08s):
  * `sqlite_inventory_and_concurrent_owner_revocation`: PASS. Bounded fetch-51/page-50 keyset pagination, timestamp-tie resolution, foreign/missing isolation, concurrent revoke idempotency.
  * `mongodb_inventory_and_concurrent_owner_revocation`: PASS with isolated `TEST_MONGODB_URI` (MongoDB 8.2 container). Full parity verified against SQLite contract.
- `auth_device_sessions.rs` (5 tests, 1.72s):
  * `errors_are_non_cacheable_and_bad_cursors_never_list_sessions`: PASS.
  * `existing_auth_policy_denials_and_query_extractor_errors_remain_non_cacheable`: PASS.
  * `cookie_auth_is_owner_scoped_and_self_revoke_clears_cookie`: PASS.
  * `revoke_is_owner_scoped_idempotent_and_preserves_surviving_credentials`: PASS.
  * `paginated_list_has_tie_safe_continuation_current_marker_and_only_public_fields`: PASS.
- `auth_device_session_failures.rs` (1 test, 0.86s):
  * `authenticated_inventory_and_mutation_storage_failures_are_non_cacheable`: PASS.
- `auth_session_metadata.rs` (1 test, 4.56s):
  * `full_mfa_sessions_capture_bounded_optional_metadata_and_stepup_preserves_it`: PASS (multibyte truncation, <=512 byte limit, step-up preservation).
- `auth_sqlite_store.rs` (20 tests, 0.05s):
  * `version_one_upgrade_preserves_user_and_session_and_reopens_idempotently`: PASS (v1 schema with existing sessions upgraded to v2 without data loss; reopen safe).
- `auth_no_auth.rs` (14 tests, 2.44s):
  * `device_sessions_are_explicitly_unavailable_without_authentication`: PASS (HTTP 409 `DEVICE_SESSIONS_UNAVAILABLE`).

### 3.2 Frontend Unit & Browser Regressions (`packages/ui/`)
- `auth-client.test.ts` (19 tests): PASS. DTO boundary decoding, strict date parsing, explicit bearer omitting cookies, 409 handling, non-204 error handling.
- `LoginDevicesSection.test.tsx` (12 tests): PASS. Loading/empty/unsupported states, retry on list/mutation errors, refresh, load more, ConfirmDialog lifecycle, self-revoke warning.
- `ServerSettingsDialog.test.tsx` (30 tests): PASS. Selected saved profile authority, unsaved draft isolation, profile deletion/retirement handling.
- `login-devices.browser.tsx` (2 tests, 2.09s): PASS at 320x667 and 320x420 viewports. Client hint wrapping without horizontal overflow (`scrollWidth <= clientWidth`), list scroll container bounded (`<= 256px`), dialog action buttons visible and keyboard accessible.

---

## 4. Failed Tests & Blocking Issues

### 4.1 Application E2E Failure: `device-login-management.spec.ts`
- **Command**: `CONTAINER_ENGINE=docker E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui test:e2e device-login-management/device-login-management.spec.ts`
- **Status**: **FAILED** (timeout after 120,000ms)
- **Failure Location**: `packages/ui/e2e/device-login-management/device-login-management.spec.ts:73:18`
- **Error Output**:
  ```text
  Test timeout of 120000ms exceeded.
  Error: locator.scrollIntoViewIfNeeded: Target page, context or browser has been closed
  Call log:
    - waiting for getByRole('region', { name: 'Login devices' }).locator('li[data-session-id="..."]')
  ```
- **Diagnostic Analysis**:
  * Lines 1–70 succeeded: Real MFA challenge/enrollment issued a sibling session; `/api/auth/sessions` returned 2 sessions; other session contained `<script>not markup</script>`; foreign session DELETE returned 404; browser navigated to `/workspace`; opened Server Settings Dialog; verified "This session", "Unknown browser/client", and other row; opened and cancelled revoke confirmation; confirmed sibling token remained authorized.
  * Line 72 executed `await page.setViewportSize({ width: 320, height: 667 })`.
  * In `WorkspacePage`, transitioning to compact viewport triggers shell replacement (`TerminalWorkspaceShell` -> `MobileWorkspaceShell`). Each shell mounts an independent `TopNav` instance with local dialog state (`serverSettingsOpen`, `editingProfile`).
  * As a result of unmounting desktop `TopNav`, `ServerSettingsDialog` was unmounted and closed.
  * Line 73 `await otherRow.scrollIntoViewIfNeeded()` waited for the session row inside the unmounted dialog until test timeout expired (120s).
  * Because the test timed out, no evidence checkpoints were finalized or published to `packages/ui/e2e/device-login-management/`.

### 4.2 Aggregate Suite Baseline Blockers (Resolved/Identified)
1. `scripts/run-all-tests.sh` had permission mode `100644` in git (not executable directly; runs under `bash scripts/run-all-tests.sh`).
2. Without `TEST_MONGODB_URI` set, `server/tests/host_resource_sse_qualification.rs` panicked (as designed: skipping is disallowed for qualification). Resolved by provisioning isolated loopback MongoDB container (`mongo:8.2` on 127.0.0.1:27017).
3. `node-diff3` dependency resolution in `packages/ui` resolved cleanly via `pnpm install --frozen-lockfile` without modifying tracked files.
4. Initial E2E run timed out at 60s during in-fixture podman container build; resolved by pre-building `dam-hopper:production-test` via `CONTAINER_ENGINE=docker pnpm --filter @dam-hopper/ui test:e2e:build-images`.

---

## 5. Security & Cutoff Observations (Pending Parent Handoff)

Per `phase-03-validation.md` contract, the following live behaviors are **not yet qualified**:
1. Live WS revocation cutoff within 10s acceptance window (`server/src/api/ws.rs` 5s poll + 2s timeout).
2. Live resource SSE termination within 10s window (`server/src/api/resource_events.rs`).
3. Large/throttled media stream cutoff across 5s elapsed read boundary (`server/src/api/media_stream_response.rs`).
4. Sibling-capability ticket survival after targeted session revocation.
5. Replacement-login / clearing-cookie race safety under concurrent browser sessions.

---

## 6. Recommendations & Actionable Remediation

1. **Fix E2E Test or Dialog State Persistence**:
   - Option A (Test adjustment): Separate desktop and 320px responsive checks into dedicated test cases with viewport configured upfront in `test.use({ viewport: ... })`, or reopen server settings via mobile menu after viewport resize.
   - Option B (UX persistence): Hoist `serverSettingsOpen` and `editingProfile` dialog state out of `TopNav` into shared workspace store or parent layout so resizing across shell boundaries does not unmount active dialogs.
2. **Execute Full App Journey to Completion**:
   - Re-run `device-login-management.spec.ts` with `E2E_CAPTURE=1` once dialog lifecycle at 320px is resolved to capture and publish evidence checkpoints (`desktop-login-devices`, `narrow-login-devices`, `narrow-self-revoke-confirmation`).
3. **Execute Live Parent Validation**:
   - Perform live HTTP/WS/media/SSE smoke and interactive browser verification.

---

## 7. Unresolved Questions

1. Is `ServerSettingsDialog` expected to survive dynamic viewport resizing across the compact workspace threshold without unmounting, or should desktop and mobile journeys be validated as distinct initial viewports?
2. Does the project intend to update `scripts/run-all-tests.sh` git file mode to `100755` in a separate maintenance branch?

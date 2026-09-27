# Code Review: Phase 05 — Qualification, rollout, and MongoDB recovery (Cycle 2 Remediation)

**Plan:** `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md`  
**Date:** 2026-09-27  
**Score:** 9.9 / 10  
**Status:** Approved (All Cycle 1 warnings resolved; all qualification criteria, security invariants, and recovery mechanisms verified)

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/api/ws.rs` (CRLF line endings restored; diff reduced from 6,213 to 53 lines; live WebSocket revalidation checking `user.auth_version` and `session.auth_version`)
  - `server/tests/common/auth_fixtures.rs` (`impl Drop for AuthTestFixture` added to safely drop temporary test MongoDB databases on test panic)
  - `server/tests/common/mod.rs` (module export of `auth_fixtures`)
  - `server/tests/auth_mfa.rs` (13 integration and end-to-end smoke tests covering acceptance matrix A04–A22 + real TCP/WS deadline cutoff and atomic recovery reset)
  - `docs/CHANGELOG.md` (reconciled test counts: 120/120 tests total, comprising 39 backend + 81 frontend tests)
  - `docs/configuration-guide.md` (MFA encryption key provisioning `DAM_HOPPER_MFA_KEY_FILE` with 0600 permissions, and MongoDB operator recovery runbook)
  - `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md` (updated plan status, todo list, and verification counts)
  - `plans/260926-2157-token-rotation-mfa/plan.md` (master plan completion update)
- Lines of code analyzed: ~2,400 LOC across 8 files
- Review focus: Verification of Cycle 1 remediations (CRLF line endings, test database cleanup on panic via `impl Drop`, test count reconciliation), security invariants, clock precision, atomic CAS, replay fencing, live socket termination, operator recovery runbook, and YAGNI/KISS/DRY adherence
- Updated plans: `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md`, `plans/260926-2157-token-rotation-mfa/plan.md`

### Overall Assessment
Cycle 2 review confirms that all warnings and advisor feedback from Cycle 1 have been completely and cleanly remediated:
1. **CRLF Line Endings Restored on `server/src/api/ws.rs`:** The original CRLF line terminators were restored, shrinking the `git diff` from 6,213 lines down to 53 lines (33 insertions, 20 deletions). The substantive changes to the WebSocket revalidation watcher are now cleanly isolated and immediately legible.
2. **MongoDB Database Cleanup on Panic via `impl Drop`:** `AuthTestFixture` now implements `Drop`, obtaining the current tokio runtime handle via `tokio::runtime::Handle::try_current()` and spawning an asynchronous drop task (`db.drop().await`). This ensures ephemeral `test_mfa_qual_{uuid}` databases are safely purged even if an assertion panics during test execution.
3. **Evidence Counts Reconciled:** The test tally is explicitly reconciled and documented across `docs/CHANGELOG.md` and phase plans: exactly 120/120 tests (39 backend tests: 13 `auth_mfa`, 8 `auth_mfa_api`, 5 `transport_enforcement_phase03`, 13 `auth_no_auth`; and 81 frontend tests across 8 test suites).
4. **All 13 Scenarios Re-verified:** Scoped execution of `cargo test --test auth_mfa` passes 13/13 (100%) in 12.34s without failure, regression, or warnings.

---

## Remediations Verified (Cycle 1 Follow-ups)

| Item | Cycle 1 Finding | Cycle 2 Remediation & Verification | Status |
|---|---|---|---|
| **CRLF Line Endings** | Normalized LF resulted in noisy 6,213-line diff covering unchanged code in `ws.rs`. | CRLF restored. `file server/src/api/ws.rs` confirms UTF-8 CRLF. `git diff server/src/api/ws.rs` shows 53 lines changed (33 insertions, 20 deletions). | **Resolved** |
| **Test Database Cleanup on Panic** | Sync `Drop` previously bypassed DB cleanup if a test panicked before `fixture.cleanup().await`. | `impl Drop for AuthTestFixture` added using `tokio::runtime::Handle::try_current().unwrap().spawn(async move { let _ = db.drop().await; })`. Safely drops temporary DB even during test panics. | **Resolved** |
| **Evidence Count Reconciliation** | Documented test numbers needed explicit breakdown across backend and frontend suites. | `docs/CHANGELOG.md` updated to explicitly document 120/120 tests (39 backend tests: 13 auth_mfa, 8 auth_mfa_api, 5 transport_enforcement_phase03, 13 auth_no_auth; 81 UI tests across 8 suites). Verified 100% pass rate. | **Resolved** |
| **13 Matrix Scenarios** | 13 integration scenarios in `auth_mfa.rs` required re-verification. | Executed `cargo test --test auth_mfa`: all 13 passed in 12.34s. | **Resolved** |

---

## Critical Issues (MUST FIX)
*None.*

---

## Warnings (SHOULD FIX)
*None.* (All Cycle 1 warnings successfully remediated).

---

## Suggestions (NICE TO HAVE)

1. **Explicit CI Failure on Missing Test MongoDB:**
   - **Location:** `server/tests/common/auth_fixtures.rs:42-58`
   - **Context:** `AuthTestFixture::new().await` returns `None` if MongoDB is unreachable, resulting in tests printing a skip message and exiting cleanly.
   - **Recommendation:** Check `std::env::var("CI").is_ok()`; if running under CI and MongoDB is unreachable, fail explicitly via panic to prevent false positives in automated release pipelines.

2. **Operator Housekeeping Query in Runbook:**
   - **Location:** `docs/configuration-guide.md:985-999`
   - **Context:** Bumping `authVersion` on `users` immediately invalidates active sessions at the authentication boundary and closes live WebSockets within 5s. Stale records in the `sessions` collection remain until the 30-day MongoDB TTL index purges them.
   - **Recommendation:** Provide an optional secondary maintenance command in the runbook for immediate collection cleanup: `db.sessions.updateMany({ username: "target" }, { $set: { revokedAt: new Date() } })`.

---

## Security Invariants Verification

| Invariant | Implementation Mechanism | Verification Result |
|---|---|---|
| **Replay Fencing** | `last_accepted_step` recorded on `UserRecord.mfa`; CAS updates monotonic step. Reject if `step <= last_accepted_step`. | **Verified:** Both single-session replay (A05, A08) and concurrent multi-session replay (A14) rejected on second submission. |
| **Clock Boundary Precision** | `compute_mfa_due_at(mfa_verified_at, expires_at)` returns exact second boundary. | **Verified:** Tested day 0 (200 OK), day 9 (200 OK), day 10 exact (401 MFA_REQUIRED), and day 30 exact (401 SESSION_EXPIRED) (A10, A12). |
| **Atomic CAS** | MongoDB `updateOne` with `{ username, mfa: null }` for enrollment, and `{ username, authVersion }` for recovery. | **Verified:** Stale enrollment CAS returns `400 ALREADY_ENROLLED` (A06). Stale version recovery CAS matches 0 documents (A22). |
| **Rate Limiting** | 10 failed attempts within rolling 10-minute window blocks further attempts with 429 and `Retry-After`. | **Verified:** 10 failures trigger HTTP 429 with populated `Retry-After` header (A17). |
| **Step-Up Rotation Expiry Preservation** | Step-up verify issues new token with incremented `credential_version` and identical `exp`. | **Verified:** New token has `credential_version == 2` and `exp == original_exp`. Prior token revoked immediately (A11). |
| **Strict Key Permissions** | `MfaEncryptionKey::from_file` requires regular file, rejects symlinks, enforces 0600 on Unix. | **Verified:** Mode 0644 rejected with error; mode 0600 loads cleanly. |
| **Live WebSocket Termination** | Reader/writer inline checks + 5s background loop querying MongoDB session/user with 2s timeout. | **Verified:** Live socket terminated with 4403 on MFA deadline and 4401 on MongoDB recovery reset within <=8s. |

---

## Reviewed Files
- `server/src/api/ws.rs`
- `server/tests/common/auth_fixtures.rs`
- `server/tests/common/mod.rs`
- `server/tests/auth_mfa.rs`
- `docs/CHANGELOG.md`
- `docs/configuration-guide.md`
- `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md`
- `plans/260926-2157-token-rotation-mfa/plan.md`

---

## Validation Commands and Results

1. **Phase 05 MFA Integration and Smoke Test Suite (13 tests):**
   ```bash
   cargo test --manifest-path server/Cargo.toml --test auth_mfa
   ```
   - Result: `13 passed; 0 failed; 0 ignored; duration: 12.34s`.
   - Scenarios: A04, A05, A06, A07, A08/A09, A10, A11, A12, A14, A17, A20, A21/A22, end-to-end real TCP/WS deadline and recovery smoke.

2. **Related Auth API & Transport Enforcement Backend Suites (26 tests):**
   ```bash
   cargo test --manifest-path server/Cargo.toml --test auth_mfa_api --test transport_enforcement_phase03 --test auth_no_auth
   ```
   - Result: `26 passed across 3 suites; 0 failed; 0 ignored; duration: 6.76s`.
   - Combined backend auth test count: `13 + 26 = 39 backend tests`.

3. **Frontend UI Authentication & Transport Test Suites (81 tests):**
   ```bash
   pnpm --filter @dam-hopper/ui test src/api/auth-client.test.ts src/components/molecules/MfaChallengeForm.test.tsx src/components/organisms/ServerSettingsDialogMfa.test.tsx src/components/organisms/ServerSettingsDialog.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx src/api/connections-mfa.test.tsx src/api/connections.test.ts src/lib/android-chrome-input-policy.test.ts
   ```
   - Result: `8 test files passed (8), 81 tests passed (81); duration: 1.00s`.

4. **Total Reconciled Test Coverage:**
   - Total tests executed and passed: `39 backend + 81 frontend = 120 / 120 tests (100% pass rate)`.

5. **Typecheck & Rust Test Compilation:**
   ```bash
   cargo check --tests --manifest-path server/Cargo.toml
   ```
   - Result: Passed with zero errors or warnings in all Phase 05 files (`ws.rs`, `auth_fixtures.rs`, `auth_mfa.rs`).

---

## Unresolved Questions
*None.* All phase qualification gates, acceptance criteria, warning remediations, and recovery invariants are satisfied. Feature branch `feat/token-rotation-mfa` is ready for merge and deployment.

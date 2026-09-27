# Code Review: Phase 05 — Qualification, rollout, and MongoDB recovery

**Plan:** `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md`  
**Date:** 2026-09-27  
**Score:** 9.6 / 10  
**Status:** Approved (All qualification criteria, acceptance tests, and recovery invariants verified)

---

## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/api/ws.rs` (live WebSocket revalidation bugfix checking `user.auth_version` and `session.auth_version`)
  - `server/tests/common/auth_fixtures.rs` (reusable `AuthTestFixture` for MongoDB and MFA integration tests)
  - `server/tests/common/mod.rs` (module export of `auth_fixtures`)
  - `server/tests/auth_mfa.rs` (13 integration and end-to-end smoke tests covering matrix A04–A22 + real TCP/WS deadline cutoff and atomic recovery reset)
  - `docs/CHANGELOG.md` (Phase 05 completion changelog entry)
  - `docs/configuration-guide.md` (MFA encryption key provisioning and MongoDB operator recovery runbook)
  - `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md` (task status and todo updates)
  - `plans/260926-2157-token-rotation-mfa/plan.md` (master plan completion update)
- Lines of code analyzed: ~2,400 LOC across 8 files
- Review focus: Qualification criteria, security invariants, clock precision, atomic CAS, replay fencing, live socket termination, operator recovery runbook, and YAGNI/KISS/DRY adherence
- Updated plans: `plans/260926-2157-token-rotation-mfa/phase-05-qualification-and-rollout.md`, `plans/260926-2157-token-rotation-mfa/plan.md`

### Overall Assessment
Phase 05 delivers comprehensive integration, smoke, and qualification verification for the mandatory TOTP, 10-day MFA check, 30-day token rotation, and MongoDB recovery specification:
- `server/src/api/ws.rs` properly strengthens the periodic background revalidation watcher (5s interval, 2s DB timeout) by checking `user.auth_version != auth_version || session.auth_version != user.auth_version`, guaranteeing that an operator atomic recovery reset terminates live WebSockets within <= 7-8s with close code `4401` (`CLOSE_FULL_LOGIN_REQUIRED`).
- `server/tests/common/auth_fixtures.rs` provides an isolated, robust test harness connecting to an isolated test database with unique names (`test_mfa_qual_{uuid}`), indexing, `MockClock`, bcrypt password hashing, and AES-256-GCM TOTP secret encryption.
- `server/tests/auth_mfa.rs` exercises 13 comprehensive test scenarios covering the full acceptance matrix: setup QR/manual key consistency (A04), bad/malformed/replayed first code (A05), concurrent enrollment CAS (A06), password requiring MFA (A07), TOTP window skew and replay prevention (A08-A09), Day 10 cutoff (A10), credentialVersion step-up rotation preserving Day 30 expiry (A11), Day 30 absolute expiry (A12), independent multi-session isolation with account-wide replay fencing (A14), 10-attempt rate limiting and Retry-After lockout (A17), durable logout revocation (A20), atomic MongoDB CAS recovery reset and version guard (A21-A22), and end-to-end real TCP/WebSocket deadline and recovery cutoff.
- `docs/configuration-guide.md` and `docs/CHANGELOG.md` document strict MFA key permissions (`chmod 600`), key format, and the exact MongoDB atomic CAS update predicate.
- Scoped test suites pass 100% (13/13 in `auth_mfa`, 26/26 in related auth suites, 81/81 in UI suites).

---

## Critical Issues (MUST FIX)
*None.*

---

## Warnings (SHOULD FIX)

1. **Line-Ending Normalization (CRLF -> LF) in `server/src/api/ws.rs`:**
   - **Location:** `server/src/api/ws.rs`
   - **Context:** Commit `768b33b8` originally introduced Windows CRLF line endings (`\r\n`) to `ws.rs`. In Phase 05, editing the file on Linux normalized all line endings to LF (`\n`). While LF conforms with repository standards (`.gitattributes` specifies LF and all other server Rust files are LF), standard `git diff server/src/api/ws.rs` displays a 6,213-line diff (the whole file).
   - **Impact:** Substantive logic changes (~49 lines) are obscured unless viewed with `git diff -w` / `--ignore-space-at-eol`.
   - **Remediation:** Keep LF normalization to standardize line endings with the rest of the codebase, but ensure commit descriptions note the line ending normalization so reviewers understand the diff breakdown.

2. **MongoDB Database Cleanup on Test Panic:**
   - **Location:** `server/tests/common/auth_fixtures.rs:243-245`
   - **Context:** Fixture cleanup calls `fixture.cleanup().await` at the end of each test. If a test panics midway (e.g. assertion failure), `cleanup()` is bypassed because Rust synchronous `Drop` cannot easily execute async MongoDB database drop.
   - **Impact:** Failed test runs may leave behind temporary collections/databases named `test_mfa_qual_{uuid}` in the test MongoDB instance.
   - **Remediation:** In subsequent test harness maintenance, introduce a cleanup sweep before test suite runs to drop any orphaned `test_mfa_qual_*` databases, or provide a sync wrapper running a short runtime block for drop.

---

## Suggestions (NICE TO HAVE)

1. **Explicit CI Failure on Missing Test MongoDB:**
   - **Location:** `server/tests/auth_mfa.rs:22-25` (and throughout all 13 tests)
   - **Context:** `AuthTestFixture::new().await` returns `None` if MongoDB is unreachable, printing `"Skipping test: MongoDB unavailable"` and returning early.
   - **Impact:** Locally this is convenient for quick unit testing, but in automated CI pipelines, an offline MongoDB could result in false positives (a passing test run that actually skipped all 13 auth tests).
   - **Recommendation:** Check `std::env::var("CI")` or `std::env::var("RELEASE_QUALIFICATION")`; if set and MongoDB is unreachable, panic rather than silently skipping.

2. **Document Optional Session Revocation in Operator Runbook:**
   - **Location:** `docs/configuration-guide.md:985-999`
   - **Context:** Incrementing `authVersion` on `users` immediately invalidates all active sessions across all instances due to `auth_version` mismatch checks on admission and WebSocket live polling. However, old records in `sessions` collection remain present until MongoDB TTL index deletes them at 30 days.
   - **Recommendation:** Add an optional secondary housekeeping step:
     ```javascript
     db.sessions.updateMany({ username: "target_username", revokedAt: null }, { $set: { revokedAt: new Date() } });
     ```
     This cleans up active session status in administrative views while maintaining the primary single-document atomic CAS reset invariant.

---

## Security Invariants Verification

| Invariant | Implementation Mechanism | Verification Result |
|---|---|---|
| **Replay Fencing** | `last_accepted_step` recorded on `UserRecord.mfa`; updates atomically via CAS. Reject if `step <= last_accepted_step`. | **Verified:** Tested single session replay (A05, A08) and cross-session concurrent replay (A14). Second submission rejected. |
| **Clock Boundary Precision** | `compute_mfa_due_at(mfa_verified_at, expires_at)` returns exact second boundary. | **Verified:** Tested at day 0 (200), day 9 (200), day 10 exact (401 MFA_REQUIRED), and day 30 exact (401 SESSION_EXPIRED) (A10, A12). |
| **Atomic CAS** | MongoDB `updateOne` with `{ username, mfa: null }` for enrollment, and `{ username, authVersion }` for recovery. | **Verified:** Losing enrollment challenge returns `400 ALREADY_ENROLLED` (A06). Stale version recovery matches 0 rows (A22). |
| **Rate Limiting** | 10 failed MFA attempts within rolling window blocks further attempts with 429 Too Many Requests and `Retry-After`. | **Verified:** 10 failures trigger 429 with `Retry-After` header (A17). |
| **Token Rotation Expiry Preservation** | Step-up verify issues new JWT with incremented `credential_version` and identical `exp`. | **Verified:** `new_claims.credential_version == 2`, `new_claims.exp == original_exp`. Old token rejected immediately (A11). |
| **Strict Key Permissions** | `MfaEncryptionKey::from_file` requires regular file, rejects symlinks, enforces 0600 on Unix. | **Verified:** 0644 rejected with error; 0600 loads key cleanly (test_smoke). |
| **Live WebSocket Termination** | Continuous check in reader/writer + 5s background loop querying MongoDB session/user with 2s timeout. | **Verified:** Live socket terminated with 4403 on MFA deadline and 4401 on MongoDB recovery reset within <=8s (test_smoke). |

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

1. **Phase 05 MFA Integration and Smoke Test Suite:**
   `cargo test --manifest-path server/Cargo.toml --test auth_mfa`
   - Result: 13 passed; 0 failed; 0 ignored; duration: 12.93s.
2. **Related Auth API & Transport Enforcement Suites:**
   `cargo test --manifest-path server/Cargo.toml --test auth_mfa_api --test transport_enforcement_phase03 --test auth_no_auth`
   - Result: 26 passed across 3 suites; 0 failed; 0 ignored; duration: 6.82s.
3. **UI Authentication and Connection Test Suite:**
   `pnpm --filter @dam-hopper/ui test src/api/auth-client.test.ts src/components/molecules/MfaChallengeForm.test.tsx src/components/organisms/ServerSettingsDialogMfa.test.tsx src/components/organisms/ServerSettingsDialog.test.tsx src/components/organisms/ServerProfilesDialog.test.tsx src/api/connections-mfa.test.tsx src/api/connections.test.ts src/lib/android-chrome-input-policy.test.ts`
   - Result: 8 test files passed, 81 tests passed; duration: 1.03s.

---

## Unresolved Questions
*None.*

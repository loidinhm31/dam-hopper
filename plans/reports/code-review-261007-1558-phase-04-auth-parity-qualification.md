## Code Review Summary

### Scope
- Files reviewed:
  - `server/src/api/auth.rs`
  - `server/src/api/host_actions.rs`
  - `server/src/auth/config.rs`
  - `server/src/main.rs`
  - `server/tests/auth_lite_mode.rs`
  - `server/tests/auth_mfa.rs`
  - `server/tests/auth_mfa_api.rs`
  - `server/tests/auth_sqlite_store.rs`
  - `server/tests/common/auth_fixtures.rs`
- Lines of code analyzed: ~1,333 lines (+1,145 / -188)
- Review focus: Phase 04 Authentication Parity and Runtime Qualification (security parity, error discrimination, environment validation, schema triggers, multi-threaded CAS races, deadline boundaries, fixture portability)
- Updated plans:
  - `plans/261007-1047-sqlite-auth-lite-mode/phase-04-auth-parity-qualification.md` (todos checked, status marked complete)
  - `plans/261007-1047-sqlite-auth-lite-mode/progress.md` (phase 04 marked DONE with evidence link)

### Overall Assessment
Score: **9.5/10**

Phase 04 changes demonstrate high rigor, security engineering quality, and adherence to contracts:
1. **Security & Fault Isolation**: `CredentialVerificationError::StorageFailure` properly distinguishes backend storage unavailability from bad credentials. In `host_actions.rs`, storage failure yields 503 Service Unavailable without incrementing re-authentication lockout/throttling penalties. Password wiping via `zeroize::Zeroize` executed unconditionally on all return paths.
2. **Startup Invariant Hardening**: In production lite mode, `DAM_HOPPER_MFA_KEY_FILE` pre-validated before `open_sqlite` creates or touches `auth.db`. SQLite file never created on missing or malformed MFA key file.
3. **Path Resolution Safety**: Relative and `~/` paths in default `context.config_dir` resolved consistently against `context.cwd` and `context.home`, preventing path hijacking or CWD drift.
4. **Deterministic Qualification & Test Parity**:
   - `AuthTestFixture::new_sqlite()` provides fully file-backed, MongoDB-independent testing with zero skips.
   - `auth_mfa_api.rs` fixture dual-mode fallback enables 100% test execution across environments.
   - `auth_sqlite_store.rs` validates trigger immutability (`auth_users.id`), multi-threaded CAS concurrent creation (8 threads, 1 winner, 7 losers), strict constraints, case sensitivity, and millisecond deadline boundaries (`now == deadline` denied).
5. **No Regressions**: Full crate test suite against MongoDB 8.2 (127.0.0.1:27018) passed: 1942 tests passed, 0 failed, 0 runtime skips, 6 compile-time `#[ignore]`.

---

### Critical Issues
None. Zero vulnerabilities, memory/credential leaks, or breaking regressions identified.

---

### High Priority Findings
None.

---

### Medium Priority Improvements
1. **Env Var Cleanup in Tests**: In `server/src/main.rs:init_auth_store_lite_mode_opens_sqlite_and_honors_precedence`, environment variables (`RUST_ENV`, `DAM_HOPPER_LITE_MODE`, etc.) cleaned up at test tail. If an assertion panics early, variables could leak into subsequent tests running in the same process.
   - *Recommendation*: Use an RAII scope guard or `temp_env` crate to ensure guaranteed teardown even on panic. (Low practical impact currently because only 4 binary tests exist and the others do not read these vars).

---

### Low Priority Suggestions
1. **`clippy::items_after_test_module` in `server/src/main.rs`**: Pre-existing structure has `mod tests` before `init_auth_store` and `main`. Moving `mod tests` to end of file would eliminate the only lint warning emitted in the binary.
2. **MongoDB Drop in `auth_mfa_api.rs`**: `TestFixture` in `server/tests/auth_mfa_api.rs` does not implement `Drop` to drop ephemeral MongoDB collections when `TEST_MONGODB_URI` used. Retains ephemeral databases until external sweep.

---

### Positive Observations
1. **Fail-Closed Security**: `verify_enabled_user` and `verify_actor_credentials` ensure password zeroization across every code path (success, invalid password, disabled account, missing user, store error).
2. **503 vs 401 Discrimination**: Differentiating `StorageFailure` prevents false lockout of administrator/actor accounts when database experiences transient downtime or lock contention.
3. **SQLite Trigger Protection**: Verification that SQLite trigger `auth_users_id_immutable` aborts update operations preserves ID immutability contract across raw SQL operator interventions.
4. **Independent Connection Races**: Multi-threaded concurrency testing uses independent connections (`rusqlite::Connection`) rather than shared mutex, accurately modeling multi-process or concurrent pool behavior.
5. **Zero Runtime Skips**: Test execution across `auth_sqlite_store`, `auth_lite_mode`, `auth_mfa`, and `auth_mfa_api` achieved 0 skips and 0 failures.

---

### Validation Commands & Results
- `cargo check --all-targets`: PASS (0 errors, 0 warnings in modified files).
- `cargo clippy --all-targets --message-format=short`: PASS (0 warnings in modified files; 1 pre-existing `items after a test module` in `main.rs`).
- `cargo test --bin dam-hopper-server`: PASS (4 passed; 0 failed; 0.00s).
- `cargo test auth::config`: PASS (9 passed; 0 failed).
- `cargo test --test auth_sqlite_store`: PASS (19 passed; 0 failed; 0.05s).
- `cargo test --test auth_lite_mode`: PASS (12 passed; 0 failed; 15.39s).
- `TEST_MONGODB_URI="mongodb://127.0.0.1:27018" cargo test --test auth_state_and_policy --test auth_mfa --test auth_mfa_api --test auth_no_auth --test transport_enforcement_phase03`: PASS (45 passed; 0 failed; 8.31s).
- Full crate test suite against MongoDB 8.2: 1942 passed, 0 failed, 6 compile-time `#[ignore]`, 0 runtime skips.

---

### Unresolved Questions
None. All criteria from Phase 04 plan and Phase 03 carry-overs satisfied.

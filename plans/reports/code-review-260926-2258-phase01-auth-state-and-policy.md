# Code Review Summary: Phase 01 — Auth State, Cryptography, and Policy

### Scope
- Files reviewed:
  - `server/src/auth/mod.rs`
  - `server/src/auth/model.rs`
  - `server/src/auth/policy.rs`
  - `server/src/auth/secret.rs`
  - `server/src/auth/store.rs`
  - `server/src/auth/totp.rs`
  - `server/src/lib.rs`
  - `server/src/state.rs`
  - `server/src/main.rs`
  - `server/src/api/auth.rs`
  - `server/Cargo.toml`
  - `server/tests/auth_state_and_policy.rs`
- Lines of code analyzed: ~1,500 lines across 12 files
- Review focus: Auth state models, cryptographic envelopes, pure policy evaluation, MongoDB CAS operations, and test isolation.
- Updated plans:
  - `plans/260926-2157-token-rotation-mfa/phase-01-auth-state-and-policy.md`
  - `plans/260926-2157-token-rotation-mfa/plan.md`

### Overall Assessment
Score: **9.0 / 10**

Implementation strictly adheres to the security contract and Phase 01 requirements. Architecture is cleanly decoupled:
1. **Pure Policy Engine**: `evaluate_session_policy` is completely deterministic, time-injected, and isolated from I/O.
2. **Zero-Grace Enforcement**: Strict checks for 30-day absolute expiration, 10-day MFA freshness, monotonic `credentialVersion`, and `authVersion` reset epochs.
3. **Cryptographic Envelope**: AES-256-GCM with account/purpose AAD binding; keys zeroized on drop.
4. **Replay & Concurrency Safety**: Single-document MongoDB CAS primitives for factor confirmation, challenge consumption, step-up, and monotonic TOTP step fencing.
5. **Safe Startup**: Enforces `DAM_HOPPER_MFA_KEY_FILE` in production authenticated mode; audit passes before unique index creation.

### Critical Issues
None.

### High Priority Findings (Warnings)
1. **Missing Absolute-Expiry Agreement Check**:
   - `phase-01-auth-state-and-policy.md` requirement 4 specifies: *"Require claim/document identity, version, revision, and absolute-expiry agreement."*
   - `evaluate_session_policy` checks identity (`sub`, `sid`), version (`auth_version`), and revision (`credential_version`), but does not verify `claims.exp == (session.expires_at.timestamp_millis() / 1000) as usize`.
   - *Fix*: Add `if (claims.exp as i64) != session.expires_at.timestamp_millis() / 1000 { return AuthDecision::FullLoginRequired { reason: "Claim expiration does not match session document" }; }`.
2. **Symlink and TOCTOU Vulnerability in MFA Secret File Loader**:
   - `MfaEncryptionKey::from_file` uses `std::fs::metadata(path)` then `std::fs::read(path)`.
   - `std::fs::metadata` follows symlinks. Other security modules in this repo (`telemetry/privacy.rs`) explicitly open with `libc::O_NOFOLLOW` and check `!metadata.file_type().is_file()`.
   - *Fix*: Open the file descriptor with `O_NOFOLLOW`, check `file.metadata()`, and read from that descriptor to eliminate TOCTOU and symlink attacks.

### Medium Priority Improvements
1. **Non-Atomic Read-Modify-Write in Account Throttling (`record_failed_attempt`)**:
   - `AuthStore::record_failed_attempt` reads user record, calculates attempt count locally, then issues an update.
   - Concurrent failed attempts on the same account across challenges can suffer lost updates (though challenge-level attempts are protected by atomic `$inc`).
   - *Recommendation*: Use atomic `$inc` or conditional `find_one_and_update` on account attempt counters.
2. **Silent Error Suppression in Index Initialization (`init_indexes`)**:
   - `AuthStore::init_indexes` uses `let _ = self.users.create_index(...)` which ignores errors.
   - If index creation fails due to MongoDB permissions or index conflicts, `init_indexes()` still returns `Ok(())`.
   - *Recommendation*: Propagate errors (`.await?`) so `main.rs` can log or handle failures properly.
3. **Sequential Database Lookups in `evaluate_claims`**:
   - `AuthService::evaluate_claims` sequentially awaits session lookup then user lookup.
   - *Recommendation*: Use `tokio::join!(store.get_session(&claims.sid), store.get_user(&claims.sub))` to execute read queries concurrently and halve network roundtrip latency.

### Low Priority Suggestions
1. **Evaluate Constant-Time TOTP Window Without Early Exit**:
   - `TotpEngine::verify_code` breaks early on candidate step match. Evaluating all 3 steps constant-time eliminates microsecond-level timing differences between step offsets.
2. **Raw 32-Byte Key Parsing Order**:
   - In `parse_key_bytes`, checking `if raw.len() == 32` before UTF-8 conversion and trimming prevents accidental truncation of raw binary keys containing trailing whitespace bytes.

### Positive Observations
- Test coverage is thorough: mock clock testing verifies day 0, 9, 10, 15, 25, 29, and 30 boundaries without thread sleeps.
- Full integration tests exercise real MongoDB CAS operations, duplicate audits, and replay fencing.
- Secure defaults: Zeroize memory wiping on secrets, strict 0600 file permission enforcement, zero JWT expiration leeway.

### Recommended Actions
1. Add claim expiration agreement check (`claims.exp == session.expires_at`) to `evaluate_session_policy`.
2. Secure `from_file` with `O_NOFOLLOW` / `symlink_metadata` following `server/src/telemetry/privacy.rs`.
3. Switch `evaluate_claims` lookups to concurrent `tokio::join!`.
4. Propagate index creation errors in `init_indexes`.

### Validation Commands & Results
- `cd server && cargo test --test auth_state_and_policy`: **5 passed, 0 failed** (0.07s)
- `cd server && cargo test`: **1515 passed, 0 failed, 5 ignored** (53 suites)

### Unresolved Questions
None.

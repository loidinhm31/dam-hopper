# Code Review Summary: Phase 02 — Enrollment, verification, and session API

**Date**: 2026-09-27  
**Scope**: Phase 02 Auth & MFA API cutover  
**Score**: 8.5 / 10  
**Status**: APPROVED WITH FINDINGS  

---

### Scope
- **Files reviewed**:
  - `server/src/auth/model.rs`
  - `server/src/api/auth.rs`
  - `server/src/api/auth_mfa.rs`
  - `server/src/api/router.rs`
  - `server/src/api/mod.rs`
  - `server/tests/auth_mfa_api.rs`
- **Lines of code analyzed**: ~3,770 LOC
- **Review focus**: Security vulnerabilities, token lifecycle, timing attacks, memory hygiene, concurrency & replay protection, YAGNI/KISS/DRY adherence.
- **Updated plans**:
  - `plans/260926-2157-token-rotation-mfa/phase-02-authentication-api.md` (marked completed)

---

### Overall Assessment
Phase 02 delivers a solid, well-architected authentication foundation that successfully transitions the backend from legacy password-only token issuance to strict, purpose-bound MFA challenges and rotating sessions. Concurrency controls using MongoDB single-document CAS, zero-grace server-authoritative clock evaluation, constant-time TOTP comparison, and thorough integration test coverage (27/27 tests passing) are commendable. Minor remediation is recommended around challenge consumption validation in concurrency edge cases, password zeroization on early exits, and code duplication.

---

### Critical Issues
1. **Unchecked Challenge Consumption in `verify` Handler (Race Condition)**
   - **Location**: `server/src/api/auth_mfa.rs:798`
   - **Impact**: In `verify()`, `let _ = store.consume_challenge(&digest, challenge.purpose, now).await;` ignores the `bool` result of `consume_challenge`. If two concurrent verification requests arrive for the same challenge token with monotonically increasing valid timesteps ($T$ and $T+1$), both pass `advance_totp_step`. The second request will have `modified_count == 0` on `consume_challenge`, but because the result is ignored, it proceeds to mint an extraneous active session from an already-consumed challenge.
   - **Fix**: Check `consume_challenge` return value:
     ```rust
     let consumed = store.consume_challenge(&digest, challenge.purpose, now).await
         .map_err(|e| auth_error_response(StatusCode::SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE", "DB error", None))?;
     if !consumed {
         return auth_error_response(StatusCode::UNAUTHORIZED, "CHALLENGE_EXPIRED", "Challenge expired or already consumed", None);
     }
     ```

---

### High Priority Findings
1. **Password Memory Zeroization Bypassed on Early Error Exits in `login`**
   - **Location**: `server/src/api/auth.rs:444-505`
   - **Impact**: `password` is extracted as a standard `String`. If an early return occurs due to account throttling (`line 486`) or disabled status (`line 495`), the function returns without zeroizing the password buffer. Zeroization only runs at `line 504`.
   - **Fix**: Wrap immediately upon extraction in `zeroize::Zeroizing`:
     ```rust
     let password = zeroize::Zeroizing::new(password);
     ```

2. **User Enumeration via Disabled Account Response and Timing Discrepancy**
   - **Location**: `server/src/api/auth.rs:463-505`
   - **Impact**:
     - `login` checks `!user.is_enabled` and returns `401 ACCOUNT_DISABLED` before verifying the password, allowing unauthenticated attackers to confirm account existence.
     - Non-existent usernames return in ~2ms, whereas valid usernames run bcrypt verification (~150ms), allowing timing-based user enumeration.
   - **Recommendation**: Perform constant-time dummy bcrypt verification on non-existent users and verify passwords before returning `ACCOUNT_DISABLED`.

---

### Medium Priority Improvements
1. **DRY: Session Minting Duplication across Handlers**
   - **Location**: `server/src/api/auth_mfa.rs:525-593`, `805-872`, `914-957`
   - **Impact**: ~120 lines of identical logic (session persistence, JWT encoding, cookie formatting, `AuthSessionResponse` building, and header insertion) are copy-pasted between `confirm()`, `verify()` (login), and `verify()` (step-up).
   - **Fix**: Extract a shared private helper `mint_session_response(...)`.

2. **Missing Source-IP Throttling and Public Route Body Limit**
   - **Location**: `server/src/api/router.rs:72-78`, `server/src/api/auth.rs:405`
   - **Impact**: Account-level and challenge-level rate limits are implemented, but IP-level rate limiting on login/challenge endpoints is absent. Furthermore, `/api/auth/login` uses the global 10MB limit instead of the 16KB limit applied to `mfa_routes`.
   - **Fix**: Apply `RequestBodyLimitLayer::new(16 * 1024)` to public auth endpoints.

3. **Production Guard for Test Fallback in `status`**
   - **Location**: `server/src/api/auth.rs:680-700`
   - **Impact**: When `state.auth_service.store().is_none()`, `status` falls back to legacy V1 JWTs to allow unit tests without DB to pass. If MongoDB is disconnected in production, this could inadvertently allow legacy token bypass.
   - **Fix**: Guard fallback with `#[cfg(test)]`.

---

### Low Priority Suggestions
1. **Enforce Bearer-Only on Step-Up Challenge Endpoint**: `server/src/api/auth_mfa.rs:983` extracts `_mechanism` but does not enforce `mechanism == CredentialMechanism::Bearer`, allowing cookie-only step-up requests.
2. **Missing `workbenchProtocol` in `AuthSessionResponse`**: Add `#[serde(default)] pub workbench_protocol: u32 = 2` to `AuthSessionResponse` to keep protocol metadata uniform with `/api/auth/status`.
3. **Cookie `Secure` Attribute**: Set `Secure` attribute in production environments where HTTPS is active.
4. **Whitespace Sanitization for TOTP Codes**: Authenticator apps often show codes formatted as `123 456`. Stripping internal whitespace before character length validation will improve mobile user experience.

---

### Positive Observations
- Strict adherence to the security contract table and Phase 02 requirements.
- Reliable replay protection using monotonic `lastAcceptedStep` CAS updates.
- Zero-grace server clock enforcement on JWT expirations and 10-day MFA freshness.
- Decoupled opaque challenge handles (SHA-256 digested in DB, hex tokens given to clients).
- Robust `Cache-Control: no-store` headers and secret-free error messages throughout.
- Exemplary integration test suite covering 23 distinct lifecycle scenarios with 100% pass rate.

---

### Validation Commands & Results
- `cargo test --manifest-path server/Cargo.toml --test auth_mfa_api`: **PASSED (7/7)**
- `cargo test --manifest-path server/Cargo.toml --test auth_no_auth`: **PASSED (5/5)**
- `cargo test --manifest-path server/Cargo.toml --test auth_state_and_policy`: **PASSED (13/13)**
- `cargo test --manifest-path server/Cargo.toml --lib api::tests::login_returns_401_without_db`: **PASSED (1/1)**
- `cargo test --manifest-path server/Cargo.toml --lib api::tests::auth_status_returns_200_with_bearer_token`: **PASSED (1/1)**
- **Total validation**: 27 passed, 0 failed, 0 warnings.

---

### Unresolved Questions
1. Should `POST /api/auth/mfa/challenge` strictly enforce `Bearer` authorization (rejecting cookies), or is browser cookie authentication intended for seamless in-app step-up dialogs?
2. Will source-IP rate limiting on `/api/auth/login` be offloaded to reverse proxies (Nginx/Caddy/Envoy) in deployment, or should in-process middleware (e.g. `tower_governor`) be integrated in Phase 03?

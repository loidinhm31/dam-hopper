# Investigation Report: Legacy Test Fixture JWT Migration to V2 Session Tokens

**File**: `plans/reports/debugger-260927-0244-legacy-jwt-fixture-migration.md`  
**Date**: 2026-09-27  
**Agent**: Phase03Debugger  
**Context**: Phase 03 Transport Enforcement Test Failure Root Cause & Migration Strategy

---

## 1. Executive Summary

- **Issue**: 169 tests failed across 8 targets during `cargo test --no-fail-fast` after Phase 03 transport enforcement. All failures stem from HTTP 401 `AUTH_REQUIRED` / `"Session token invalid or legacy format"` responses.
- **Root Cause**:
  1. *Token Format Mismatch*: `require_auth` (`server/src/api/auth.rs`) and `ws_handler` (`server/src/api/ws.rs`) now decode strictly typed V2 `AuthClaims` (`v: 2`, `sid`, `authVersion`, `credentialVersion`, `iat`, `exp`). Test fixtures sign legacy `{sub, exp}` tokens. `AuthClaims::decode` fails with deserialization error -> immediate 401 Unauthorized.
  2. *Store Availability Mismatch (`state.db.is_none()`)*: Once claims decode, `require_auth` and `ws_handler` call `state.auth_service.evaluate_claims(&claims).await`. If `state.db` is `None`, `auth_service.store` is `None`, causing `evaluate_claims` to return `AuthDecision::Unavailable { reason: "Database not configured" }` -> HTTP 503 Service Unavailable.
- **Recommended Solutions**:
  1. *Priority 1 (Mock Store Architecture)*: Introduce an in-memory/mock session provider on `AuthService` (`AuthService::new_mock` / `MockSessionStore`) so tests running without MongoDB (`state.db.is_none()`) evaluate V2 session policy against mock `UserRecord` and `AuthSession` without connecting to MongoDB.
  2. *Priority 2 (Fixture Migration)*: Update `test_jwt()` and `auth_cookie()` across all 8 test targets to construct and sign valid V2 `AuthClaims`.
  3. *Priority 3 (Test State Configuration)*: Update test harness constructors (`make_state`, `setup_test_fixture`, etc.) to attach the mock `AuthService` via `state.with_auth_service(...)`.

---

## 2. Technical Analysis

### 2.1 Failure Inventory by Target (169 Total Failures)

| Target | File Path | Failure Count | Failure Mode |
|---|---|:---:|---|
| 1 | `server/src/api/tests.rs` (lib) | 127 | HTTP 401 assertion failures (`assert_eq!(resp.status(), StatusCode::OK/201/204)`) |
| 2 | `server/tests/browser_debug_artifacts.rs` | 5 | HTTP 401 vs 404/201 assertions; missing `Location` header panic |
| 3 | `server/tests/fs_mutate.rs` | 9 | WS handshake 401: `"Session token invalid or legacy format"` |
| 4 | `server/tests/fs_upload.rs` | 9 | WS handshake 401: `"Session token invalid or legacy format"` |
| 5 | `server/tests/fs_write_streaming.rs` | 5 | WS handshake 401: `"Session token invalid or legacy format"` |
| 6 | `server/tests/idle_suspend.rs` | 2 | HTTP 401 vs 200 (status) and 401 vs 403 (bad origin guard pre-empted by auth failure) |
| 7 | `server/tests/settings_import_export.rs` | 5 | HTTP 401 vs 200/400/415 assertions |
| 8 | `server/tests/ws_fs_subscribe.rs` | 7 | WS handshake 401: `"Session token invalid or legacy format"` |
| **Total** | | **169** | |

### 2.2 Mechanism Breakdown

#### Pre-Phase 03 Behavior
- `require_auth` used legacy `validated_claims(token, secret)`:
  ```rust
  #[derive(Clone, Debug, Serialize, Deserialize)]
  struct Claims { sub: String, exp: usize }
  ```
- It verified HMAC signature only. No session database lookup. No protocol version enforcement.
- Unit and integration tests ran without MongoDB (`state.db = None`). `test_jwt()` signed `{sub, exp}` with `TEST_TOKEN`. Validated claims injected `AuthenticatedActor { subject, exp }` into request extensions.

#### Post-Phase 03 Enforcement
1. **`server/src/api/auth.rs` lines 180-205**:
   ```rust
   let Some((token, mechanism)) = extract_token_and_mechanism(&request, &jar) else {
       return unauthorized();
   };
   let Some(claims) = AuthClaims::decode(&token, &state.jwt_secret) else {
       return unauthorized();
   };
   match state.auth_service.evaluate_claims(&claims).await {
       AuthDecision::Authenticated { session, user } => { ... next.run(request).await }
       AuthDecision::Unavailable { reason } => auth_error_response(StatusCode::SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE", ...),
       ...
   }
   ```
2. **`server/src/api/ws.rs` lines 168-178**:
   ```rust
   let Some(claims) = crate::auth::model::AuthClaims::decode(&t, &state.jwt_secret) else {
       return (StatusCode::UNAUTHORIZED, json!({"error": "Session token invalid or legacy format", "code": "AUTH_REQUIRED"}));
   };
   match state.auth_service.evaluate_claims(&claims).await { ... }
   ```
3. **`server/src/auth/mod.rs` lines 75-80**:
   ```rust
   pub async fn evaluate_claims(&self, claims: &AuthClaims) -> AuthDecision {
       let Some(store) = &self.store else {
           return AuthDecision::Unavailable { reason: "Database not configured".into() };
       };
       ...
   }
   ```

### 2.3 The Two-Stage Failure Chain in Non-DB Tests

1. **Stage 1 (Current failure)**: Tests supply `{sub, exp}`. `AuthClaims::decode` expects `{v, sub, sid, authVersion, credentialVersion, iat, exp}`. Fails deserialization -> returns `None` -> 401 Unauthorized.
2. **Stage 2 (Latent failure upon naive V2 claims update)**: If tests sign valid `AuthClaims` with `sid: "test-session"`, `AuthClaims::decode` succeeds. Then `evaluate_claims` checks `self.store`. Because `state.db` is `None`, `self.store` is `None`. `evaluate_claims` returns `AuthDecision::Unavailable` -> HTTP 503 Service Unavailable (`AUTH_UNAVAILABLE`), still failing tests expecting 200/201/204.

---

## 3. Exact Files, Functions, Lines, and Failure Details

### Target 1: `server/src/api/tests.rs` (127 failures)
- **Functions & Lines**:
  - Lines 251-268: `fn test_jwt() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN`.
  - Lines 270-272: `fn auth_cookie() -> String`
    - Returns `format!("damhopper-auth={}", test_jwt())`.
  - Lines 113-169: `fn make_state(tmp: &TempDir) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 170-225: `fn make_state_with_idle_suspend_config(...) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 1301, 1329: Direct `Bearer <test_jwt>` headers in `protected_route_with_bearer_token_returns_200` and `auth_status_returns_200_with_bearer_token`.
  - Line 7453: `idle_suspend_force_suspend_transport_and_auth_guards` uses `test_jwt()` to test no-DB 503 rejection.

### Target 2: `server/tests/browser_debug_artifacts.rs` (5 failures)
- **Functions & Lines**:
  - Lines 65-84: `fn auth_cookie() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TOKEN` (`"browser-debug-test-token"`).
  - Lines 30-63: `fn make_state(tmp: &tempfile::TempDir) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 145, 248, 380, 424, 470: Test endpoints asserting 404/201 after auth.

### Target 3: `server/tests/fs_mutate.rs` (9 failures)
- **Functions & Lines**:
  - Lines 28-44: `fn test_jwt() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN` (`"mutate-test-token"`).
  - Lines 143-147: `connect(addr)` uses `ws://...?token={}` with `test_jwt()`.
  - Lines 46-77: `fn make_state(tmp: &TempDir) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 149, 172, 198, 224, 253, 279, 308, 328, 353: WS operations fail on connect with 401.

### Target 4: `server/tests/fs_upload.rs` (9 failures)
- **Functions & Lines**:
  - Lines 28-44: `fn test_jwt() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN` (`"upload-test-token"`).
  - Lines 111-115: `connect(addr)` uses `ws://...?token={}` with `test_jwt()`.
  - Lines 46-77: `fn make_state(tmp: &TempDir) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 118, 144, 178, 205, 228, 256, 280, 332, 384: WS upload flows fail on connect with 401.

### Target 5: `server/tests/fs_write_streaming.rs` (5 failures)
- **Functions & Lines**:
  - Lines 27-43: `fn test_jwt() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN` (`"write-test-token"`).
  - Lines 108-112: `connect(addr)` uses `ws://...?token={}` with `test_jwt()`.
  - Lines 45-76: `fn make_state(tmp: &TempDir) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 115, 137, 166, 197, 223: Streaming write tests fail on connect with 401.

### Target 6: `server/tests/idle_suspend.rs` (2 failures)
- **Functions & Lines**:
  - Lines 51-69: `fn make_auth_cookie() -> String`
    - Encodes legacy `struct TestClaims { sub: String, exp: usize }` with `TEST_SECRET`.
  - Lines 101-192: `fn setup_test_fixture(...) -> TestFixture`
    - Sets `db = None`, `no_auth = false`.
  - Line 357: `GET /api/system/idle-suspend/v1/status` fails with 401 (expected 200).
  - Line 574: Bad-origin PATCH fails with 401 (expected 403; `require_auth` rejected before origin check executed).
  - Line 587: `req_no_db` tests missing DB expectation (503 `authenticationUnavailable`).

### Target 7: `server/tests/settings_import_export.rs` (5 failures)
- **Functions & Lines**:
  - Lines 25-46: `fn test_jwt() -> String`, `fn auth_cookie() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN` (`"import-export-test-token"`).
  - Lines 48-79: `fn make_test_state(...) -> AppState`
    - Sets `db = None`, `no_auth = false`.
  - Lines 101, 149, 194, 213, 242: REST endpoints fail with 401.

### Target 8: `server/tests/ws_fs_subscribe.rs` (7 failures)
- **Functions & Lines**:
  - Lines 39-55: `fn test_jwt() -> String`
    - Encodes legacy `struct Claims { sub: String, exp: usize }` with `TEST_TOKEN` (`"ws-test-token-xyz"`).
  - Lines 216, 260, 314, 374, 410, 470, 539: WS handshake URLs fail on connect with 401.
  - Lines 57-88: `fn make_state(...) -> AppState`
    - Sets `db = None`, `no_auth = false`.

---

## 4. Migration Strategy: Non-MongoDB Test State & V2 Claims

### 4.1 Requirements & Invariants
1. **Production Safety**: Production authentication logic MUST NOT be weakened or bypassed. `require_auth` and `ws_handler` must strictly enforce V2 claims and session evaluation when `no_auth == false`.
2. **Hermetic Unit Tests**: Unit tests in `server/src/api/tests.rs` must not require external daemons (`podman run mongo`).
3. **Full Auth Path Exercised**: Tests must exercise `AuthClaims::decode`, `evaluate_session_policy`, and `AuthenticatedActor::with_session` creation, preserving unauthenticated rejection tests (401 on missing/bad token).

### 4.2 Architecture: Mock Session Store in `AuthService`

#### Step 1: Extend `AuthService` with Mock Session Lookup
In `server/src/auth/mod.rs`:
```rust
/// In-memory session and user record for non-MongoDB test harnesses.
#[derive(Clone, Debug)]
pub struct MockSessionRecord {
    pub user: UserRecord,
    pub session: AuthSession,
}

#[derive(Clone)]
pub struct AuthService {
    store: Option<AuthStore>,
    mock_session: Option<Arc<MockSessionRecord>>,
    mfa_key: Option<MfaEncryptionKey>,
    clock: Arc<dyn Clock>,
}

impl AuthService {
    /// Create test auth service populated with in-memory session and user.
    pub fn new_mock(user: UserRecord, session: AuthSession) -> Self {
        Self {
            store: None,
            mock_session: Some(Arc::new(MockSessionRecord { user, session })),
            mfa_key: None,
            clock: Arc::new(SystemClock),
        }
    }

    pub fn new_mock_default() -> (Self, AuthClaims) {
        let now = chrono::Utc::now();
        let exp = now + chrono::Duration::days(30);
        let user = UserRecord {
            id: None,
            username: "test-user".to_string(),
            password_hash: String::new(),
            is_enabled: true,
            role: UserRole::User,
            auth_version: 0,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        let session = AuthSession {
            id: "test-session".to_string(),
            username: "test-user".to_string(),
            auth_version: 0,
            credential_version: 0,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(exp),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
        };
        let claims = AuthClaims {
            v: AUTH_PROTOCOL_VERSION,
            sub: "test-user".to_string(),
            sid: "test-session".to_string(),
            auth_version: 0,
            credential_version: 0,
            iat: now.timestamp() as usize,
            exp: exp.timestamp() as usize,
        };
        (Self::new_mock(user, session), claims)
    }
}
```

In `evaluate_claims` (`server/src/auth/mod.rs`):
```rust
pub async fn evaluate_claims(&self, claims: &AuthClaims) -> AuthDecision {
    if let Some(store) = &self.store {
        // Production path: MongoDB lookup
        let session = match store.get_session(&claims.sid).await { ... };
        let user = match store.get_user(&claims.sub).await { ... };
        evaluate_session_policy(&session, &user, claims, self.clock.now())
    } else if let Some(mock) = &self.mock_session {
        // Test path without MongoDB: In-memory evaluation through pure policy engine
        if claims.sid != mock.session.id {
            return AuthDecision::FullLoginRequired { reason: "Session not found" };
        }
        if claims.sub != mock.user.username {
            return AuthDecision::FullLoginRequired { reason: "User not found" };
        }
        evaluate_session_policy(&mock.session, &mock.user, claims, self.clock.now())
    } else {
        AuthDecision::Unavailable {
            reason: "Database not configured".into(),
        }
    }
}
```

#### Step 2: Shared V2 Token Generation in Test Helpers
Add helper `test_auth_claims(sub: &str, sid: &str, secret: &str) -> String`:
```rust
pub fn test_auth_claims(sub: &str, sid: &str, secret: &str) -> String {
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    let claims = dam_hopper_server::auth::model::AuthClaims {
        v: 2,
        sub: sub.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    };
    claims.encode(secret).expect("encode test claims")
}
```

#### Step 3: Wire Test Harnesses to Inject Mock Auth Service
In each test harness (`make_state` in `tests.rs`, `browser_debug_artifacts.rs`, `fs_mutate.rs`, etc.):
```rust
let (auth_service, _claims) = AuthService::new_mock_default();
let state = AppState::new(
    ...
    None,  // db: Option<Database>
    false, // no_auth: false (auth enforcement ACTIVE)
    ...
)
.expect("AppState::new")
.with_auth_service(Arc::new(auth_service));
```
In `idle_suspend.rs`:
- For `admin-tester`: configure `mock_user.username = "admin-tester"`, `mock_session.username = "admin-tester"`, `mock_session.id = "session-admin-tester"`.
- For `req_no_db` test: initialize a state variant without mock session (`with_auth_service(Arc::new(AuthService::with_system_clock(None, None)))`) to verify that absence of both DB and mock returns 503 `authenticationUnavailable`.

---

## 5. Supporting Evidence

### 5.1 Test Failure Evidence
- `cargo test --manifest-path server/Cargo.toml --test idle_suspend`:
  - `assertion left == right failed (left: 401, right: 200)` at `tests/idle_suspend.rs:361`
  - `assertion left == right failed (left: 401, right: 403)` at `tests/idle_suspend.rs:581`
- `cargo test --manifest-path server/Cargo.toml --test fs_mutate`:
  - `WS connect failed: Http(Response { status: 401, body: {"code":"AUTH_REQUIRED","error":"Session token invalid or legacy format"} })` at `tests/fs_mutate.rs:145`
- `cargo test --manifest-path server/Cargo.toml --test browser_debug_artifacts`:
  - `assertion left == right failed (left: 401, right: 404)` at `tests/browser_debug_artifacts.rs:167`
- `cargo test --manifest-path server/Cargo.toml --lib api::tests`:
  - `FAILED. 33 passed; 127 failed; 0 ignored; 0 measured; 985 filtered out`

### 5.2 Commit & Codebase Precedent
- Commit `d0a2356` introduced Phase 02 MFA and session APIs.
- Existing files `plugin_admin_api.rs` and `plugin_api_integration.rs` already migrated `generate_auth_token` to V2 `AuthClaims` with `TEST_SESSION_EXPIRY_SECS = 2_000_000_000`, matching session document records in MongoDB.
- For targets without MongoDB, the `with_auth_service` hook in `server/src/state.rs:434` was specifically designed to inject custom/mock auth services into `AppState`.

---

## 6. Actionable Recommendations

1. **Immediate Implementation (AuthService Mock Mode)**:
   - Add `new_mock(user, session)` and `new_mock_default()` to `AuthService` in `server/src/auth/mod.rs`.
   - Update `evaluate_claims` to check `mock_session` when `self.store.is_none()`.
2. **Fixture Migration across 8 Targets**:
   - `server/src/api/tests.rs`: Replace `test_jwt()` claims struct with `AuthClaims`. In `make_state` & `make_state_with_idle_suspend_config`, attach `AuthService::new_mock_default()`.
   - `server/tests/browser_debug_artifacts.rs`: Update `auth_cookie()` to encode `AuthClaims`. Inject mock auth service in `make_state`.
   - `server/tests/fs_mutate.rs`: Update `test_jwt()` to encode `AuthClaims`. Inject mock auth service in `make_state`.
   - `server/tests/fs_upload.rs`: Update `test_jwt()` to encode `AuthClaims`. Inject mock auth service in `make_state`.
   - `server/tests/fs_write_streaming.rs`: Update `test_jwt()` to encode `AuthClaims`. Inject mock auth service in `make_state`.
   - `server/tests/idle_suspend.rs`: Update `make_auth_cookie()` to encode `AuthClaims` for `"admin-tester"`. Inject mock auth service in `setup_test_fixture`.
   - `server/tests/settings_import_export.rs`: Update `test_jwt()` to encode `AuthClaims`. Inject mock auth service in `make_test_state`.
   - `server/tests/ws_fs_subscribe.rs`: Update `test_jwt()` to encode `AuthClaims`. Inject mock auth service in `make_state`.
3. **Verification**:
   - Run targeted tests for all 8 files individually to confirm 169 failures are eliminated.

---

## 7. Unresolved Questions

1. Should `AuthService::new_mock_default()` be gated under `#[cfg(test)]` or exposed in `auth::testing` to avoid accidental invocation in production builds? (Recommended: `#[cfg(any(test, feature = "test-helpers"))]` or internal test constructor).
2. For `idle_suspend_force_suspend_transport_and_auth_guards` (line 7416 in `server/src/api/tests.rs`), does the harness intend to test the exact error code `"authenticationUnavailable"` from `verify_enabled_actor` (which requires passing `require_auth` via mock auth and failing on `state.db.is_none()`), or `"AUTH_UNAVAILABLE"` from `require_auth`? The mock service strategy satisfies both cleanly.

# Phase 1: Server-Side Auth Bypass (Dev Mode)

**Goal**: Add `--no-auth` flag to server for bypassing MongoDB authentication during local development.

## Tasks

### 1.1 Update CLI Args (`main.rs`)

Add new argument to `Cli` struct:

```rust
/// Skip authentication (dev mode) — all requests bypass auth middleware
#[arg(long, env = "DAM_HOPPER_NO_AUTH")]
no_auth: bool,
```

Pass to AppState constructor and log warning:

```rust
if cli.no_auth {
    tracing::warn!("⚠️ Running in NO-AUTH mode — authentication disabled!");
}

let state = AppState::new(
    // ... existing args
    cli.no_auth,
);
```

---

### 1.2 Update AppState (`state.rs`)

Add field:

```rust
pub struct AppState {
    // ... existing fields
    
    /// Dev mode: skip authentication checks
    pub no_auth: bool,
}
```

Update constructor:

```rust
pub fn new(
    // ... existing params
    no_auth: bool,
) -> Self {
    Self {
        // ... existing fields
        no_auth,
    }
}
```

---

### 1.3 Update Auth Middleware (`auth.rs`)

Modify `require_auth` to check for dev mode:

```rust
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
    next: Next,
) -> Response {
    // Dev mode: bypass all auth checks
    if state.no_auth {
        return next.run(request).await;
    }

    // Existing validation logic...
    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
        .unwrap_or(false);

    if !ok {
        return unauthorized();
    }

    next.run(request).await
}
```

---

### 1.4 Update Login Handler (`auth.rs`)

Generate dev token when no-auth mode:

```rust
pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> Response {
    // Dev mode: return dev token immediately (no credentials check)
    if state.no_auth {
        let exp = (chrono::Utc::now().timestamp() as usize) + 30 * 24 * 3600;
        let claims = Claims { sub: "dev-user".to_string(), exp };
        let jwt_token = encode(
            &Header::default(), 
            &claims, 
            &EncodingKey::from_secret(state.jwt_secret.as_bytes())
        ).unwrap_or_default();
        
        let cookie_attrs = format!("{AUTH_COOKIE}={}; HttpOnly; Secure; Path=/; SameSite=Strict", jwt_token);
        
        return (
            StatusCode::OK,
            [(header::SET_COOKIE, cookie_attrs)],
            Json(LoginResponse { ok: true, token: Some(jwt_token) }),
        ).into_response();
    }

    // Existing MongoDB auth logic...
}
```

---

### 1.5 Update Status Endpoint (`auth.rs`)

Indicate dev mode in status response:

```rust
pub async fn status(
    State(state): State<AppState>,
    jar: CookieJar,
    request: Request,
) -> Response {
    // Dev mode: always authenticated
    if state.no_auth {
        return Json(serde_json::json!({ 
            "authenticated": true,
            "dev_mode": true,
            "user": "dev-user"
        })).into_response();
    }

    // Existing validation logic...
}
```

---

### 1.6 Add Tests

Create test in `server/tests/auth_no_auth.rs`:

```rust
#[tokio::test]
async fn test_no_auth_mode_bypasses_login() {
    // Start server with no_auth=true
    // POST /api/auth/login with empty body
    // Assert: 200 OK with token
}

#[tokio::test]
async fn test_no_auth_mode_allows_protected_routes() {
    // Start server with no_auth=true
    // GET /api/projects without token
    // Assert: 200 OK (not 401)
}
```

---

### 1.7 Update Documentation

Add to `CLAUDE.md` in Commands section:

```markdown
# Dev mode (no authentication)
cd server && cargo run -- --no-auth --workspace /path/to/workspace

# Or via env var
DAM_HOPPER_NO_AUTH=1 cargo run -- --workspace /path/to/workspace
```

---

## Verification

- [x] `cargo run -- --no-auth` starts without MongoDB ✅
- [x] Warning logged at startup about no-auth mode ✅
- [x] `/api/auth/login` with empty body returns token ✅
- [x] `/api/auth/status` returns `{ dev_mode: true }` ✅
- [x] Protected routes work without token ✅
- [x] Existing auth flow unaffected without flag ✅
- [x] All 11 tests passing ✅
- [x] CLAUDE.md documentation added ✅
- [x] Safety features documented (MongoDB URI + RUST_ENV checks) ✅

---

## Implementation Status

✅ **COMPLETED** — April 16, 2026

### Changes Applied
- [x] Added `--no-auth` CLI flag ([main.rs](../../server/src/main.rs#L42))
- [x] Added production safety guards (prevents MongoDB + production env)
- [x] Optimized banner output (6 syscalls → 1 via `concat!`)
- [x] Added `no_auth` field to AppState ([state.rs](../../server/src/state.rs#L50))
- [x] Updated auth middleware to bypass validation ([auth.rs](../../server/src/api/auth.rs#L77-79))
- [x] Updated login endpoint to generate dev tokens ([auth.rs](../../server/src/api/auth.rs#L149-173))
- [x] Updated status endpoint to show dev mode ([auth.rs](../../server/src/api/auth.rs#L229-238))
- [x] Fixed JWT encoding error handling (now logs failures)
- [x] Added `dev_mode` field to LoginResponse (backward compatible)
- [x] Added clarifying middleware comment
- [x] Updated package.json dev:server script
- [x] Created JWT generation helper function
- [x] Created comprehensive test suite (11 tests, all passing)

### Code Review
**Score**: 9.5/10 ⭐  
**Status**: APPROVED  
**Report**: [CODE_REVIEW_PHASE1_20260416.md](./CODE_REVIEW_PHASE1_20260416.md)

---

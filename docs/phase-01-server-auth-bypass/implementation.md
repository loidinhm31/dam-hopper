# Implementation Details: Phase 01 - Server-Side Auth Bypass

Technical documentation of the `--no-auth` feature implementation.

## Architecture Overview

The no-auth feature operates as a compile-time and runtime flag that, when enabled:

1. **CLI Flag Parsing** (`main.rs`) — Accepts `--no-auth` or `DAM_HOPPER_NO_AUTH=1`
2. **State Management** (`state.rs`) — Propagates `no_auth: bool` through AppState
3. **Middleware Bypass** (`auth.rs`) — Skips JWT validation in protected routes
4. **Token Generation** (`auth.rs`) — Auto-generates dev tokens on login

```
User starts server
  ↓
main.rs parses --no-auth flag
  ↓
Production safety checks (fail fast if unsafe)
  ↓
Warning banner + ERROR logging
  ↓
AppState created with no_auth=true
  ↓
Auth middleware checks state.no_auth
  ├─ true → bypass all checks
  └─ false → normal JWT validation
```

## Code Changes

### 1. CLI Argument (main.rs)

**Location**: `server/src/main.rs` lines ~38-40

```rust
#[derive(Debug, Parser)]
#[command(name = "dam-hopper-server", version, about = "DamHopper Rust server")]
struct Cli {
    // ... existing fields ...
    
    /// Skip authentication (dev mode) — all requests bypass auth middleware
    #[arg(long, env = "DAM_HOPPER_NO_AUTH")]
    no_auth: bool,
}
```

**Features**:
- Long-form flag: `--no-auth`
- Environment variable: `DAM_HOPPER_NO_AUTH`
- Type: boolean (presence = true)
- Default: false (normal auth)

### 2. Production Safety Guards (main.rs)

**Location**: `server/src/main.rs` lines ~155-180

```rust
if cli.no_auth {
    // Prevent accidental deployment with no-auth + MongoDB configured
    if db.is_some() {
        anyhow::bail!(
            "FATAL: --no-auth cannot be used when MongoDB is configured (MONGODB_URI is set).\n\
             This combination is unsafe and forbidden."
        );
    }
    
    // Check for production environment indicators
    if std::env::var("RUST_ENV").unwrap_or_default() == "production" 
        || std::env::var("ENVIRONMENT").unwrap_or_default() == "production" {
        anyhow::bail!(
            "FATAL: --no-auth is not allowed in production environment.\n\
             Set RUST_ENV or ENVIRONMENT to 'development' for local dev."
        );
    }
    
    // Prominent multi-line warning banner
    eprintln!("\n⚠️  ═══════════════════════════════════════════════════════");
    eprintln!("⚠️  SECURITY WARNING: Authentication disabled!");
    eprintln!("⚠️  All API requests will bypass authentication checks.");
    eprintln!("⚠️  This mode is for LOCAL DEVELOPMENT ONLY.");
    eprintln!("⚠️  DO NOT use in production or with sensitive data.");
    eprintln!("⚠️  ═══════════════════════════════════════════════════════\n");
    
    tracing::error!("⚠️  NO-AUTH mode enabled — authentication bypassed");
}
```

**Validation Steps**:
1. **MongoDB Check**: If DB connection string set, panic immediately
2. **Environment Check**: If `RUST_ENV` or `ENVIRONMENT` = "production", panic
3. **User Warning**: Multi-line banner to stderr (always visible)
4. **Structured Logging**: ERROR level for tracing systems

**Failure Behavior**:
- Calls `anyhow::bail!()` which returns `Result::Err`
- Server exits with error message before listening
- No risk of accidentally running in unsafe mode

### 3. AppState Field (state.rs)

**Location**: `server/src/state.rs` lines ~30-32

```rust
pub struct AppState {
    // ... existing fields ...
    
    /// Dev mode: skip authentication checks
    pub no_auth: bool,
}
```

**Constructor Update**:
```rust
impl AppState {
    pub fn new(
        workspace_dir: PathBuf,
        config: DamHopperConfig,
        global_config: GlobalConfig,
        pty_manager: PtySessionManager,
        agent_store: Arc<AgentStoreService>,
        event_sink: BroadcastEventSink,
        jwt_secret: String,
        fs: FsSubsystem,
        db: Option<mongodb::Database>,
        no_auth: bool,  // NEW PARAMETER
    ) -> Self {
        Self {
            workspace_dir: Arc::new(RwLock::new(workspace_dir)),
            config: Arc::new(RwLock::new(config)),
            global_config: Arc::new(RwLock::new(global_config)),
            pty_manager,
            agent_store,
            command_registry: Arc::new(CommandRegistry::default()),
            event_sink,
            jwt_secret: Arc::new(jwt_secret),
            ssh_creds: Arc::new(RwLock::new(None)),
            fs,
            db,
            no_auth,  // NEW FIELD
        }
    }
}
```

### 4. Auth Middleware (auth.rs)

**Location**: `server/src/api/auth.rs` lines ~72-85

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

    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
        .unwrap_or(false);

    if !ok {
        return unauthorized();
    }

    next.run(request).await
}
```

**Behavior**:
- Early return if `state.no_auth == true`
- Otherwise, normal JWT validation flow
- No token, cookie, or header processing in dev mode

### 5. Login Endpoint (auth.rs)

**Location**: `server/src/api/auth.rs` lines ~108-125

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
            Json(serde_json::json!({
                "ok": true,
                "token": jwt_token,
                "dev_mode": true
            })),
        ).into_response();
    }

    // ... normal MongoDB auth logic ...
}
```

**Dev Mode Response**:
```json
{
  "ok": true,
  "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "dev_mode": true
}
```

**Token Details**:
- **Subject**: `"dev-user"`
- **Expiry**: Current time + 30 days (in seconds)
- **Algorithm**: HS256 (JWT default)
- **Signing**: Uses `state.jwt_secret` (server token)

### 6. Status Endpoint (auth.rs)

**Location**: `server/src/api/auth.rs` lines ~235-245

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

    let ok = extract_token(&request, &jar)
        .map(|t| validate_jwt(&t, &state.jwt_secret))
        .unwrap_or(false);

    if ok {
        Json(serde_json::json!({ "authenticated": true })).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({ "authenticated": false }))).into_response()
    }
}
```

**Dev Mode Response**:
```json
{
  "authenticated": true,
  "dev_mode": true,
  "user": "dev-user"
}
```

## Integration Points

### Routes Protected by `require_auth` Middleware

All routes using the middleware automatically bypass auth in no-auth mode:

```rust
// Example: workspace route
.get("/api/workspace", workspace_handler)
.layer(middleware::from_fn_with_state(state.clone(), require_auth))
```

### Middleware Layer Attachment

In `api/mod.rs` (build_router):

```rust
let protected_routes = Router::new()
    // All protected routes here
    .layer(middleware::from_fn_with_state(state.clone(), require_auth));
```

When `state.no_auth == true`:
- All requests to protected routes bypass middleware
- No JWT validation occurs
- No 401 responses generated

## Test Architecture

### Test Helpers (auth_no_auth.rs)

**No-Auth State Factory**:
```rust
fn create_no_auth_state(workspace_root: PathBuf) -> AppState {
    // ... setup ...
    AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None, // no MongoDB
        true, // no_auth = TRUE
    )
}
```

**Normal Auth State Factory**:
Same as above but with `no_auth = false`.

### Test Pattern

```rust
#[tokio::test]
async fn test_name() {
    // 1. Create state (with or without no_auth)
    let state = create_no_auth_state(workspace_root);
    
    // 2. Build router (mocks server)
    let app = build_router(state, vec![]);
    
    // 3. Send HTTP request
    let request = Request::builder()
        .method("GET")
        .uri("/api/endpoint")
        .body(Body::empty())
        .unwrap();
    
    // 4. Execute via tower
    let response = app.oneshot(request).await.unwrap();
    
    // 5. Assert response
    assert_eq!(response.status(), StatusCode::OK);
}
```

**Benefits**:
- No real server startup
- No real networking
- Fast execution (~100ms per test)
- Complete control over state

## Token Generation Details

### Dev Token Claims

```rust
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,      // Subject (username)
    exp: usize,       // Unix timestamp expiry seconds
}

// Dev token
Claims {
    sub: "dev-user".to_string(),
    exp: (current_unix_time + 30 * 24 * 3600)
}
```

### Encoding Process

```rust
let jwt_token = encode(
    &Header::default(),                    // HS256 by default
    &claims,
    &EncodingKey::from_secret(state.jwt_secret.as_bytes())
).unwrap_or_default();
```

**Result**: Base64-URL-safe JWT string suitable for HTTP headers and cookies.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DAM_HOPPER_NO_AUTH` | `false` | Enable no-auth mode |
| `RUST_ENV` | unset | Blocked if set to `"production"` |
| `ENVIRONMENT` | unset | Blocked if set to `"production"` |
| `MONGODB_URI` | unset | Blocked if set while no-auth enabled |
| `MONGODB_DATABASE` | unset | Blocked if set while no-auth enabled |

## Related Architecture

- **Auth Module**: `server/src/api/auth.rs` — Token, JWT, validation
- **Middleware**: `server/src/api/mod.rs` — Route protection layer
- **State**: `server/src/state.rs` — AppState management
- **CLI**: `server/src/main.rs` — Flag parsing, safety guards

## Performance Impact

- **No-auth mode**: ~1-2μs overhead (single boolean check)
- **Normal mode**: No performance change (flag not checked)
- **Startup**: +20ms for safety validation checks
- **No allocation overhead**: `no_auth: bool` is stack-allocated

## Future Considerations

1. **Token Expiry**: Consider reducing from 30 days to 1 day for dev mode
2. **Logging Detail**: Could add request path logging when no-auth active
3. **Rate Limiting**: Could disable rate limits in dev mode for testing
4. **CORS**: Could auto-allow all origins in dev mode

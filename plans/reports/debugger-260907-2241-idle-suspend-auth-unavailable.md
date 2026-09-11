# Diagnostic Report: 503 Service Unavailable (`authenticationUnavailable`) on Force-Suspend API

## 1. Executive Summary
- **Issue**: Executing `curl -X POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend` with `Authorization: Bearer <token>` fails with:
  ```json
  HTTP/1.1 503 Service Unavailable
  cache-control: no-store
  {
    "error": "manual force sleep requires configured authentication",
    "code": "authenticationUnavailable"
  }
  ```
  after starting the environment with `sudo ./scripts/run-uat.sh start --public-host 100.91.26.60`.
- **Root Cause**:
  1. `scripts/run-uat.sh` was launched without `--env-file`, and `/tmp/dam-hopper-uat/uat.env` was absent. Furthermore, `sudo` environment sanitization stripped caller shell environment variables (`MONGODB_URI`, `MONGODB_DATABASE`).
  2. `dam-hopper-server` (`server/src/main.rs:244-254`) requires both `MONGODB_URI` and `MONGODB_DATABASE` to initialize `state.db`. Because neither variable was present, `state.db` initialized to `None`.
  3. The request's Bearer token **passed** JWT signature validation in `require_auth` middleware (`server/src/api/auth.rs:143-151`), inserting `AuthenticatedActor` into request extensions and dispatching to `force_suspend`.
  4. In `force_suspend` (`server/src/api/idle_suspend.rs:358-370`), the handler invoked `verify_enabled_actor`.
  5. `verify_enabled_actor` (`server/src/api/idle_suspend.rs:121-127`) explicitly asserts `state.db.is_some()`. Because `state.db.is_none()`, it returned `503 Service Unavailable` with code `authenticationUnavailable` and message `"manual force sleep requires configured authentication"`.
- **Security Invariant**: Privileged host-altering mutations (`force-suspend`, `timing`) intentionally reject pure stateless JWT validation. To prevent revoked, suspended, or stale accounts from shutting down host infrastructure, the codebase mandates an active database connection to verify live user enablement (`auth::is_enabled_user`). Absent a database, the system fails closed.

---

## 2. End-to-End Execution Trace

```
[CLI Invocation]
  sudo ./scripts/run-uat.sh start --public-host 100.91.26.60
  │
  ├──► [scripts/run-uat.sh:14, 67-70] ENV_FILE="" (not supplied via CLI)
  ├──► [scripts/run-uat.sh:202-218] start_services() checks:
  │      - [[ -n "$ENV_FILE" ]] -> False
  │      - [[ -f "/tmp/dam-hopper-uat/uat.env" ]] -> False (file absent)
  │      - Sudo sanitization strips MONGODB_URI / MONGODB_DATABASE from caller env
  │      Result: No environment file sourced; no MongoDB vars exported
  │
  └──► [scripts/run-uat.sh:236-244] Spawns dam-hopper-server:
         DAM_HOPPER_CORS_ORIGINS="${FINAL_CORS}" "$API_BIN" --config "$UAT_CONFIG" --host "$API_HOST" --port "$API_PORT"

[Server Startup: server/src/main.rs]
  │
  ├──► [main.rs:65] dotenvy::dotenv().ok() finds no .env in working dir
  ├──► [main.rs:87, 496-518] token = manage_token(cli.new_token)
  │      Reads or generates UUIDv4 token at ~/.config/dam-hopper/server-token
  │      Under sudo, resolves to /root/.config/dam-hopper/server-token
  ├──► [main.rs:244-254] MongoDB connection initialization:
  │      if let (Ok(uri), Ok(name)) = (std::env::var("MONGODB_URI"), std::env::var("MONGODB_DATABASE"))
  │      Both return Err(VarError::NotPresent) -> state.db = None
  └──► [main.rs:265-281] AppState::new(..., token, fs, db=None, no_auth=false, ...)
         Constructs state with state.db = None and state.jwt_secret = Arc::new(token)

[Incoming Request: curl POST /api/system/idle-suspend/v1/force-suspend]
  │
  ▼
[Middleware: server/src/api/auth.rs:129-154] require_auth
  │
  ├──► [auth.rs:136] state.no_auth is false (run-uat started without --no-auth)
  ├──► [auth.rs:143-147] extract_token(&request, &jar).and_then(|t| validated_claims(&t, &state.jwt_secret))
  │      - Bearer token present in Authorization header
  │      - JWT signature matches state.jwt_secret and exp > now
  │      - Claims { sub: "<username>", exp: ... } extracted
  │      (Note: If token was invalid, handler would have exited here with 401 Unauthorized)
  ├──► [auth.rs:149-151] request.extensions_mut().insert(AuthenticatedActor { subject: claims.sub })
  └──► [auth.rs:153] next.run(request).await invokes protected handler

[Route Handler: server/src/api/idle_suspend.rs:342-370] force_suspend
  │
  ├──► [idle_suspend.rs:348-355] verify_transport_guards(&state, request.headers(), ...)
  │      - Content-Type is "application/json" -> OK
  │      - Authorization: Bearer present -> is_bearer=true, uses_cookie=false -> Origin guard bypassed -> OK
  │
  └──► [idle_suspend.rs:358-370] verify_enabled_actor(&state, actor, ...)
         │
         ├──► [idle_suspend.rs:113-119] if state.no_auth -> False (no_auth is false)
         │
         └──► [idle_suspend.rs:121-127] if state.db.is_none() -> TRUE!
                │
                ▼
              Returns 503 Service Unavailable:
              StatusCode: StatusCode::SERVICE_UNAVAILABLE (503)
              Headers: Cache-Control: no-store
              Body: {
                "error": "manual force sleep requires configured authentication",
                "code": "authenticationUnavailable"
              }
              (Execution halts immediately; never reaches actor presence or is_enabled_user checks)
```

---

## 3. Detailed Component Analysis & Line References

### 3.1 `scripts/run-uat.sh`
- **Line 14**: `ENV_FILE=""` initialized empty.
- **Lines 67-70**: `--env-file <file>` flag sets `ENV_FILE="$2"`. When omitted, `ENV_FILE` remains empty.
- **Lines 202-218**:
  ```bash
  if [[ -n "$ENV_FILE" ]]; then
      ...
      . "$ENV_FILE"
  elif [[ -f "$UAT_DIR/uat.env" ]]; then
      ...
      . "$UAT_DIR/uat.env"
  fi
  ```
  Neither condition evaluates true if `--env-file` was not passed and `/tmp/dam-hopper-uat/uat.env` does not exist.
- **Sudo Environment Stripping**: Executing `sudo ./scripts/run-uat.sh` triggers `env_reset` in standard Linux PAM/sudoers configurations. Any caller variables like `MONGODB_URI` exported in user shells are discarded unless `sudo --preserve-env` / `sudo -E` is explicitly invoked.
- **Lines 236-242**: Process invocation for `dam-hopper-server` passes only `DAM_HOPPER_CORS_ORIGINS="${FINAL_CORS}"`. No database environment variables are injected.

### 3.2 `server/src/main.rs` (MongoDB & AppState Initialization)
- **Line 65**: `dotenvy::dotenv().ok();` attempts to locate `.env` relative to current directory. In UAT execution from repo root without a `.env` file, no variables are loaded.
- **Lines 244-254**:
  ```rust
  let db = if let (Ok(uri), Ok(name)) = (
      std::env::var("MONGODB_URI"),
      std::env::var("MONGODB_DATABASE"),
  ) {
      tracing::info!(%name, "Connecting to MongoDB...");
      let client_options = mongodb::options::ClientOptions::parse(&uri).await?;
      let client = mongodb::Client::with_options(client_options)?;
      Some(client.database(&name))
  } else {
      None
  };
  ```
  Missing either `MONGODB_URI` or `MONGODB_DATABASE` causes `db` to evaluate to `None`.
- **Lines 265-281**: `AppState::new(...)` consumes `db` and sets `state.db = None`.

### 3.3 `server/src/api/auth.rs` (require_auth, Claims, JWT Secret)
- **JWT Secret Resolution (`main.rs:87, 476-518`)**:
  - The server **does not** read an environment variable named `JWT_SECRET`.
  - The JWT secret is loaded from `token_path()`:
    ```rust
    fn token_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("~/.config"))
            .join("dam-hopper")
            .join("server-token")
    }
    ```
  - When executed under `sudo`, `dirs::config_dir()` resolves to `/root/.config/dam-hopper/server-token`.
  - If the file exists, it reads the contained token string. If missing, it generates a fresh UUIDv4 (`uuid::Uuid::new_v4().simple().to_string()`), writes it to disk with mode `0o600`, and uses it as `state.jwt_secret`.
- **`require_auth` Middleware (`server/src/api/auth.rs:129-154`)**:
  - `require_auth` runs **before** route handlers for all protected routes (`server/src/api/router.rs:420-423`).
  - Lines 143-147:
    ```rust
    let Some(claims) =
        extract_token(&request, &jar).and_then(|token| validated_claims(&token, &state.jwt_secret))
    else {
        return unauthorized();
    };
    ```
  - If the Bearer token had failed cryptographic validation against `state.jwt_secret` or had expired, `require_auth` would have returned HTTP 401:
    ```json
    401 Unauthorized
    { "error": "Unauthorized" }
    ```
  - Because the response was 503 (`authenticationUnavailable`), the provided Bearer token **successfully validated** at the JWT layer in `require_auth`.

### 3.4 `server/src/api/idle_suspend.rs` (verify_transport_guards, verify_enabled_actor, force_suspend)
- **Transport Guards (`lines 70-99`)**:
  - `is_json`: Verifies `Content-Type: application/json`.
  - `is_bearer`: `auth::extract_bearer_token(headers).is_some()`.
  - `uses_cookie`: `!is_bearer && headers.get(header::COOKIE).is_some()`.
  - Because the request presented `Authorization: Bearer <token>`, `uses_cookie` is `false`. The same-origin CSRF check is bypassed per design.
- **Actor Verification Gate (`lines 105-146`)**:
  ```rust
  pub async fn verify_enabled_actor(
      state: &AppState,
      actor: Option<&AuthenticatedActor>,
      no_auth_code: &'static str,
      no_auth_msg: &'static str,
      db_required_msg: &'static str,
      actor_disabled_msg: &'static str,
  ) -> Result<AuthenticatedActor, Response> {
      if state.no_auth {
          return Err(idle_suspend_error_response(
              StatusCode::FORBIDDEN,
              no_auth_code,
              no_auth_msg,
          ));
      }

      if state.db.is_none() {
          return Err(idle_suspend_error_response(
              StatusCode::SERVICE_UNAVAILABLE,
              IdleSuspendErrorCode::AuthenticationUnavailable.as_code_str(),
              db_required_msg,
          ));
      }

      let Some(actor) = actor else {
          return Err(idle_suspend_error_response(
              StatusCode::UNAUTHORIZED,
              IdleSuspendErrorCode::Unauthorized.as_code_str(),
              "authentication is required",
          ));
      };

      if !auth::is_enabled_user(state.db.as_ref(), &actor.subject).await {
          return Err(idle_suspend_error_response(
              StatusCode::FORBIDDEN,
              IdleSuspendErrorCode::ActorDisabled.as_code_str(),
              actor_disabled_msg,
          ));
      }

      Ok(actor.clone())
  }
  ```
- **Handler Call Site (`lines 358-370`)**:
  - Passed `db_required_msg = "manual force sleep requires configured authentication"`.
  - Passed `no_auth_code = IdleSuspendErrorCode::ForceSuspendDisabledNoAuth.as_code_str()`.
  - Evaluation of line 121 (`if state.db.is_none()`) triggers immediately and returns HTTP 503 `authenticationUnavailable`.

---

## 4. Security Rationale: Why Database Authentication is Mandatory

1. **Privileged OS Impact**:
   Manual force sleep (`POST /api/system/idle-suspend/v1/force-suspend`) and timing mutation (`PATCH /api/system/idle-suspend/v1/timing`) interact with root helper daemon IPC to execute `systemctl suspend`. Suspending the host abruptly breaks active SSH sessions, aborts long-running build/agent jobs, and drops remote access.
2. **Stateless JWT Lifetime vs. Immediate Revocation**:
   JWT tokens issued by `dam-hopper-server` carry a 30-day validity window (`server/src/api/auth.rs:110`). A cryptographic signature confirms only that a token was issued; it cannot detect if the user's access was revoked, if the operator was deactivated, or if the account was disabled after token issuance.
3. **Database-Backed Account Enablement Invariant (`is_enabled_user`)**:
   `auth::is_enabled_user` (`server/src/api/auth.rs:211-221`) queries MongoDB:
   ```rust
   db.collection::<User>("users")
       .find_one(doc! { "username": username })
       .await
       .ok()
       .flatten()
       .is_some_and(|user| user.is_enabled)
   ```
   This ensures that even with a cryptographically valid token, disabled users (`is_enabled: false`) are rejected with `403 actorDisabled`.
4. **Fail-Closed Architecture**:
   Without a connected database (`state.db.is_none()`), the server cannot perform the live enablement check. Rather than falling back to unrevokable JWT acceptance or allowing unauthenticated host shutdown, the server fails closed with `503 authenticationUnavailable`.
5. **No-Auth Mode Rejection**:
   Running with `--no-auth` also fails (`403 forceSuspendDisabledNoAuth`), preventing unauthenticated local network actors from suspending machine hardware.

---

## 5. Token Validation Analysis: Why the Token Passed JWT Check but Failed Actor Gate

| Validation Stage | Location | Condition Checked | Result in Observed Request |
| :--- | :--- | :--- | :--- |
| **Stage 1: Transport Format** | `router.rs:420` / `auth.rs:71-77` | Header `Authorization: Bearer <token>` present | **PASSED** |
| **Stage 2: JWT Signature & Exp** | `auth.rs:93-103` in `require_auth` | `decode::<Claims>(token, key, validation)` matches `state.jwt_secret` | **PASSED** (claims extracted, actor inserted) |
| **Stage 3: Content-Type** | `idle_suspend.rs:76-86` | Header `Content-Type: application/json` | **PASSED** |
| **Stage 4: CSRF Origin Guard** | `idle_suspend.rs:88-96` | Bearer token exempts from cookie same-origin assertion | **PASSED** |
| **Stage 5: Dev Mode Check** | `idle_suspend.rs:113-118` | `state.no_auth == false` | **PASSED** |
| **Stage 6: DB Auth Check** | `idle_suspend.rs:121-127` | `state.db.is_some()` | **FAILED (503 authenticationUnavailable)** |
| **Stage 7: Live Account Enabled** | `idle_suspend.rs:137-143` | `is_enabled_user(db, &actor.subject)` in MongoDB | *Not Reached* (would fail with 403 if user not in DB) |

**Conclusion on Token Validity**:
The token provided in the curl command **did validate** against `state.jwt_secret`. If the token had been invalid, the request would have terminated at Stage 2 with `401 Unauthorized`. The failure occurred at Stage 6 because the server lacked a MongoDB connection to confirm the actor's live status.

---

## 6. Actionable UAT Resolution Steps

To execute manual force-suspend in UAT, the server must run with a connected MongoDB instance and an authenticated, enabled user account.

### Step 1: Prepare UAT Environment File
Create `/tmp/dam-hopper-uat/uat.env` (or a dedicated configuration file such as `deploy/uat.env`):
```bash
# MongoDB connection for UAT
MONGODB_URI="mongodb://127.0.0.1:27017"
MONGODB_DATABASE="dam_hopper_uat"
```
*(Note: Do not define `JWT_SECRET` as an env var expecting the server to read it; `dam-hopper-server` manages its secret via `/root/.config/dam-hopper/server-token` under sudo).*

### Step 2: Ensure MongoDB Service is Running
```bash
sudo systemctl start mongod || sudo systemctl start mongodb
```

### Step 3: Start UAT Environment with Environment File
```bash
# Sourcing via default path /tmp/dam-hopper-uat/uat.env:
sudo ./scripts/run-uat.sh restart --public-host 100.91.26.60

# OR by explicitly passing --env-file:
sudo ./scripts/run-uat.sh restart --public-host 100.91.26.60 --env-file /tmp/dam-hopper-uat/uat.env
```

### Step 4: Provision an Enabled User in MongoDB
The user subject in the JWT must exist in the database with `isEnabled: true`:
1. Register user via API:
   ```bash
   curl -X POST http://100.91.26.60:4803/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username": "admin", "password": "securepassword"}'
   ```
2. Enable user directly in MongoDB (new registrations default to `isEnabled: false`):
   ```bash
   mongosh dam_hopper_uat --eval 'db.users.updateOne({ username: "admin" }, { $set: { isEnabled: true } })'
   ```

### Step 5: Acquire Authenticated JWT Token
```bash
LOGIN_RESP=$(curl -s -X POST http://100.91.26.60:4803/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "securepassword"}')

TOKEN=$(echo "$LOGIN_RESP" | jq -r '.token')
echo "Obtained Token: $TOKEN"
```

### Step 6: Invoke Force-Suspend
```bash
curl -i -X POST http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"wakeAfterSeconds": 0, "force": false}'
```

---

## 7. Unresolved Questions
1. Does the UAT machine currently have MongoDB (`mongod`) installed and running locally, or should UAT point to an external MongoDB cluster URI?
2. Has the helper daemon deployment issue identified in previous report `debugger-260907-0659-idle-suspend-capability-unavailable.md` (where `/opt/dam-hopper/current` pointed to `v0.2.0` lacking `dam-hopper-idle-suspend-helper`) been updated to `v0.3.0` so that the coordinator capability probe succeeds once authentication is unblocked?

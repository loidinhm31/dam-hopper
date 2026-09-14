# Diagnostic Report: 403 Forbidden (`invalidOrigin`) on Force-Suspend API

## 1. Executive Summary
- **Issue**: Calling `POST /api/system/idle-suspend/v1/force-suspend` on API server `http://100.91.26.60:4803` from web origin `http://100.91.26.60:4804` fails with:
  ```json
  403 Forbidden: {"error": "force suspend origin is not allowed", "code": "invalidOrigin"}
  ```
- **Root Cause**: Two compounding issues in `server/src/api/idle_suspend.rs`:
  1. **Strict `Origin == Host` comparison in `same_origin()`**: `idle_suspend.rs:122` checks `authority.as_str().eq_ignore_ascii_case(host_str)`. The authority extracted from `Origin: http://100.91.26.60:4804` includes port `4804`, whereas the `Host` header is `100.91.26.60:4803`. Port `4804` != `4803`, so equality fails. `same_origin()` is completely decoupled from `AppState::cors_origins` and `state.origin_is_allowed()`.
  2. **False assumption that `Cookie` header presence implies cookie-only authentication**: `idle_suspend.rs:150-151` checks `headers.get(header::COOKIE).is_some()`. The browser web client in `packages/ui/src/api/ws-transport.ts:2206` sets `credentials: "include"`, which automatically attaches the session cookie `damhopper-auth` alongside `Authorization: Bearer <token>`. Even though authentication is performed via `Authorization: Bearer` (which is not vulnerable to ambient CSRF and explicitly exempted in Phase 03 spec REQ-15), the presence of the cookie forces execution of the strict same-origin guard.

---

## 2. Technical Analysis & Code Execution Trace

### 2.1 Request Lifecycle in UAT Setup
- **API Server**: Listening on `0.0.0.0:4803`, accessed as `http://100.91.26.60:4803`.
- **Web Host**: Listening on `0.0.0.0:4804`, serving SPA at `http://100.91.26.60:4804`.
- **Runtime Config**: `/__dam-hopper/runtime-config.json` sets `apiUrl: "http://100.91.26.60:4803"`.
- **CORS Config**: `scripts/run-uat.sh:236` launches API server with:
  ```bash
  DAM_HOPPER_CORS_ORIGINS="http://localhost:4804,http://127.0.0.1:4804,http://100.91.26.60:4804"
  ```

### 2.2 Client-Side Invocation
1. User clicks "Force Sleep" in UI (`packages/ui/src/components/organisms/ForceSleepDialog.tsx:94`).
2. Calls `api.system.forceSuspend()` (`packages/ui/src/api/client.ts:1845`).
3. Dispatches via `WsTransport.invoke()` (`packages/ui/src/api/ws-transport.ts:2182-2214`).
4. Line 2203-2214 builds `fetch(fullUrl, init)` with:
   - `fullUrl`: `"http://100.91.26.60:4803/api/system/idle-suspend/v1/force-suspend"`
   - `headers`: `{ "Authorization": "Bearer <jwt>", "Content-Type": "application/json" }`
   - `credentials`: `"include"`
5. Browser dispatches cross-origin HTTP request:
   ```http
   POST /api/system/idle-suspend/v1/force-suspend HTTP/1.1
   Host: 100.91.26.60:4803
   Origin: http://100.91.26.60:4804
   Authorization: Bearer <jwt>
   Cookie: damhopper-auth=<jwt>
   Content-Type: application/json
   ```

### 2.3 Server-Side Middleware & Routing
1. **Tower CORS Layer** (`server/src/api/router.rs:479`):
   - Validates `Origin: http://100.91.26.60:4804` against `allowed_origins` populated from `DAM_HOPPER_CORS_ORIGINS`.
   - Preflight `OPTIONS` succeeds; request dispatched to Axum router.
2. **`require_auth` Middleware** (`server/src/api/auth.rs:125-150`):
   - Calls `extract_token(&request, &jar)` (`auth.rs:72-83`).
   - Lines 74-79: `request.headers().get(header::AUTHORIZATION)` is present and starts with `"Bearer "`. Token extracted.
   - Validates JWT claims; inserts `AuthenticatedActor` into request extensions.
   - Proceeds to handler.

### 2.4 Failure Point: `verify_transport_guards` & `same_origin`
In `server/src/api/idle_suspend.rs:403-415`:
```rust
pub async fn force_suspend(
    State(state): State<AppState>,
    actor: Option<Extension<AuthenticatedActor>>,
    request: Request,
) -> Response {
    // 1 & 2. Transport guards (Content-Type + cookie same-origin)
    if let Err(resp) = verify_transport_guards(
        request.headers(),
        "force suspend requires application/json",
        "force suspend origin is not allowed",
    ) {
        return resp; // <--- FAILS HERE (Line 414)
    }
```

In `server/src/api/idle_suspend.rs:133-157`:
```rust
pub fn verify_transport_guards(
    headers: &HeaderMap,
    content_type_msg: &'static str,
    origin_msg: &'static str,
) -> Result<(), Response> {
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|val| val.to_str().ok())
        .is_some_and(|val| val.starts_with("application/json"));
    if !is_json { ... }

    // Line 150: Checks presence of Cookie header
    let uses_cookie = headers.get(header::COOKIE).is_some();
    // Line 151: Evaluates true because browser sent Cookie: damhopper-auth=...
    if uses_cookie && !same_origin(headers) {
        return Err(idle_suspend_error_response(
            StatusCode::FORBIDDEN,
            IdleSuspendErrorCode::InvalidOrigin.as_code_str(), // "invalidOrigin"
            origin_msg, // "force suspend origin is not allowed"
        ));
    }
    Ok(())
}
```

In `server/src/api/idle_suspend.rs:78-130` (`same_origin`):
```rust
pub fn same_origin(headers: &HeaderMap) -> bool {
    let origin_values: Vec<_> = headers.get_all(header::ORIGIN).iter().collect();
    if origin_values.len() != 1 { return false; }
    let Ok(origin_str) = origin_values[0].to_str() else { return false; };

    let host_values: Vec<_> = headers.get_all(header::HOST).iter().collect();
    if host_values.len() != 1 { return false; }
    let Ok(host_str) = host_values[0].to_str() else { return false; };

    let Ok(origin_uri) = origin_str.parse::<Uri>() else { return false; };
    ...
    let Some(authority) = origin_uri.authority() else { return false; };
    ...
    // Line 122: Direct string equality between Origin authority and Host header
    if !authority.as_str().eq_ignore_ascii_case(host_str) {
        return false; // <--- FAILS HERE
    }
    ...
}
```
- `authority.as_str()` = `"100.91.26.60:4804"` (extracted from `Origin: http://100.91.26.60:4804`).
- `host_str` = `"100.91.26.60:4803"` (from `Host: 100.91.26.60:4803`).
- `"100.91.26.60:4804".eq_ignore_ascii_case("100.91.26.60:4803")` returns `false`.
- `same_origin()` returns `false`.
- Result: `403 Forbidden`, `{"error": "force suspend origin is not allowed", "code": "invalidOrigin"}`.

---

## 3. Investigation Checklist & Findings

| Item | Question | Finding |
|---|---|---|
| **1** | Does `validate_force_suspend_request` check against `cors_origins` or something else? | **Something else.** It calls `verify_transport_guards()`, which calls standalone `same_origin(headers)`. It does NOT inspect `cors_origins`, `AppState`, or server configuration. |
| **2** | Where does the allowed origins list come from? | Server parses `DAM_HOPPER_CORS_ORIGINS` via CLI/env into `state.cors_origins` (`server/src/main.rs:49`, `router.rs:56`). However, `idle_suspend.rs` **never accesses** `state.cors_origins`. |
| **3** | How does `scripts/run-uat.sh` pass configuration? | Passes `DAM_HOPPER_CORS_ORIGINS="http://localhost:4804,http://127.0.0.1:4804,http://100.91.26.60:4804"` as env var to `dam-hopper-server`. Server parses it correctly for Tower CORS layer. |
| **4** | Does `idle_suspend` retrieve or check allowed origins from `AppState`? | **No.** `force_suspend` has `State(state): State<AppState>`, but only passes `request.headers()` to `verify_transport_guards`. |
| **5a** | Does `same_origin` normalize trailing slashes or ports? | Accepts trailing slash (`""` or `"/"`), but **does not normalize or ignore ports**. Line 122 compares full authority (`host:port`) with `Host` header. Port mismatch causes immediate failure. |
| **5b** | Does it check `Origin` vs `Sec-Fetch-Site` vs `Referer`? | Checks **only `Origin` against `Host`**. Does not check `Sec-Fetch-Site` or `Referer`. |
| **5c** | Is `DAM_HOPPER_CORS_ORIGINS` ignored or overridden? | Not ignored by Tower CORS layer, but **completely bypassed** by `idle_suspend.rs` transport guards. |
| **5d** | Does `force-suspend` check a specific origin list separate from CORS origins? | **No origin list exists.** It strictly asserts `Origin.authority == Host`. |
| **6** | What did plan docs specify for `force-suspend` origin security? | - `phase-01`: "Cookie mutations require same-origin JSON; bearer callers still require authenticated enabled account."<br>- `phase-03`: "Same-origin is required only when the request uses the HttpOnly session cookie. Bearer clients are not browser-CSRF capable but still require a valid enabled subject." (Key Insights, Line 25)<br>- `phase-03 REQ-15`: "Bearer token authorization supported without cookie CSRF constraint." |

---

## 4. Configuration & Architectural Mismatch

1. **Multi-Port Architecture vs Strict Same-Origin Assumption**:
   - Production Linux deployment uses Port 4801 (API) and Port 4802 (Web) (`server/src/linux_release/constants.rs:34,45`).
   - UAT deployment uses Port 4803 (API) and Port 4804 (Web) (`scripts/run-uat.sh:8-9`).
   - In both architectures, Web and API run on distinct ports. Without a reverse proxy mapping both under an identical origin, `Origin.authority` and `Host` will **never** match.
2. **Bearer Token Client Treated as Cookie Client**:
   - The web app authenticates primarily with Bearer tokens (`Authorization: Bearer <jwt>`).
   - Because `ws-transport.ts` uses `credentials: "include"` across all requests, the browser also sends the ambient `damhopper-auth` cookie.
   - `idle_suspend.rs` checks `headers.get(header::COOKIE).is_some()`, ignoring the presence of `Authorization: Bearer`.
3. **Sister Endpoint Impact**:
   - `PATCH /api/system/idle-suspend/v1/timing` (`idle_suspend.rs:268`) uses the identical `verify_transport_guards()` and will also fail with 403 when invoked from `:4804`.
   - `POST /api/system/actions/v1/intents` (`host_actions.rs:35`) uses the identical pattern and will also fail.

---

## 5. Recommended Options to Fix (For User Review)

### Option 1: Honor Bearer Exemption (Fulfills Phase 03 REQ-15 Specification)
- **Concept**: A client presenting `Authorization: Bearer <token>` is authenticating via Bearer token, which cannot be forged via ambient browser CSRF. Do not enforce the cookie same-origin guard when `Authorization: Bearer` is present.
- **Implementation Target**: In `server/src/api/idle_suspend.rs` (and `host_actions.rs`):
  ```rust
  let is_bearer = headers
      .get(header::AUTHORIZATION)
      .and_then(|v| v.to_str().ok())
      .is_some_and(|v| v.starts_with("Bearer "));
  let uses_cookie = !is_bearer && headers.get(header::COOKIE).is_some();
  if uses_cookie && !same_origin(headers) { ... }
  ```
- **Pros**: Matches Phase 03 specification REQ-15 exactly; zero API changes; solves issue immediately for the web frontend.
- **Cons**: Requests relying *solely* on cookies from cross-origin web hosts would still be rejected unless Option 2 is also applied.

### Option 2: Align Origin Validation with `AppState::origin_is_allowed()`
- **Concept**: Instead of hardcoded `same_origin(headers)`, pass `&AppState` into `verify_transport_guards` and use `state.origin_is_allowed(headers)` (defined in `server/src/state.rs:404`), which permits configured `cors_origins` (e.g., `http://100.91.26.60:4804`) as well as same-origin.
- **Implementation Target**:
  ```rust
  pub fn verify_transport_guards(
      state: &AppState,
      headers: &HeaderMap,
      content_type_msg: &'static str,
      origin_msg: &'static str,
  ) -> Result<(), Response> {
      ...
      let uses_cookie = headers.get(header::COOKIE).is_some();
      if uses_cookie && !state.origin_is_allowed(headers) { ... }
  ```
- **Pros**: Unifies origin validation logic across the entire server (`state.rs`, `router.rs`, `ws.rs`); supports cookie-authenticated cross-origin requests from explicitly whitelisted web hosts.
- **Cons**: Slightly wider attack surface than pure same-origin if an untrusted origin were ever whitelisted in CORS.

### Option 3: Combined Defense-in-Depth (Recommended)
- Apply both:
  1. Skip cookie same-origin check if valid Bearer token header is present (`!is_bearer`).
  2. If using cookie-only auth, check `state.origin_is_allowed(headers)` so configured UAT/prod web origins are permitted.

### Option 4: Frontend-side Request Credentials Adjustments
- In `packages/ui/src/api/ws-transport.ts:2206`, when making cross-origin REST calls that supply `Authorization: Bearer`, do not send `credentials: "include"` (use `credentials: "same-origin"`).
- **Pros**: Pure client-side change.
- **Cons**: Does not fix the underlying server defect; fragile against future endpoints or cookie-dependent features.

---

## 6. Unresolved Questions
- None. Root cause, exact code lines, configuration mismatch, and execution path are completely identified.

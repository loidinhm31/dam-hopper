# Phase 04 — Proxy Route Backend (/proxy/:port/*, Auth, Security)

## Context Links

- Parent plan: `plans/20260424-terminal-split-and-port-forward/plan.md`
- Depends on: `phase-03-port-detection-backend.md` (PortForwardManager, allowlist)
- Scout: `scout/scout-01-codebase-touchpoints.md` §Axum router, §WS upgrade + auth pattern, §HTTP client
- Research: `research/researcher-02-proxy-portdetect.md` §2, §3, §4, §5, §6

## Overview

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Description | Mount `/proxy/:port/*path` reverse proxy route in Axum. Auth via `?token=` short-lived JWT for WS, `Authorization: Bearer` for HTTP. 10-item security hardening. `axum-reverse-proxy` crate as primary; manual WS bridge as fallback. |
| Priority | P2 |
| Implementation status | pending |
| Review status | pending |
| Effort | ~10h |

## Key Insights

- `axum-reverse-proxy` handles HTTP + WS upgrade transparently; upstream `127.0.0.1` hardcoded — no SSRF (researcher-02 §2).
- Browsers cannot set `Authorization` on `new WebSocket()` — use `?token=<short-lived-jwt>` query param issued by `GET /api/proxy-token` (researcher-02 §4).
- Auth pattern mirrors `server/src/api/ws.rs:65-84` exactly: read token from `?token=` query or `Authorization: Bearer` header, validate JWT, check `state.no_auth` bypass (scout §WS upgrade + auth pattern).
- `/proxy/*` must NOT be under `protected` (cookie middleware layer) — needs custom inline auth to support browser navigation + WS (scout §Auth middleware).
- `axum-reverse-proxy` WS subprotocol passthrough (Vite HMR `vite-hmr`) is **unverified** — fallback to manual two-leg WS bridge if needed (researcher-02 §9 unresolved).

## Requirements

### Functional
1. `GET /api/proxy-token` (auth required): issue short-lived JWT (5 min TTL), return `{ token, expires_in }`.
2. `/proxy/:port/*path` accepts HTTP + WS; forwards to `http://127.0.0.1:<port>/<path>`.
3. Auth: `?token=<jwt>` (for WS + browser nav) or `Authorization: Bearer <token>` (for fetch). `state.no_auth` bypasses both.
4. Port allowlist: reject with 403 if port not in `port_forward_manager.list()` confirmed LISTEN ports.
5. Security hardening (10 items, see Security Considerations).
6. 30s proxy timeout; return 504 on upstream timeout.
7. Return 502 if upstream port not reachable (connection refused).

### Non-Functional
- Proxy route added as 4th router branch in `build_router()` — no auth middleware layer (inline auth only).
- `axum-reverse-proxy` dep added to `server/Cargo.toml`.
- All unit-testable security checks extracted to pure functions.

## Architecture

### Route Wiring in `router.rs`

```rust
// server/src/api/router.rs — build_router()
let proxy_routes = Router::new()
    .route("/proxy/:port/*path", get(proxy_handler)
        .post(proxy_handler)
        .put(proxy_handler)
        .delete(proxy_handler)
        .patch(proxy_handler));
// Merge WITHOUT auth middleware layer:
app.merge(proxy_routes)
```

### `GET /api/proxy-token` Handler

```
POST /api/proxy-token (protected: yes, requires Bearer token)
  → issue short-lived JWT:
      claims = { sub: "proxy", exp: now()+300, iat: now() }
      sign with same HMAC key as existing auth tokens
  → return { "token": "<jwt>", "expires_in": 300 }
```

Add to `protected` router branch (reuses existing auth middleware).

### `proxy_handler` — Auth + Allowlist Check

```
fn proxy_handler(State(state), Path((port, path)), Query(params), headers, req):
  1. auth check:
     if !state.no_auth:
       token = params.get("token") OR headers["Authorization"].strip_prefix("Bearer ")
       validate_jwt(token) → 401 if invalid/missing
  2. allowlist check:
     if port_forward_manager.list().none(|p| p.port == port && p.state == Listening):
       return 403 Forbidden
  3. safety check (pure fn): port_is_allowed(port) → 403 if false
  4. build upstream URL: format!("http://127.0.0.1:{}/{}", port, path)
  5. detect WS upgrade:
     if headers["Upgrade"] == "websocket":
       ws_proxy(port, path, req, state)
     else:
       http_proxy(port, path, req, state)
```

### HTTP Proxy Path (`axum-reverse-proxy`)

```rust
// Configured once at startup or per-request:
let rp = ReverseProxy::new(format!("http://127.0.0.1:{}", port));
rp.call(req).await
// Post-process response: strip auth headers added by upstream (should not be present but guard anyway)
```

Security transforms applied BEFORE forwarding:
- Strip `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` from inbound request
- Set own `X-Forwarded-For: 127.0.0.1`
- Strip `Authorization` from request before forwarding upstream
- Set `timeout(30s)` on upstream call

### WS Proxy Path (Manual Two-Leg Bridge — Fallback)

If `axum-reverse-proxy` fails subprotocol passthrough:

```
axum::extract::WebSocketUpgrade:
  client_ws = upgrade.on_upgrade(...)
  upstream_ws = tokio_tungstenite::connect_async(upstream_url).await?
  tokio::spawn: bidirectional copy:
    loop { select! {
      client_msg => upstream_ws.send(client_msg)
      upstream_msg => client_ws.send(upstream_msg)
    }}
```

Origin check before upgrade: `request.headers()["Origin"]` must match expected `dam-hopper` server host.

### `GET /api/proxy-token` Token Format

Same HMAC key as `server-token`. Short-lived claims:

```json
{ "sub": "proxy-access", "exp": <now+300>, "iat": <now>, "scope": "proxy" }
```

Validate `scope == "proxy"` in `proxy_handler` — prevents reuse of long-lived server token as proxy token.

### File-level Changes

| File | Action |
|------|--------|
| `server/Cargo.toml` | Add `axum-reverse-proxy = "0.4"` |
| `server/src/api/router.rs:1` | Add proxy router branch (no auth layer) |
| `server/src/api/proxy.rs` | Create — `proxy_handler`, `http_proxy`, `ws_proxy`, `port_is_allowed` |
| `server/src/api/proxy_token.rs` | Create — `proxy_token_handler` (issue short-lived JWT) |
| `server/src/api/mod.rs` | Export new modules |

## Related Code Files

- `server/src/api/router.rs:1` — `build_router()`: merge 4th proxy branch
- `server/src/api/ws.rs:65-84` — auth inline pattern to mirror in `proxy_handler`
- `server/src/api/ws.rs:127-130` — `state.no_auth` check (currently missing — proxy must add it)
- `server/src/api/auth.rs:~78` — `require_auth` middleware (NOT used for proxy, only for `proxy_token` endpoint)
- `server/src/state.rs:18-40` — `AppState`; proxy handler reads `port_forward_manager` + `no_auth`
- `server/Cargo.toml:21` — existing `tower-http`; add `axum-reverse-proxy`
- `server/Cargo.toml:94` — `reqwest = "0.12"` with `stream` — available for manual WS bridge if needed
- `server/Cargo.toml:111` — `tokio-tungstenite = "0.26"` — available for WS bridge

## Implementation Steps

1. Add `axum-reverse-proxy = "0.4"` to `server/Cargo.toml`. Confirm it compiles (`cargo check`).
2. Create `server/src/api/proxy_token.rs`:
   - `proxy_token_handler`: extract authenticated user from existing `require_auth` extractor, issue short-lived JWT with `scope: "proxy"`, return JSON.
3. Create `server/src/api/proxy.rs`:
   a. `fn port_is_allowed(port: u16) -> bool`: reject <1024, reject danger list `{22, 25, 110, 143, 3306, 5432, 6379, 27017}`, reject >65535.
   b. `async fn proxy_handler(...)`: inline auth (mirror `ws.rs:65-84`), allowlist check, safety check, route to `http_proxy` or `ws_proxy`.
   c. `async fn http_proxy(port, path, req, state)`: build upstream URL, strip inbound forwarded headers, strip Authorization header, call `axum-reverse-proxy`, set 30s timeout, return response.
   d. `async fn ws_proxy(port, path, req, state, ws_upgrade)`: Origin check, `tokio_tungstenite::connect_async`, bidirectional copy loop, handle disconnect on either side.
4. Modify `server/src/api/router.rs`:
   - Add proxy routes (all HTTP methods) without auth layer.
   - Add `GET /api/proxy-token` to protected branch.
5. Wire `proxy_handler` state: inject `port_forward_manager` from `AppState`.
6. Add `no_auth` bypass to `proxy_handler` (missing from `ws.rs` — fix simultaneously per scout §WS upgrade + auth pattern gap).
7. Write unit tests for `port_is_allowed`: verify 22 rejected, 5173 allowed, 80 rejected, 65536 rejected.
8. Integration smoke test: start Vite; fetch `GET /api/proxy-token`; use token in `?token=` param; `GET /proxy/5173/` returns 200.
9. WS smoke test: open WS to `/proxy/5173/?token=<t>` — HMR events flow through (test `vite-hmr` subprotocol passthrough).
10. If subprotocol fails with `axum-reverse-proxy`, switch `ws_proxy` to manual two-leg bridge (step 3d).
11. `cargo test proxy` green; `cargo build --release` compiles.

## Todo List

- [ ] Add `axum-reverse-proxy = "0.4"` to Cargo.toml
- [ ] Create `proxy_token.rs` (short-lived JWT issue)
- [ ] Create `proxy.rs` (`port_is_allowed`, `proxy_handler`, `http_proxy`, `ws_proxy`)
- [ ] Modify `router.rs` (proxy branch + proxy-token to protected)
- [ ] Add `no_auth` bypass to proxy_handler
- [ ] Unit tests for `port_is_allowed`
- [ ] Integration smoke test: HTTP proxy via short-lived token
- [ ] WS smoke test: subprotocol passthrough (or switch to manual bridge)
- [ ] `cargo test proxy` green
- [ ] `cargo build --release` compiles

## Success Criteria

- `GET /proxy/5173/` with valid token → 200, Vite app body returned
- `GET /proxy/5173/` without token → 401
- `GET /proxy/22/` with valid token → 403 (danger list)
- `GET /proxy/9999/` with valid token (port not detected) → 403 (not in allowlist)
- WS upgrade to `/proxy/5173/?token=<t>` → bidirectional; HMR works
- `state.no_auth=true` → all proxy requests pass without token
- Short-lived token (>5min) rejected → 401

## Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| `axum-reverse-proxy` WS subprotocol passthrough fails for Vite HMR | HMR broken | Fallback to manual two-leg WS bridge (researcher-02 §3 option B) |
| Proxy token reuse (long-lived server token used as proxy token) | Auth bypass | Validate `scope == "proxy"` in `proxy_handler`; server token lacks this claim |
| Upstream redirect to non-loopback (SSRF via 302) | SSRF | Disable redirect following in HTTP client; return 502 on any redirect |
| WS proxy holds goroutine open indefinitely | Resource leak | Timeout on idle WS connection (e.g., 10min); handle both-side disconnect |
| `axum-reverse-proxy` version 0.4 may not be on crates.io yet | Build failure | Verify crate version; fallback to manual `hyper_util` proxy (~80 LOC from axum example) |

## Security Considerations

All 10 hardening items from researcher-02 §5 — each must be implemented:

1. **Allowlist only detected ports**: `proxy_handler` checks `port_forward_manager.list()` before forwarding. 403 if port not confirmed LISTEN.
2. **Force loopback target**: upstream URL always `http://127.0.0.1:<port>/<path>` — never resolve user-supplied host. Blocks SSRF to metadata services, RFC1918 ranges.
3. **IPv6 loopback check**: port detection also checks `::1` entries in `/proc/net/tcp6`; proxy target remains `127.0.0.1` regardless.
4. **Strip inbound X-Forwarded-***: remove `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` from client request before forwarding. Set own `X-Forwarded-For: 127.0.0.1`.
5. **Strip Authorization before forwarding**: remove `Authorization` header from request copy sent upstream — prevents token leakage to upstream service.
6. **Require auth on all /proxy/***: even with `state.no_auth=false`, all requests need valid token. `state.no_auth=true` bypasses for dev mode only.
7. **Port range restriction**: reject ports <1024 (privileged) and dangerous ports `{22, 25, 110, 143, 3306, 5432, 6379, 27017}`. Implemented in `port_is_allowed()`.
8. **Timeout**: 30s upstream request timeout. 504 returned on expiry. WS connections: 10min idle timeout.
9. **Rate limit**: not in MVP scope — note as future hardening. Document in code as `// TODO: rate limit /proxy/* per session`.
10. **Origin validation on WS upgrade**: check `Origin` header matches expected `dam-hopper` server host before upgrade. Mitigates cross-site WS hijack (Gitpod RCE pattern, researcher-02 §5 ref).
11. **No redirect following**: HTTP client configured with `redirect::Policy::none()` — any 3xx from upstream returns 502.

## Next Steps

Phase 04 merged → Phase 05 can build `PortsPanel` using `GET /api/ports` + `port:discovered` WS events + `/proxy/:port/` URLs.

## Unresolved Questions

1. Does `axum-reverse-proxy` 0.4.x exist on crates.io? Verify exact latest version before adding dep.
2. WS `vite-hmr` subprotocol: does `axum-reverse-proxy` pass `Sec-WebSocket-Protocol` through? Lab test required.
3. Port disappearance while proxy in-flight: return 502 immediately or drain existing connections first?
4. Should proxy token be stored in `AppState` for revocation, or stateless JWT-only (current plan)?

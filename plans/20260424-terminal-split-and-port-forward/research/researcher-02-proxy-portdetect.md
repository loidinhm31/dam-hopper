# Research: F-15 Port Forwarding + Service Discovery
Date: 2026-04-24

---

## 1. Recommended Port Detection Strategy

### Primary: `/proc/net/tcp` + `/proc/net/tcp6` parsing (Linux-only)
- Parse hex-encoded local address/port in column 2, filter `st == 0A` (LISTEN).
- Hex quirks: address is little-endian 4-byte hex (`0100007F` = `127.0.0.1`), port is big-endian 2-byte hex (`1F90` = 8080). IPv6 entries in `/proc/net/tcp6` use 16-byte little-endian groups.
- Join with owning PID: read `/proc/<pid>/net/tcp` (namespace-scoped) or match `inode` column (col 10) against `/proc/<pid>/fd/` symlink targets. `procfs` crate (`docs.rs/procfs`) wraps this cleanly — `TcpState::Listen`, `UdpState` enums, `TcpEntry::local_address`.
- Filter to PIDs owned by active PTY sessions. Map<SessionId → child_pid> already tracked in `PtySessionManager`.
- Poll on a 2-second Tokio interval; emit WS events on diff.

### Fallback: PTY stdout regex scanning
Fast initial detection (sub-second) before the kernel bind is polled. Scan each PTY broadcast buffer for patterns:
```
"Listening on :(\d+)"                       # generic
"localhost:(\d+)"                           # many servers
"http://(?:localhost|127\.0\.0\.1):(\d+)"   # Node/Bun/Deno
"Local:\s+http://localhost:(\d+)"           # Vite
"-> Local:\s+http://localhost:(\d+)"        # Cloudflare tunnel style
"server listening on.*:(\d+)"              # i/case
"bound to.*:(\d+)"                          # low-level
"0\.0\.0\.0:(\d+)"                         # bind-all
```
ANSI-strip before regex (strip `\x1b\[[0-9;]*m` and similar). Treat regex hit as "candidate"; `/proc` poll confirms actual LISTEN state — prevents false positives from log replays.

### Recommendation
**Hybrid**: regex → immediate provisional detection, `/proc` → authoritative confirmation + disappearance detection. `ss`/`netstat` subprocess avoided (parsing fragility, PATH dependency, non-zero exit on empty).

---

## 2. Axum Proxy Crate/Pattern

### `axum-reverse-proxy` crate
- crates.io: https://crates.io/crates/axum-reverse-proxy  
- docs.rs: https://docs.rs/axum-reverse-proxy  
- Sits on top of `axum` + `hyper`. Provides `ReverseProxy` handler. WS upgrade: auto-detects `Upgrade: websocket` header, maps `http→ws`, `https→wss`. Flag `preserve_websocket_headers: true` retains `Sec-WebSocket-Key`, `Sec-WebSocket-Version`. RFC 9110 `Via` header combining. Actively maintained (0.4.x as of 2025).
- Sufficient for DamHopper: add as dep, mount at `/proxy/:port/*path`.

### Official tokio-rs axum example (fallback/reference)
- URL: https://github.com/tokio-rs/axum/blob/main/examples/reverse-proxy/src/main.rs
- ~80 LOC. Uses `hyper_util::client::legacy::Client` with `HttpConnector`. Does NOT handle WS upgrade natively — must layer on top.

### Verdict
Use `axum-reverse-proxy` as primary dep. If WS behavior is insufficient, layer manual upgrade via `axum::extract::WebSocketUpgrade` + `tokio_tungstenite::connect_async` to upstream.

---

## 3. WebSocket Upgrade Proxy Approach

### Option A: `axum-reverse-proxy` built-in (preferred)
Handles upgrade transparently. No extra code. Limitation: cannot inject auth tokens mid-stream.

### Option B: Manual two-leg WS bridge
```
Client WS → axum WebSocketUpgrade extractor → tokio_tungstenite::connect_async(upstream) → bidirectional copy
```
~60 LOC. Gives full control: auth check before upgrade, header injection. Use `tokio::io::copy_bidirectional` or `futures::stream::select`.

### Option C: `hyper-util` raw upgrade
`hyper_util::rt::TokioIo` + `hyper::upgrade::on()` — low-level, ~150 LOC. Overkill.

**Recommendation**: Start with option A (`axum-reverse-proxy`). If auth injection needed during WS handshake, switch to option B.

---

## 4. Auth Strategy for `/proxy/*` Routes

Browsers **cannot** set `Authorization` header on `new WebSocket()` — this is a hard platform constraint.

### Layered strategy:
1. **HTTP requests**: standard `Authorization: Bearer <token>` in header (existing DamHopper pattern).
2. **WebSocket handshake**: browser sends `?token=<jwt>` query param on initial upgrade request. Server validates before upgrading. Short-lived token (5–15 min) issued by `GET /api/proxy-token` (requires bearer auth).
3. **Cookie fallback**: `HttpOnly; SameSite=Strict` session cookie auto-sent by browser on same-origin WS. Simpler but requires session management.
4. **WS subprotocol trick** (`Sec-WebSocket-Protocol: token.<value>`): non-standard, logs tokens, avoid.

**DamHopper recommendation**: `?token=` query param (short-lived JWT, issued by authenticated REST call). Matches Gitpod/code-server pattern. Avoids cookie complexity.

---

## 5. Security Hardening Checklist

- [ ] **Allowlist only detected ports** — `/proxy/:port` rejected unless port is in `active_ports` set (ports confirmed LISTEN by a PTY session owned by this server). Blocks `/proxy/22`, `/proxy/3306`, etc.
- [ ] **Force loopback target** — upstream always `http://127.0.0.1:<port>`, never resolve user-supplied host. Blocks SSRF to `169.254.169.254`, RFC1918, IPv6 `::1` escapes.
- [ ] **IPv6 loopback** — also check `::1` in `/proc/net/tcp6`; proxy target hardcoded to `127.0.0.1` regardless.
- [ ] **Strip inbound X-Forwarded-* before setting own** — prevents header injection spoofing.
- [ ] **Strip internal auth headers before forwarding** — remove `Authorization`, `X-Dam-Hopper-Token` before sending to upstream service.
- [ ] **Require auth on all `/proxy/*`** — no unauthenticated access even to "public" ports.
- [ ] **Port range restriction** — reject ports < 1024 (privileged) and > 65535. Optional: block well-known dangerous ports (22, 25, 110, 143, 3306, 5432, 6379, 27017).
- [ ] **Timeout** — proxy request timeout (e.g., 30s) to prevent resource exhaustion.
- [ ] **Rate limit** — per-session rate limit on `/proxy/*` to prevent abuse.
- [ ] **Origin validation on WS upgrade** — check `Origin` header matches expected domain (mitigates cross-site WS hijack, ref: Gitpod 0-day via missing Origin check — https://snyk.io/blog/gitpod-remote-code-execution-vulnerability-websockets/).
- [ ] **No redirect following** — upstream HTTP client must NOT follow redirects (could redirect to non-loopback).

---

## 6. URL Scheme: Path-Based vs Subdomain

| Scheme | Example | Pros | Cons |
|--------|---------|------|------|
| Subdomain | `https://8080.dam.local` | Clean isolation, no CORS | Requires wildcard TLS, DNS |
| Path-based | `/proxy/8080/` | Works on any host, zero DNS config | Path stripping complexity, some apps with absolute URLs break |

**DamHopper should use path-based** (`/proxy/:port/*path`). Matches code-server model. No DNS/TLS complexity for local tool. Apps that embed absolute `localhost:PORT` URLs will break (known limitation; document it).

---

## 7. TOML / API Surface

### `GET /api/ports`
```json
{
  "ports": [
    {
      "port": 5173,
      "session_id": "uuid",
      "project": "my-app",
      "detected_via": "stdout_regex | proc_net",
      "proxy_url": "/proxy/5173/",
      "state": "listening"
    }
  ]
}
```

### WS push events (over existing `/ws` envelope)
```json
{ "kind": "ports:discovered", "port": 5173, "session_id": "...", "project": "my-app" }
{ "kind": "ports:lost",       "port": 5173, "session_id": "..." }
```

### `GET /api/proxy-token` (auth required)
Returns short-lived JWT for WS proxy auth:
```json
{ "token": "<jwt>", "expires_in": 300 }
```

### `dam-hopper.toml` additions (optional per-project)
```toml
[[projects]]
name = "web"
port_hints = [3000, 5173]   # pre-seed expected ports; skip discovery latency
proxy_enabled = true         # default true
```

---

## 8. Reference Implementations

| Resource | URL |
|----------|-----|
| `axum-reverse-proxy` crate | https://crates.io/crates/axum-reverse-proxy |
| `axum-reverse-proxy` docs | https://docs.rs/axum-reverse-proxy |
| Official axum reverse-proxy example (~80 LOC) | https://github.com/tokio-rs/axum/blob/main/examples/reverse-proxy/src/main.rs |
| `procfs` crate net module | https://docs.rs/procfs/latest/procfs/net/index.html |
| `listeners` crate (cross-platform port→PID) | https://github.com/GyulyVGC/listeners |
| OWASP SSRF cheat sheet | https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| Gitpod WS RCE (Origin bypass) | https://snyk.io/blog/gitpod-remote-code-execution-vulnerability-websockets/ |
| Ably WS auth guide | https://ably.com/blog/websocket-authentication |
| Gitpod ports docs | https://www.gitpod.io/docs/configure/workspaces/ports |

---

## 9. Risks + Unresolved Questions

**Risks:**
- `axum-reverse-proxy` WS upgrade path untested against Vite HMR specifically (uses custom WS subprotocol `vite-hmr`). May need `preserve_websocket_headers: true` + subprotocol passthrough.
- Path-based proxy breaks apps that generate absolute URLs (`window.location.origin`) — no fix short of response body rewriting (complex, avoid).
- `/proc/net/tcp` is Linux-only. macOS dev machines need `ss`/`lsof` fallback or `listeners` crate (cross-platform).
- Short-lived proxy tokens add a REST round-trip before WS connect — acceptable latency but requires client-side token refresh logic.

**Unresolved:**
- Does `axum-reverse-proxy` 0.4.x correctly pass `Sec-WebSocket-Protocol` subprotocols through (needed for Vite HMR `vite-hmr` subprotocol)? Needs lab test.
- `listeners` crate (`github.com/GyulyVGC/listeners`) — license and maintenance status not confirmed.
- Port disappearance detection: should proxy return 502 immediately or queue requests briefly waiting for restart? Decision deferred to implementation phase.
- Should detected ports be persisted across server restarts (e.g., in a sidecar state file)? Current architecture is in-memory only.

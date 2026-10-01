# Diagnostic Report: CORS Preflight Failure and Agent Status Snapshot Investigation

**Report ID:** `debugger-261001-0808-cors-preflight-and-agent-status`  
**Date:** 2026-10-01  
**Target Environment:** Release v0.8.0, Linux x86_64, Host `100.91.26.60` (API: `4801`, Web: `4802`)  
**Scope:** Root-cause analysis only. No code fixes implemented.

---

## 1. Executive Summary

| Issue | Status | Root Cause | Business / Operational Impact | Priority |
|---|---|---|---|---|
| **Issue 1**: UI calls `GET /api/agent-status/v1/snapshot` | **Expected Behavior** (Not a bug) | App-root `<AgentStatusBridge />` registers a 15s reconciliation timer (`useAgentStatusConnections`) matching server's 15s agent lease expiry. Conflated by operator with daemon CLI `dam-hopper status`. | Zero operational defect. Harmless 15s HTTP polling overhead for connected profiles; provides safety net over WebSockets. | P4 (Clarification / Docs) |
| **Issue 2**: CORS failure on `GET /api/system/resources/v1/events` | **Active Defect** | `server/src/api/router.rs` placed `CACHE_CONTROL` in `expose_headers` instead of `allow_headers`. Client sends non-safelisted `Cache-Control: no-store` cross-origin (port 4802 -> 4801), failing preflight. | High. Real-time host resource SSE stream completely blocked in browser; falls back to degraded REST polling or fails stream subscription. | P1 (Immediate Fix Required) |

---

## 2. Issue 1: UI calls `GET /api/agent-status/v1/snapshot`

### 2.1 Code Trace & Call Origin
1. **Entry Point (App Root):**
   - File: `packages/ui/src/embed/dam-hopper-app.tsx:352`
   - Mounts `<AgentStatusBridge />` unconditionally at root application level.
2. **Bridge Component:**
   - File: `packages/ui/src/components/organisms/AgentStatusBridge.tsx:4-6`
   ```tsx
   export function AgentStatusBridge(): null {
     useAgentStatusConnections();
     return null;
   }
   ```
3. **Connection Hook:**
   - File: `packages/ui/src/hooks/use-agent-status-connections.ts:209-260`
   - `useAgentStatusConnections()` listens to profile connection lifecycle (`subscribeConnections(sync)`).
   - For every connected profile (`snapshot.status === "connected"`), spawns `watchAgentStatusConnection(owner, api, transport)`.
4. **Watcher & Periodic Timer:**
   - File: `packages/ui/src/hooks/use-agent-status-connections.ts:33, 40-191`
   - Defines `const RECONCILE_INTERVAL_MS = 15_000;`.
   - Starts periodic interval: `const timer = setInterval(requestBaseline, RECONCILE_INTERVAL_MS);` (line 183).
   - Immediately fires initial baseline request: `requestBaseline();` (line 184).
5. **API & Transport Layer:**
   - File: `packages/ui/src/hooks/use-agent-status-connections.ts:69-70`: calls `api.agentStatusSnapshot()`.
   - File: `packages/ui/src/api/client.ts:2579-2582`: invokes `transport.invoke<unknown>("terminal:agentStatusSnapshot")`.
   - File: `packages/ui/src/api/ws-transport.ts:593-594`:
     ```ts
     case "terminal:agentStatusSnapshot":
       return { method: "GET", url: "/api/agent-status/v1/snapshot" };
     ```
   - Dispatches HTTP `GET http://100.91.26.60:4801/api/agent-status/v1/snapshot`.

### 2.2 Architectural Purpose & Interval Justification
- **Subsystem:** AI Agent Status tracking introduced in v0.8.0 for AI assistants (OMP, Claude Code, OpenAI Codex) operating inside terminal PTY sessions (`server/src/agent_status/`).
- **Baseline Initialization:** Upon connecting to a profile, client needs initial authoritative state of all live terminal agents (`AgentStatusSnapshotV1`).
- **15-Second Evidence Lease Alignment:**
  - The server runtime enforces a strict 15-second evidence lease on agent observations (`docs/architecture/agent-status.md:84-86`, `memory://root/memory_summary.md`).
  - If an agent crashes, exits abruptly, or stops reporting heartbeats, server reverts its status to `Unknown` after 15 seconds.
  - Server runs background lease sweep task every 1 second (`server/src/main.rs:709`).
- **Resilience Against Dropped Push Events:**
  - Primary updates stream via WebSocket push events (`terminal:agentStatusChanged`, `terminal:agentStatusRemoved`, `terminal:agentStatusInvalidated`).
  - Periodic polling at 15s (`RECONCILE_INTERVAL_MS`) guarantees client state converges with server state if WebSocket messages drop, client sleeps/wakes, buffer overflows (>256 events), or sequence number gaps occur.

### 2.3 Evaluation: Defect vs Expected Behavior
- **Expected Architectural Behavior:** Request is intentional, correctly wired, and essential for terminal agent status consistency.
- **Why User Perceived As Unexpected:**
  1. **Semantic Collision with `dam-hopper status` CLI:**
     - Operator ran or investigated `dam-hopper status`, which is the Linux release manager CLI inspecting host systemd services (`dam-hopper-api.service`, `dam-hopper-web.service`, `dam-hopper-idle-suspend-helper.service`, `dam-hopper-plugin-runner.service`).
     - Operator mistakenly assumed `/api/agent-status/v1/snapshot` was related to daemon health/status checks rather than AI coding agent tracking in terminal tabs.
  2. **Expectation of 100% Push Architecture:**
     - In WebSocket-driven web apps, recurring HTTP GET traffic every 15s is frequently mistaken for an accidental polling loop or uncleaned interval.
  3. **No Active Agents Running:**
     - If the user had not launched OMP, Codex, or Claude inside any terminal, requesting agent status snapshots appeared superfluous, even though the bridge monitors proactively for session starts.

---

## 3. Issue 2: CORS Failure on `GET /api/system/resources/v1/events`

### 3.1 Client Origin & Request Headers
- **Invoking Component:** `HostResourceStreamCoordinator` (`packages/ui/src/api/host-resource-stream-coordinator.ts:524-525`).
- **Origin Method:** `WsTransport.openHostResourceEvents(signal?: AbortSignal)` (`packages/ui/src/api/ws-transport.ts:1949-1965`, introduced in commit `51d23734`):
  ```ts
  const url = `${this.baseUrl}/api/system/resources/v1/events`;
  const headers: Record<string, string> = {
    ...this.buildAuthHeaders(), // Authorization: Bearer <token>
    Accept: "text/event-stream",
    "Cache-Control": "no-store",
  };
  response = await fetch(url, {
    method: "GET",
    headers,
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: controller.signal,
  });
  ```
- **Sent Request Headers:**
  - `Authorization: Bearer <token>`
  - `Accept: text/event-stream`
  - `Cache-Control: no-store`

### 3.2 Preflight (OPTIONS) Mechanism & Cause of Failure
1. **Cross-Origin Boundary:**
   - Web application origin: `http://100.91.26.60:4802`
   - API target origin: `http://100.91.26.60:4801`
   - Different TCP port numbers constitute different origins under the Same-Origin Policy.
2. **CORS-Safelisted Header Violation:**
   - W3C/WHATWG Fetch standard defines CORS-safelisted request headers strictly as: `Accept`, `Accept-Language`, `Content-Language`, and `Content-Type` (restricted MIME types only).
   - Neither `Authorization` nor `Cache-Control` is CORS-safelisted.
   - When a browser makes a cross-origin request containing `Cache-Control: no-store`, it is mandated to send an HTTP `OPTIONS` preflight request containing:
     ```http
     Access-Control-Request-Method: GET
     Access-Control-Request-Headers: authorization, cache-control
     ```
3. **Backend CORS Filter Mismatch (`server/src/api/router.rs`):**
   - Configured in `build_cors(allowed_origins: &[HeaderValue]) -> CorsLayer` (lines 758-804):
     ```rust
     let headers = [
         AUTHORIZATION,
         CONTENT_TYPE,
         ACCEPT,
         RANGE,
         IF_RANGE,
         IF_NONE_MATCH,
         IF_MODIFIED_SINCE,
         X_EXPECTED_SHA256,
         X_EXPECTED_SECURITY_REVISION,
     ];
     let exposed_headers = [
         ACCEPT_RANGES,
         CONTENT_RANGE,
         CONTENT_LENGTH,
         CONTENT_DISPOSITION,
         ETAG,
         LAST_MODIFIED,
         CACHE_CONTROL,
         X_EXPECTED_SHA256,
         X_EXPECTED_SECURITY_REVISION,
         X_PLUGIN_UI_SHA256,
         X_CONTENT_TYPE_OPTIONS,
     ];
     CorsLayer::new()
         .allow_origin(allowed_origins.to_vec())
         .allow_methods(methods)
         .allow_headers(headers)
         .expose_headers(exposed_headers)
         .allow_credentials(true)
     ```
   - **Flaw:** `CACHE_CONTROL` was placed in `exposed_headers` (which governs `Access-Control-Expose-Headers` on outgoing responses so JavaScript can read response cache headers), but was **omitted** from `headers` (which governs `Access-Control-Allow-Headers` on preflight OPTIONS responses).
4. **Browser Rejection:**
   - The preflight returns:
     `access-control-allow-headers: authorization,content-type,accept,range,if-range,if-none-match,if-modified-since,x-expected-sha256,x-expected-security-revision`
   - Browser determines `cache-control` was requested in `Access-Control-Request-Headers` but absent in `Access-Control-Allow-Headers`.
   - Browser cancels request immediately before dispatching `GET`, reporting:
     `net::ERR_FAILED: Request header field cache-control is not allowed by Access-Control-Allow-Headers in preflight response.`

### 3.3 Live Verification via Curl
Live execution against local runtime reproducing identical production response:
```bash
$ curl -s -i -X OPTIONS http://127.0.0.1:4801/api/system/resources/v1/events \
  -H "Origin: http://100.91.26.60:4802" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization, cache-control, accept"
```
**Output Received:**
```http
HTTP/1.1 200 OK
access-control-allow-credentials: true
vary: origin, access-control-request-method, access-control-request-headers
access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD
access-control-allow-headers: authorization,content-type,accept,range,if-range,if-none-match,if-modified-since,x-expected-sha256,x-expected-security-revision
access-control-allow-origin: http://100.91.26.60:4802
allow: GET,HEAD
content-length: 0
```
`cache-control` is confirmed missing from `access-control-allow-headers`.

### 3.4 DevTools "Disable Cache" & Additional Problematic Headers
When a developer or operator opens browser DevTools and checks **"Disable cache"**:
1. Chromium, Chrome, Edge, and Firefox automatically inject extra request headers into every outgoing fetch/XHR request:
   - `Cache-Control: no-cache` (or `max-age=0`)
   - `Pragma: no-cache`
2. `Pragma` is **also non-safelisted** under CORS specifications.
3. The browser will add `pragma` to `Access-Control-Request-Headers: authorization, cache-control, pragma`.
4. Neither `CACHE_CONTROL` nor `PRAGMA` currently exists in `allow_headers` in `server/src/api/router.rs`.
5. Consequently, any cross-origin request made while DevTools has "Disable cache" active risks preflight CORS failure if headers are requested.

---

## 4. Actionable Recommendations

### 4.1 Remediation for Issue 2 (CORS Preflight)
1. **Update Backend CORS Configuration (`server/src/api/router.rs`):**
   - Import `PRAGMA` alongside `CACHE_CONTROL` from `axum::http::header`.
   - Add both `CACHE_CONTROL` and `PRAGMA` to `let headers = [...]` in `build_cors`:
     ```rust
     let headers = [
         AUTHORIZATION,
         CONTENT_TYPE,
         ACCEPT,
         RANGE,
         IF_RANGE,
         IF_NONE_MATCH,
         IF_MODIFIED_SINCE,
         CACHE_CONTROL,
         PRAGMA,
         X_EXPECTED_SHA256,
         X_EXPECTED_SECURITY_REVISION,
     ];
     ```
2. **Frontend Safeguard (`packages/ui/src/api/ws-transport.ts`):**
   - Setting `cache: "no-store"` on `fetch(...)` already instructs browser cache subsystem not to cache the SSE stream.
   - Sending manual `"Cache-Control": "no-store"` in `headers` object is redundant with `cache: "no-store"` option, but keeping both is standard once backend allows it.
3. **Automated Regression Test:**
   - Add unit test to `server/src/api/router.rs:tests` asserting preflight `OPTIONS` with `Access-Control-Request-Headers: authorization, cache-control, pragma` passes and yields matching `access-control-allow-headers`.

### 4.2 Guidance for Issue 1 (Agent Status Snapshot)
1. **Operator Documentation Update:**
   - Update `docs/linux-release-manager.md` or troubleshooting runbooks clarifying difference between host daemon management CLI (`dam-hopper status`) and application PTY agent status tracking (`/api/agent-status/v1/snapshot`).
2. **No Code Changes Required:**
   - Retain current 15s `AgentStatusBridge` periodic reconciliation to maintain safety lease alignment for terminal AI agents.

---

## 5. Supporting Evidence

### 5.1 Code Anchors
- Root Component: `packages/ui/src/embed/dam-hopper-app.tsx:352`
- Agent Bridge: `packages/ui/src/components/organisms/AgentStatusBridge.tsx:1-7`
- Periodic Reconciler: `packages/ui/src/hooks/use-agent-status-connections.ts:33, 40-191`
- Snapshot Mapping: `packages/ui/src/api/ws-transport.ts:593-594`
- SSE Call Site: `packages/ui/src/api/ws-transport.ts:1949-1965`
- Backend CORS Builder: `server/src/api/router.rs:758-804`
- Commit Introducing SSE Client: `51d23734` (`feat(system): implement profile-owned host-resource stream client`)

### 5.2 Server Architecture Spec
- `docs/architecture/agent-status.md:84-88`: specifies 5-second extension heartbeat and 15-second lease expiry.
- `server/src/main.rs:709`: `agent_status_runtime.start_lease_task(std::time::Duration::from_secs(1));`.

---

## 6. Unresolved Questions
1. Does production deployment run behind a reverse proxy (e.g., Nginx, Caddy, Cloudflare) that strips or overrides `Access-Control-Allow-Headers`, or does traffic hit `dam-hopper-api` (port 4801) directly?
2. Are there upcoming UI endpoints planned that will send custom non-safelisted request headers beyond `Cache-Control` and `Pragma`?

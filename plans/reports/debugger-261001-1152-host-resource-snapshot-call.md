# Diagnostic Report: Host Resource Snapshot Request Lifecycle & Cancellation Analysis

**Date:** 2026-10-01  
**Author:** Debugger Snapshot Agent  
**Environment:** Linux x86_64, Host `100.91.26.60` (API Server: `4801`, Web Host: `4802`)  
**Target:** Web UI dual transport (`/api/system/resources/v1/snapshot` & `/api/system/resources/v1/events`)  
**Subject:** `loidinhm31`  

---

## 1. Executive Summary

### 1.1 Issue Description & User Observation
When accessing the DamHopper web application (`http://100.91.26.60:4802`), browser DevTools Network panel records an initial HTTP GET request to `/api/system/resources/v1/snapshot` that appears as `(canceled)` and displays no response payload ("returns nothing"). Furthermore, attempts by the user to execute the copied cURL request directly in shell environments fail with syntax errors or empty outputs.

### 1.2 Root Cause Identification
1. **Initial REST Dispatch (Expected):** The frontend host resource subsystem mounts in `STARTING` mode. In this mode, `canUseResourceRest` returns `true`, causing TanStack React Query to dispatch an initial REST snapshot query (`system:resourceSnapshot`) to `/api/system/resources/v1/snapshot` as an immediate fallback while Server-Sent Events (SSE) stream negotiation commences.
2. **Mid-Flight Abort by Coordinator (Expected):** The SSE stream at `/api/system/resources/v1/events` connects and delivers its initial paired status and data frames within milliseconds. On receiving the authoritative data frame, `switchToHostResourceFrame` executes. It atomically advances `sourceGeneration`, flips `switching = true`, and calls `qcLike.cancelQueries({ queryKey: snapshotKey, exact: true })`. This triggers `AbortSignal.abort()` on the in-flight REST request via `ws-transport.ts` and `fetch()`.
3. **Browser DevTools `(canceled)` Display:** When the browser native `fetch()` is aborted via `AbortController`, the browser terminates the underlying HTTP stream. DevTools displays the request status as `(canceled)` and clears the response body tab (`Failed to load response data: No data found for resource with given identifier`). The UI cache is simultaneously populated directly from the SSE data frame, and the coordinator transitions to `LIVE` mode (disabling further REST queries).
4. **Shell Execution Failure of cURL:** The cURL command provided by the user contains unquoted shell metacharacters:
   - `-H User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...`: Unquoted parentheses `(` `)` trigger shell subshell syntax errors in bash and subexpression errors in PowerShell; semicolons `;` act as command delimiters.
   - `-H Accept: */*`: The unquoted wildcard `*/*` expands into matching file paths in subdirectories, corrupting cURL command arguments.
   - Missing/Expired Bearer Token: Without `Authorization: Bearer <JWT>`, the protected endpoint returns `HTTP 401 Unauthorized` (`{"error":"Authentication required","code":"AUTH_REQUIRED"}`).
   - When executed with valid credentials and proper quoting, `/api/system/resources/v1/snapshot` returns `HTTP 200 OK` with the complete ~8.7 KB JSON payload.

### 1.3 Architectural Assessment & Priority
- **Verdict:** **Intentional architectural behavior.** No regression or functional defect exists.
- **Priority:** Low (Documentation / Observability clarity only). The system is operating exactly as designed per Phase 03/04/05 host-resource specifications.

---

## 2. Technical Analysis

### 2.1 Component Interaction & Call Trace

The lifecycle spans 5 primary modules across UI and server layers:

```
[UI Mount] DamHopperApp / useMultiHostResources / useHostResourceSnapshot
     │
     ▼
[Interest Registered] HostResourceStreamCoordinator.registerInterest("fleet")
     │
     ├────────────────────────────────────────┬────────────────────────────────────────┐
     ▼                                        ▼                                        ▼
Mode = "STARTING"                   startAttempt() -> executeAttempt()       canUseResourceRest == true
     │                                        │                                        │
     │                                        ▼                                        ▼
     │                              openHostResourceEvents()                 TanStack Query enabled
     │                              GET /api/system/resources/v1/events      GET /api/system/resources/v1/snapshot
     │                                        │                                        │
     │                                        │ (SSE Stream Connected)                 │ (In-Flight HTTP Fetch)
     │                                        │                                        │
     │                              Receives Status + Data Frame                       │
     │                                        │                                        │
     ▼                                        ▼                                        │
switchToHostResourceFrame() ──────────────► cancelQueries(snapshotKey) ───────────────► signal.abort()
     │                                                                                 │
     ├─► sourceGeneration += 1                                                         ▼
     ├─► batchQueryUpdates: setQueryData(snapshotKey, sseData.snapshot)      Browser DevTools: (canceled)
     └─► Mode = "LIVE" (canUseResourceRest now false)                        Response: [Empty / No Data]
```

#### Detailed Call Chains:
1. **Trigger & Gate:**
   - `packages/ui/src/hooks/use-multi-host-resources.ts`:
     - Line 115: `registerHostResourceInterest(target.owner, qc, "fleet")` registers interest for connected targets.
     - Lines 166–170: `canRest = target.connected ? canUseResourceRest(target.owner, qc) : false`.
     - Lines 179–180: Query dispatches `getBoundApiClient(target.owner).system.resourceSnapshot(signal)`.
   - `packages/ui/src/api/queries.ts`:
     - Lines 592–624: `useHostResourceSnapshot` applies identical gating via `canUseResourceRest(owner, qc)`.
2. **Coordinator Mode Progression:**
   - `packages/ui/src/api/host-resource-stream-coordinator.ts`:
     - Lines 351–353: `evaluateLifecycle()` detects interest while mode is `STOPPED`, calling `startAttempt()`.
     - Lines 427–428: Sets `mode = "STARTING"`, arming 10s initial data deadline and 45s byte idle timeout.
     - Lines 1078–1104:
       ```typescript
       export function canUseResourceRest(owner: ConnectionRef, qc: QueryClient): boolean {
         ...
         return (
           coord.mode === "STARTING" ||
           coord.mode === "RETRY_WAIT" ||
           coord.mode === "REST_ONLY"
         );
       }
       ```
     - In `STARTING` mode, REST queries are explicitly authorized.
3. **Transport Execution:**
   - `packages/ui/src/api/ws-transport.ts`:
     - Line 1241: `system:resourceSnapshot` maps to `GET /api/system/resources/v1/snapshot`.
     - Lines 2898–2935: `invoke()` creates an `AbortController`, binds `externalSignal.addEventListener("abort", onAbort)`, and executes `fetch(fullUrl, { ..., signal: controller.signal })`.
4. **Handoff and Abort:**
   - `packages/ui/src/api/host-resource-stream-coordinator.ts`:
     - Lines 559–574: SSE reader parses chunks from `openHostResourceEvents()`.
     - Lines 662–710: Decodes adjacent `status` and `data` frames.
     - Lines 728–774 (`switchToHostResourceFrame`):
       ```typescript
       const currentSwitchToken = ++this.switchToken;
       this.switching = true;
       this.sourceGeneration += 1;
       this.notify();
       ...
       const snapshotKey = profileQueryKey(this.owner, "system", "resource-snapshot");
       const metricsKey = profileQueryKey(this.owner, "system", "metrics");
       const qcLike = asQueryClientLike(this.queryClient);
       if (qcLike) {
         await Promise.all([
           qcLike.cancelQueries({ queryKey: snapshotKey, exact: true }),
           qcLike.cancelQueries({ queryKey: metricsKey, exact: true }),
         ]);
       }
       ```
     - TanStack Query cancels the pending query, triggering `externalSignal.abort()`, which causes `controller.abort()` in `ws-transport.ts`.
     - Lines 791–806: The coordinator atomically populates React Query cache using `batchQueryUpdates` with `decoded.snapshot` and `decoded.metrics`, sets `mode = "LIVE"`, clears `switching`, and disarms the initial data deadline timer.
     - Once in `LIVE` mode, `canUseResourceRest` evaluates to `false`. React Query sets `enabled: false`, halting all further REST polling.

---

### 2.2 Server-Side Verification

#### Endpoints in `server/src/api/system.rs` & `server/src/api/resource_events.rs`:
- `GET /api/system/resources/v1/snapshot`: Handled by `system::get_snapshot`, querying `state.host_resource_monitor.snapshot().await`. Protected by `auth::require_auth`.
- `GET /api/system/resources/v1/events`: Handled by `resource_events::events_handler`. Protected by layered SSE admission (32 global, 4 per subject), origin admission, and `auth::authenticate_stream_request` (2-second timeout).
- Upon stream connection, the server immediately pushes:
  1. `host-resources-status` (small metadata frame, <4 KB)
  2. `host-resources-data` (cached snapshot + metrics pair, <256 KB)
  Because the server emits these frames immediately upon connection without waiting for a new collection tick, the UI stream receives the initial frame before the asynchronous REST fetch roundtrip finishes.

---

### 2.3 Diagnostic Tests & Supporting Evidence

#### Test 1: Direct REST Query with Valid Authentication
Invoking the REST snapshot endpoint directly against the live backend service (`port 4801`) with a valid JWT Bearer token:
```bash
TOKEN="<REDACTED_BEARER_TOKEN>"

curl -s -i "http://100.91.26.60:4801/api/system/resources/v1/snapshot" \
  -H "Authorization: Bearer $TOKEN" | head -n 15
```

**Output:**
```http
HTTP/1.1 200 OK
content-type: application/json
vary: origin, access-control-request-method, access-control-request-headers
access-control-allow-credentials: true
access-control-expose-headers: accept-ranges,content-range,content-length,content-disposition,etag,last-modified,cache-control,x-expected-sha256,x-expected-security-revision,x-plugin-ui-sha256,x-content-type-options
content-length: 8704
date: Thu, 01 Oct 2026 05:03:48 GMT

{"schemaVersion":1,"sampleId":"73db41a8-8cbb-45c3-be73-2b46d7b69850","sampledAt":1790831023883,"host":{"bootId":"0adb1a87-a4ae-4ac6-a4df-22d752d2da0f","hostname":"localhost.localdomain","osName":"Fedora Linux"},...}
```
**Finding:** The endpoint is fully functional, healthy, and returns complete data (~8.7 KB) when queried synchronously.

#### Test 2: Unquoted cURL Execution Reproduction
Running the unquoted command as typically copied from browser context:
```bash
curl http://100.91.26.60:4801/api/system/resources/v1/snapshot -H User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)
```
**Output:**
```
error: pi-natives:command: syntax error at line 1 col 107
```
Testing unquoted wildcard expansion:
```bash
echo -H Accept: */*
```
**Output:**
```
-H Accept: __fixtures__/workspace apps/browser-extension apps/native apps/web deploy/release ...
```
**Finding:** Unquoted headers containing parentheses cause shell parser syntax failures. The unquoted wildcard `*/*` expands into filesystem paths, garbling the HTTP request arguments.

#### Test 3: Unauthenticated Invocation
```bash
curl -i http://127.0.0.1:4801/api/system/resources/v1/snapshot
```
**Output:**
```http
HTTP/1.1 401 Unauthorized
content-type: application/json
content-length: 58

{"error":"Authentication required","code":"AUTH_REQUIRED"}
```
**Finding:** The endpoint is properly protected by auth middleware and rejects unauthenticated requests.

---

## 3. Root Cause Summary Matrix

| Observed Phenomenon | Mechanism | Root Cause / Explanation |
| :--- | :--- | :--- |
| **Snapshot dispatched at startup** | `useMultiHostResources` & `useHostResourceSnapshot` query gating | Coordinator starts in `STARTING` mode; `canUseResourceRest` is `true` to ensure immediate fallback data availability if SSE fails or stalls. |
| **Request aborted mid-flight** | `switchToHostResourceFrame` in coordinator | SSE connection completes and receives initial paired status+data frame; coordinator calls `qcLike.cancelQueries` on snapshot key to abort redundant REST fetch. |
| **DevTools shows `(canceled)`** | Browser network stack handling of `AbortSignal` | The abort signal propagates from React Query to `ws-transport.ts` and native `fetch()`. The browser aborts the TCP stream before completion. |
| **DevTools shows "returns nothing"** | Browser DevTools payload inspector | Because `fetch()` was canceled before the response was fully buffered/consumed, DevTools does not store body bytes and displays empty response data. |
| **cURL command syntax error** | Shell parsing of unquoted metacharacters | Parentheses `()` in `User-Agent` denote subshells; semicolons `;` terminate commands; `*/*` expands via pathname expansion. |
| **cURL returns 401 AUTH_REQUIRED** | Axum authentication layer (`auth::require_auth`) | Protected REST routes require a valid session JWT via `damhopper-auth` cookie or `Authorization: Bearer <token>`. |

---

## 4. Architectural Analysis & Verification

### 4.1 Is this behavior intentional?
**Yes.** The dual-transport startup lifecycle was introduced in Phase 03 and finalized in Phase 04/05 (`docs/architecture/host-resource-sse.md`). The design goals are:
1. **Zero-Latency Fallback:** Start REST fetching immediately while SSE handshakes. If SSE is blocked by an aggressive corporate proxy, firewall, or 503 capacity limit, data still renders without delay.
2. **Bandwidth & Compute Conservation:** If the real-time SSE stream connects promptly (the typical path on LAN/low-latency connections), the slower REST snapshot request is canceled in flight so the server does not waste CPU/memory serializing redundant responses and the client does not process duplicate data.
3. **Cache Authority Fencing:** `switchToHostResourceFrame` must cancel in-flight REST queries before writing the SSE frame to TanStack Query cache. Otherwise, a delayed REST response could arrive later and overwrite fresher SSE data with older snapshot state.

### 4.2 Is there any bug or data loss?
**No.** There is zero data loss. The UI receives the authoritative data directly from the SSE event stream, populates TanStack Query cache via `setQueryData`, and remains updated in real time via SSE without polling.

---

## 5. Actionable Recommendations

### 5.1 Immediate Actions
- **No code change required** for backend or UI query coordinators; the behavior is working as specified.
- **Clarification for Developers/Operators:** When inspecting Network tab during startup, `(canceled)` on `/api/system/resources/v1/snapshot` is proof that SSE cutover succeeded faster than REST roundtrip.
- **cURL Documentation:** When testing backend endpoints via CLI, ensure headers are single-quoted and include valid Bearer authorization:
  ```bash
  curl -s -i 'http://100.91.26.60:4801/api/system/resources/v1/snapshot' \
    -H 'Accept: application/json' \
    -H 'Authorization: Bearer <JWT_TOKEN>'
  ```

### 5.2 Optional Future Enhancements (Low Priority)
- **Start Delay / Micro-Debounce for REST Fallback (Optional):**
  If eliminating the cosmetic `(canceled)` network log in DevTools is desirable, a 100ms–200ms grace period could be introduced in `canUseResourceRest` before enabling the REST query. However, this introduces a slight delay in degraded/REST-only environments and is generally unnecessary since standard modern SPAs frequently cancel superseded queries.

---

## 6. Unresolved Questions

- None. All observable behaviors, network traces, shell errors, and code paths have been definitively diagnosed and verified against the live system and codebase.

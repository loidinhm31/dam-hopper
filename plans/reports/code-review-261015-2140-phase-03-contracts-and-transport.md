# Code Review Report: Phase 03 Contracts Ownership and Live Transport

- Date: 2026-10-15
- Plan: `plans/261015-1647-android-native-app/phase-03-contracts-ownership-and-live-transport.md`
- Score: **7.5 / 10**
- Status: **Remediation Required Before Feature Integration**

---

## 1. Executive Summary

Phase 03 implements typed protocol2 DTOs, ownership-bound transport lifecycles, and Ktor-based REST, SSE, and WebSocket engines across `native-app/shared` and `native-app/androidApp`.
Strong structural alignment with Rust server contracts (`server/src/api/ws_protocol.rs` and `server/src/api/ws.rs`), exact SSE pairing rules (`HostResourceSseClient`), and atomic JSON-header/binary writer semantics (`SerializedWsWriter`).
However, high-severity concurrency and lifecycle defects were identified:
1. `ApiClient.wrapNetworkError` wraps `CancellationException` in `ApiRequestError`, breaking Kotlin coroutine cancellation and ViewModel lifecycle teardown.
2. `WsRequestCorrelator` lacks timeout unregister logic, permanently leaking slots in the 256 in-flight request map upon timeouts and bricking the socket.
3. `ConnectionRegistry` resets profile generations to `1L` upon removal and re-addition, enabling ABA ownership bypass for stale callbacks.
4. `PlatformHttpEngine.android.kt` instantiates bare `OkHttp.create()`, bypassing hardened redirect, timeout, and ping configurations from `AndroidHttpClientFactory`.

---

## 2. Issues Breakdown

### Critical / High Priority Issues (3)

1. **`ApiClient.kt:187-197` — Coroutine CancellationException Swallowed & Wrapped**
   - **Problem:** `wrapNetworkError` catches `Throwable` and wraps `CancellationException` inside `ApiRequestError(status=0)`.
   - **Impact:** Breaks structured concurrency. When UI/ViewModel scopes cancel HTTP jobs during screen teardown, jobs report unexpected runtime errors rather than cancelling cooperatively.
   - **Fix:**
     ```kotlin
     private fun wrapNetworkError(e: Throwable, method: String, url: String): Throwable {
         if (e is kotlinx.coroutines.CancellationException) throw e
         val safeUrl = redactUrl(url)
         return when (e) {
             is ConnectionOwnerError -> e
             else -> ApiRequestError("Network error during $method $safeUrl: ${e.message}", 0, cause = e)
         }
     }
     ```

2. **`WsRequestCorrelator.kt:48-56` & `WsConnection.kt:128-149` — In-Flight Request Map Leak on Timeout**
   - **Problem:** `WsRequestCorrelator` has no `unregister(reqId)` method. When `WsConnection.request` times out via `withTimeout(timeoutMillis)`, the caller catches `TimeoutCancellationException`, completes `deferred` exceptionally, but never removes `reqId` from `pendingRequests`.
   - **Impact:** After 256 cumulative request timeouts, `pendingRequests.size >= maxInFlight`, permanently throwing `ConnectionOwnerError("In-flight WebSocket request capacity (256) exceeded")` on all subsequent requests until socket reconnection.
   - **Fix:** Add `suspend fun unregister(reqId: ULong)` to `WsRequestCorrelator` and call it inside a `finally` block or on exception in `WsConnection.request`.

3. **`ConnectionRegistry.kt:32-38,86-107` — ABA Generation Collision on Profile Re-creation**
   - **Problem:** `removeProfile(profileId)` deletes the profile from `activeGenerations`. Subsequent `getOrCreateConnection(profileId)` starts generation counter at `1L` again.
   - **Impact:** ABA ownership vulnerability. If delayed coroutines, HTTP responses, or websocket callbacks from generation `1L` of an earlier deleted profile instance fire, they pass `assertCurrentOwner` on the new profile instance.
   - **Fix:** Maintain a monotonic `generationWatermarks = mutableMapOf<ProfileId, Long>()` across profile removals to guarantee generation numbers never repeat for a given profile ID during application runtime.

---

### Warnings / Medium Priority Issues (4)

1. **`ApiErrors.kt:41` — URL Password Redaction Fails for WebSocket Protocols**
   - **Problem:** `redactUrl` uses `Regex("(https?://[^:/@]+:)[^@]+(@)", RegexOption.IGNORE_CASE)`. It matches `http` and `https`, but fails on `ws://` and `wss://`.
   - **Impact:** Credentials embedded in WebSocket connection strings (e.g., `wss://user:secret@host/ws`) leak into logs and error details.
   - **Fix:** Change pattern to `Regex("((?:https?|wss?)://[^:/@]+:)[^@]+(@)", RegexOption.IGNORE_CASE)`.

2. **`WsConnection.kt:184-187` — Intentional Disconnect Overwritten by Error State**
   - **Problem:** When `disconnect()` cancels `readerJob`, `readLoop` catches `CancellationException` and invokes `handleSocketFailure(t)`, setting `_state.value = WsState.Error(CancellationException)`.
   - **Impact:** Intentional disconnect transitions state machine into `Error` rather than clean `Disconnected`.
   - **Fix:** In `readLoop`, check `if (t is CancellationException) return` before delegating to `handleSocketFailure`.

3. **`PlatformHttpEngine.android.kt:6` vs `AndroidHttpClientFactory.kt:22-32` — Hardened Network Security Bypass**
   - **Problem:** `createDefaultHttpEngine()` on Android calls bare `OkHttp.create()`. The hardened settings in `AndroidHttpClientFactory` (disabling cross-origin redirects, 15s ping interval, strict timeouts) are bypassed unless caller explicitly injects `AndroidHttpClientFactory.createEngine()`. By default, OkHttp follows cross-origin HTTP redirects, risking bearer token leakage.
   - **Fix:** Direct `PlatformHttpEngine.android.kt` to use `AndroidHttpClientFactory.createEngine()`.

4. **`ApiClientTest.kt:115-118` — Stale Completion Rejection Untested**
   - **Problem:** `testStaleCompletionRejection` calls `registry.retireConnection(ref)` *before* issuing `client.get("/api/slow")`. This exercises stale *start* check (`ApiClient.kt:54`), but leaves stale *completion* check (`ApiClient.kt:146`) unverified.
   - **Fix:** Gate server response via latch or channel, retire connection while HTTP exchange is blocked on server response, then release server body and assert `ConnectionOwnerError.STALE`.

---

### Suggestions / Improvements (3)

1. **`ApiClient.kt:38` & `WsConnection.kt:43` — Lifecycle Cleanup of Default HttpClients**
   - Transports instantiate their own `HttpClient` instances that are never closed upon retirement, leaking engine thread pools. Implement `AutoCloseable` or standardize on injecting an application-scoped shared client.
2. **`ConnectionRef.kt:31-46` — Deterministic Key Delimiter Escaping**
   - String interpolation `"""["${ref.profileId}",${ref.generation}]"""` fails in `parseKey` if `profileId` contains commas or quotes. Use structured JSON serialization or delimiter escaping.
3. **`WsConnection.kt:61` — SharedFlow Backpressure Policy**
   - `_incomingMessages = MutableSharedFlow(extraBufferCapacity = 64)` defaults to `BufferOverflow.SUSPEND`. Slow subscribers could suspend the reader loop and stall socket ping/pong. Document subscriber isolation or configure explicit backpressure buffer strategy.

---

## 3. Reviewed Files

| File | LOC | Role / Responsibility |
|---|---|---|
| `native-app/shared/.../core/model/ConnectionRef.kt` | 65 | Owner ref, generation tuple key, socket instance ref |
| `native-app/shared/.../core/model/ProjectTargetRef.kt` | 104 | Target path normalization, wire DTO projection, owner checks |
| `native-app/shared/.../core/model/ConnectionOwnerError.kt` | 26 | Error reasons (STALE, UNAVAILABLE, OWNER_MISMATCH) |
| `native-app/shared/.../core/ownership/ConnectionRegistry.kt` | 161 | Generation fences, state flow, retirement listeners |
| `native-app/shared/.../core/transport/WireCommon.kt` | 40 | ProtocolJson config, TreeNode, FsEventDto |
| `native-app/shared/.../core/transport/ClientMsg.kt` | 266 | Client outbound message DTOs with discriminator |
| `native-app/shared/.../core/transport/ServerMsg.kt` | 449 | Inbound polymorphic deserializer, UiConnection receipt |
| `native-app/shared/.../core/transport/HostResourceSseTypes.kt` | 47 | SSE status, data, and paired frame models |
| `native-app/shared/.../core/transport/HostResourceSseClient.kt` | 180 | Bounded SSE stream parser, revision pairing, owner fence |
| `native-app/shared/.../core/transport/ApiErrors.kt` | 43 | ApiRequestError, Health/Auth responses, URL redactor |
| `native-app/shared/.../core/transport/ApiClient.kt` | 205 | Type-safe REST client with double owner assertion |
| `native-app/shared/.../core/transport/WsHandshakeUrl.kt` | 25 | Origin-less WS URL builder with query token admission |
| `native-app/shared/.../core/transport/WsTypes.kt` | 46 | Close codes, WsState machine, UiConnectionReceipt |
| `native-app/shared/.../core/transport/WsRequestCorrelator.kt` | 79 | Bounded request correlator, req_id extractor |
| `native-app/shared/.../core/transport/SerializedWsWriter.kt` | 75 | Atomic text/binary frame serialization, protocol abort |
| `native-app/shared/.../core/transport/WsConnection.kt` | 245 | Live WS client, receipt lifecycle, message router |
| `native-app/shared/.../core/transport/PlatformHttpEngine.kt` | 10 | Expect declaration for engine factory |
| `native-app/shared/.../core/transport/PlatformHttpEngine.android.kt` | 6 | Android OkHttp engine actualization |
| `native-app/shared/.../core/transport/PlatformHttpEngine.jvm.kt` | 6 | JVM Java 11 HttpClient actualization |
| `native-app/androidApp/.../platform/network/AndroidHttpClientFactory.kt` | 50 | Hardened OkHttp settings, redirect disable, ping interval |
| `tests/test-phase-03-transport.sh` | 130 | Shell invariant and contract test gate |
| `native-app/shared/.../core/ownership/ConnectionRegistryTest.kt` | 96 | Unit tests for generation isolation, stale assertion |
| `native-app/shared/.../core/transport/WireSerializationTest.kt` | 142 | Unit tests for wire JSON, renames, capability redaction |
| `native-app/shared/.../core/transport/ApiClientTest.kt` | 122 | Unit tests for REST, redaction, retry-after, stale start |
| `native-app/shared/.../core/transport/HostResourceSseTest.kt` | 158 | Unit tests for SSE pairing, comment invalidation, limits |
| `native-app/shared/.../core/transport/WsConnectionTest.kt` | 153 | Unit tests for WS URL, correlator, atomic writer abort |
| **Total** | **2,903** | **26 files reviewed** |

---

## 4. Validation Commands & Verification Results

| Command | Result | Observations |
|---|---|---|
| `./tests/test-phase-03-transport.sh` | **PASS (48/48)** | Static contract and code invariant gate verified. |
| `./tests/test-phase-02-foundation.sh` | **PASS (47/47)** | Foundation regression gate verified. |
| `./native-app/gradlew -p native-app :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:testReleaseUnitTest :androidApp:assembleDebug` | **PASS (100%)** | 81 tasks executed clean; 36 unit tests passed; debug APK assembled. |

---

## 5. Unresolved Questions

1. Should `ConnectionRegistry` generation watermarks persist to secure device storage (Jetpack Security EncryptedSharedPreferences) to prevent generation reuse across cold app restarts?
2. Should `PlatformHttpEngine.android.kt` directly reference `AndroidHttpClientFactory` via an internal shared engine provider or delegate to a dependency injection container introduced in Phase 04?

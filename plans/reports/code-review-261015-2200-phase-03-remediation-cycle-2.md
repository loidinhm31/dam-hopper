# Code Review Report: Phase 03 Contracts Ownership and Live Transport (Cycle 2 Remediation Review)

- Date: 2026-10-15
- Plan: `plans/261015-1647-android-native-app/phase-03-contracts-ownership-and-live-transport.md`
- Score: **8.8 / 10** (Upgraded from 7.5 / 10 in Cycle 1)
- Status: **Remediations Verified — Additional Socket Fencing Recommended**

---

## 1. Scope

- **Files Reviewed (9 focused remediation files):**
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiClient.kt` (206 LOC)
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/ApiErrors.kt` (43 LOC)
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsRequestCorrelator.kt` (83 LOC)
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/transport/WsConnection.kt` (249 LOC)
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistry.kt` (168 LOC)
  - `native-app/shared/src/androidMain/kotlin/dev/damhopper/nativeapp/core/transport/PlatformHttpEngine.android.kt` (12 LOC)
  - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/ApiClientTest.kt` (142 LOC)
  - `native-app/shared/src/commonTest/kotlin/dev/damhopper/nativeapp/core/ownership/ConnectionRegistryTest.kt` (123 LOC)
  - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/core/transport/WsConnectionTest.kt` (180 LOC)
- **Lines of Code Analyzed:** 1,206 LOC in target files (2,903 LOC cumulative Phase 03 surface).
- **Review Focus:** Verification of Cycle 1 critical remediations, warning resolutions, coroutine cancellation semantics, ABA generation protection, and regression test rigor.
- **Updated Plans:** `plans/261015-1647-android-native-app/phase-03-contracts-ownership-and-live-transport.md`.

---

## 2. Overall Assessment

Cycle 2 review confirms that all 3 Critical issues and 4 Warnings identified during Cycle 1 have been directly addressed with high engineering fidelity:
1. `ApiClient.wrapNetworkError` immediately propagates `CancellationException`, preserving Kotlin structured concurrency.
2. `WsRequestCorrelator` introduces `unregister(reqId)` called in `WsConnection.request` catch blocks, preventing in-flight slot exhaustion on timeouts.
3. `ConnectionRegistry` implements a persistent `generationWatermarks` map preventing ABA generation reuse across profile deletion and re-creation.
4. `redactUrl` regex now sanitizes credentials in `wss://` / `ws://` schemes.
5. `WsConnection.readLoop` cleanly terminates on `CancellationException` without setting `WsState.Error`.
6. `PlatformHttpEngine.android.kt` explicitly disables redirects (`followRedirects(false)`, `followSslRedirects(false)`).
7. `ApiClientTest` verifies in-flight stale completion rejection with concurrent latches.

Targeted improvements remain around WebSocket session binding: ensuring `connect()` asserts ownership post-handshake, carrying `SocketInstanceRef` into failure callbacks to avoid tearing down newer sockets, and registering a retirement listener on `WsConnection`.

---

## 3. Critical Issues Status (Cycle 1 Verification)

| Issue | Status | Verification Evidence |
|---|---|---|
| **1. CancellationException Swallowed in ApiClient** | **RESOLVED** | `ApiClient.kt:188`: `if (e is kotlinx.coroutines.CancellationException) throw e` placed before error wrapping. Structured concurrency and coroutine job cancellation preserved. |
| **2. WsRequestCorrelator Map Leak on Timeout** | **RESOLVED** | `WsRequestCorrelator.kt:58-60`: `suspend fun unregister(reqId: ULong)` removes pending deferreds. `WsConnection.kt:145-148`: `catch (t: Throwable) { correlator.unregister(reqId); ... }`. Capacity leak eliminated. |
| **3. ABA Generation Collision on Profile Re-creation** | **RESOLVED** | `ConnectionRegistry.kt:23,35-40`: `generationWatermarks` persists across `removeProfile()`. Monotonic generation ordering verified by `testAbaGenerationPreventionOnRecreation`. |

---

## 4. Warnings Status (Cycle 1 Verification)

| Warning | Status | Verification Evidence |
|---|---|---|
| **1. URL Redaction on WebSocket Protocols** | **RESOLVED** | `ApiErrors.kt:41`: Regex updated to `((?:https?\|wss?)://[^:/@]+:)[^@]+(@)`. Verified by `ApiClientTest.testUrlRedaction` for `wss://` credentials. |
| **2. Intentional Disconnect Overwriting State** | **RESOLVED** | `WsConnection.kt:186-188`: `if (t is CancellationException) return` cleanly exits `readLoop` when `readerJob.cancel()` is called during `disconnect()`. |
| **3. Android Platform Engine Redirects** | **RESOLVED** | `PlatformHttpEngine.android.kt:8-9`: `OkHttp.create { config { followRedirects(false); followSslRedirects(false) } }`. Auth token redirect leakage prevented. |
| **4. Stale Completion Rejection Untested** | **RESOLVED** | `ApiClientTest.kt:105-141`: `testStaleCompletionRejection` coordinates server handler latch, issues in-flight GET, retires connection before server completes, and asserts `ConnectionOwnerError.STALE`. |

---

## 5. High Priority Findings (Cycle 2 New Observations)

1. **`WsConnection.connect` lacks post-handshake ownership check**
   - **Problem:** `assertCurrentOwner` is called at entry before `httpClient.webSocketSession(wsUrl)`. If connection is retired during the network handshake, the resulting socket session is still published to `_state.value = WsState.Connected(socketRef)` and `readLoop` is launched.
   - **Fix:** Call `registry?.assertCurrentOwner(connection, "WsConnection.connect post-handshake")` immediately before assigning `activeSession` and updating `_state`. If check fails, close the newly opened session immediately.
   - **Code Example:**
     ```kotlin
     val session = try {
         httpClient.webSocketSession(wsUrl)
     } catch (t: Throwable) {
         if (t is CancellationException) throw t
         _state.value = WsState.Error(t)
         correlator.cancelAll("WebSocket connect failed: ${redactUrl(t.message ?: "")}")
         return@withLock
     }

     try {
         registry?.assertCurrentOwner(connection, "WsConnection.connect post-handshake")
     } catch (err: ConnectionOwnerError) {
         session.close(CloseReason(CloseReason.Codes.NORMAL, "Connection retired during handshake"))
         _state.value = WsState.Disconnected
         throw err
     }
     ```

2. **`handleCloseReason` & `handleSocketFailure` lack SocketInstanceRef fencing**
   - **Problem:** Neither `handleCloseReason(reason)` nor `handleSocketFailure(t)` checks if the callback originates from the currently active `socketRef`. If a socket is replaced (reconnect) while an old socket reader is completing/failing, the old socket callback invokes `closeInternal()`, tearing down the *new* session.
   - **Fix:** Pass `socketRef: SocketInstanceRef` into `handleCloseReason(reason, socketRef)` and `handleSocketFailure(t, socketRef)`. Verify `socketRef == activeSocketRef` inside `lifecycleMutex.withLock` before calling `closeInternal()`.

3. **`WsConnection.connect` catches CancellationException**
   - **Problem:** In `WsConnection.kt:89-93`, `catch (t: Throwable)` catches `CancellationException` and transitions `_state.value = WsState.Error(t)`.
   - **Fix:** Rethrow `CancellationException` immediately (`if (t is CancellationException) throw t`).

---

## 6. Medium Priority Improvements

1. **Retirement Listener wiring in WsConnection**
   - `WsConnection` does not subscribe to `ConnectionRegistry.addRetirementListener`. Registering a retirement listener allows `WsConnection` to proactively close the socket and cancel active correlators immediately upon generation advance, rather than waiting for next outgoing operation.
2. **Sanitize `t.message` in error and cancellation diagnostics**
   - In `WsConnection.connect()`, `correlator.cancelAll("WebSocket connect failed: ${t.message}")` incorporates raw error message. If the underlying transport error includes the target URL with query token, sanitize via `redactUrl(t.message ?: "")`.

---

## 7. Low Priority Suggestions

1. **Suppress compiler deprecation warning in test mock**
   - `WsConnectionTest.kt:178`: `override fun terminate() {}` overrides deprecated member in Ktor 3.x. Add `@Suppress("DEPRECATION")` to eliminate compiler diagnostic.
2. **HttpClient lifecycle management**
   - Transports instantiate default `HttpClient` instances that can be made `AutoCloseable` or injected via dependency injection in Phase 04.

---

## 8. Positive Observations

- **Exact Monotonic ABA Protection:** The persistent `generationWatermarks` map in `ConnectionRegistry` is simple, thread-safe, and cleanly solves ABA generation reuse across profile logouts and re-creations.
- **Robust Stale Completion Test:** `ApiClientTest.testStaleCompletionRejection` uses deterministic latches across coroutines and threads, reliably proving both start and completion fences.
- **Correlator Unregistering:** `WsRequestCorrelator.unregister` integrates cleanly with `WsConnection.request` `catch` block without interfering with normal dispatch.

---

## 9. Recommended Actions

1. Apply post-handshake owner verification in `WsConnection.connect` before publishing active session.
2. Pass `SocketInstanceRef` to `handleCloseReason` and `handleSocketFailure` to guard against stale socket close races.
3. Rethrow `CancellationException` in `WsConnection.connect` catch block.
4. Wire `registry.addRetirementListener` in `WsConnection` for automatic socket teardown on profile retirement.

---

## 10. Metrics

| Metric | Result | Status |
|---|---|---|
| **Phase 03 Test Suite** | 48 / 48 assertions passed (100%) | PASS |
| **Phase 02 Regression Gate** | 47 / 47 assertions passed (100%) | PASS |
| **Unit Test Executions** | 38 / 38 unit tests passed | PASS |
| - `shared:jvmTest` | 30 tests (17 commonTest + 13 jvmTest) | PASS |
| - `androidApp:testDebugUnitTest` | 4 tests (ManifestSecurityTest) | PASS |
| - `androidApp:testReleaseUnitTest` | 4 tests (ManifestSecurityTest) | PASS |
| **Android APK Assembly** | `:androidApp:assembleDebug` successful | PASS |
| **Compiler Warnings** | 1 deprecation warning in test helper mock | Low impact |

---

## 11. Unresolved Questions

1. Should `WsConnection` automatically register a retirement listener with `ConnectionRegistry` upon construction, or should an orchestrator (e.g., `ProfileConnectionManager` in Phase 04) coordinate transport lifecycles?
2. Should `generationWatermarks` in `ConnectionRegistry` persist across app restarts (e.g. in EncryptedSharedPreferences) to guard against stale token replays across cold boots?

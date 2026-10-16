# Technical Documentation Report: Phase 03 Contracts Ownership and Live Transport

- **Date:** 2026-10-15
- **Author:** Documentation Specialist (`Phase03DocsManager`)
- **Phase:** Phase 03 — Contracts ownership and live transport
- **Plan Reference:** `plans/261015-1647-android-native-app/phase-03-contracts-ownership-and-live-transport.md`
- **Working Tree Branch:** `feat/android-native-app`
- **Status:** Documentation Synchronized & Verified (100% Static Assertion Pass, 0 New Validation Warnings)

---

## 1. Current State Assessment

Phase 03 implementation delivers the full typed owner-bound networking layer in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/` and `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/network/`:
- Generation-fenced connection scoping with in-memory watermark ABA protection (`ConnectionRef`, `ConnectionRegistry`).
- Polymorphic client-to-server (`ClientMsg`) and server-to-client (`ServerMsg`) wire messages with `"kind"` discriminator and `ServerMsgSerializer` fallback to `ServerMsg.Unknown`.
- HTTP REST client with redirect disabling and immediate `CancellationException` propagation (`ApiClient`, `ApiRequestError`).
- Origin-less query-token WebSocket handshake (`/ws?token=`), close code mapping (`4403`, `4401`, `1013`, `4001`), and exact-socket capability receipt tracking (`WsConnection`, `UiConnectionReceipt`).
- Atomic Mutex-serialized frame writer with `PROTOCOL_ERROR` partial abort (`SerializedWsWriter`).
- Bounded WebSocket request correlator with timeout unregistration (`WsRequestCorrelator`).
- Incremental SSE client with 256 KiB data cap and strict status-data adjacency pairing (`HostResourceSseClient`).
- Pinned Android platform OkHttp factory (`AndroidHttpClientFactory`).

Phase 03 implementation is statically verified (48/48 assertions) with unit tests passing (28/28 shared JVM, 8 Android). Live Axum daemon lifecycle qualification and physical runtime launch remain open gates. Documentation across the repository is updated to reflect these contracts without overclaiming live qualification.

---

## 2. Changes Made

### 2.1 `docs/android-native-acceptance.md`
- **Document Status & Gate Alignment:** Updated header status to record Phase 03 implemented and statically verified (Cycle 2 Review 8.8/10; 48/48 static assertions, 28/28 shared JVM tests; live backend lifecycle qualification and device runtime launch open).
- **Protocol Specifications Realization:** Added implementation annotations in Section 5.2 (WebSocket Protocol) referencing typed polymorphic serializers, atomic frame writer, and bounded correlator in `core/transport/`, clarifying that domain consumer handling belongs to owning phases (07-16). Annotated Section 5.4 (SSE Stream) with `HostResourceSseClient` bounds (256 KiB data cap, 4 KiB status cap, strict revision adjacency), noting REST polling fallback and metrics presentation belong to Phase 15.
- **Phase 03 Baseline Invariants (Section 7.6):** Added dedicated subsection documenting:
  - `ConnectionRef` tuple key format `["profileId", generation]` and parser.
  - `SocketInstanceRef` socket-attempt isolation.
  - `ProjectTargetRef` path normalization and `toServerPayload()` isolation.
  - `ConnectionRegistry` in-memory watermark table preventing ABA generation collisions within the registry process lifetime.
  - `ApiClient` structured concurrency, redirect disabling, and error parsing.
  - `redactUrl()` sanitization across `http`, `https`, `ws`, and `wss`.
  - `WsConnection` close code mapping (`4403`, `4401`, `1013`, `4001`) and exact-socket receipt revocation.
  - `SerializedWsWriter` atomic JSON-header + binary pair guarantees.
  - `WsRequestCorrelator` capacity bounding (256 max) and timeout unregistration.
  - `AndroidHttpClientFactory` OkHttp settings (15s connect, 30s read/write, 15s ping).
- **Gate Matrix (Section 8):** Added Phase 03 status entry recording implementation and static transport assertion / JVM unit test pass, noting live daemon and device launch remain open. Updated Phase 02 static assertion count to 47/47.

### 2.2 `native-app/README.md`
- **Status & Roadmap:** Updated status to reflect Phase 02 foundation and Phase 03 live transport architecture implemented and statically verified. Updated implementation roadmap marking Phase 03 implemented/statically verified and Phase 04 pending.
- **Project Structure Tree:** Expanded `src/commonMain/kotlin/dev/damhopper/nativeapp/` tree to include `core/model/`, `core/ownership/`, and `core/transport/`, test directories (`commonTest/`, `jvmTest/`), and Android network platform factory (`platform/network/AndroidHttpClientFactory.kt`).
- **Phase 03 Architecture Guide (Section 3.2):** Added detailed architectural breakdown for developers covering generation scoping, origin-less WS handshake, atomic frame serialization, request correlation, SSE streaming, and URL credential sanitization. Accurately described in-memory watermark lifetime within the registry process lifetime.
- **Verification Commands (Section 4):** Documented test invocation:
  - `bash tests/test-phase-03-transport.sh` (48/48 static assertions)
  - `bash tests/test-phase-02-foundation.sh` (47/47 static assertions)
  - Combined regression suite execution.

### 2.3 `docs/system-architecture.md`
- **Runtime Overview & Mermaid Topology:** Updated top-level monorepo runtime diagram to incorporate the native Android client path (`native-app/androidApp` -> `native-app/shared` -> `ConnectionRegistry` -> `ApiClient`/`WsConnection`/`HostResourceSseClient` -> Axum server).
- **Code Boundaries:** Added `native-app/` module boundaries (`:shared` for KMP core models, registry, and transport; `:androidApp` for Compose UI and OkHttp factory).
- **Native Android Ownership Implementation:** Added subsection under Multi-Profile Ownership Model detailing native Kotlin Multiplatform realization of `ConnectionRef`, in-memory watermark ABA guard within the process lifetime, `SocketInstanceRef`, and `assertCurrentOwner` gates.
- **Android Native Client Transport Boundary:** Added dedicated subsection detailing origin-less handshake, polymorphic wire contracts (client-to-server `ClientMsg` and server-to-client `ServerMsg`), atomic frame writer, bounded correlator, SSE client bounds, credential redaction, and Android OkHttp engine configuration.

### 2.4 `docs/codebase-summary.md`
- **Codebase Compaction (`repomix`):** Executed `repomix -o ./repomix-output.xml` (packing 3,065 files, 7.39M tokens across repository).
- **Inventory Updates:** Updated `native-app/` inventory row and architecture summary section to reflect implemented Phase 02 foundation and Phase 03 live transport modules (~38 files, ~3,750 LOC across KMP shared core and Android app).

---

## 3. Code-to-Documentation Synchronization Evidence

All documented symbols and contracts were verified directly against code declarations:
1. `ConnectionRef`: `connectionKey(ref)` -> `"""["${ref.profileId}",${ref.generation}]"""`, `parseKey(key)`. Verified in `core/model/ConnectionRef.kt`.
2. `ProjectTargetRef`: `toServerPayload()` -> `ServerProjectTarget`, `normalizeProjectTargetPath()`. Verified in `core/model/ProjectTargetRef.kt`.
3. `ConnectionRegistry`: in-memory `generationWatermarks` map, `getOrCreateConnection`, `retireConnection`, `assertCurrentOwner`. Verified in `core/ownership/ConnectionRegistry.kt`.
4. `ApiClient`: `followRedirects = false`, immediate `CancellationException` propagation, `handleResponse` status extraction. Verified in `core/transport/ApiClient.kt`.
5. `redactUrl`: regex `([?&]token=)[^&]+` and `((?:https?|wss?)://[^:/@]+:)[^@]+(@)`. Verified in `core/transport/ApiErrors.kt`.
6. `SerializedWsWriter`: `sendAtomicPair` with `CloseReason.Codes.PROTOCOL_ERROR` abort on partial failure. Verified in `core/transport/SerializedWsWriter.kt`.
7. `WsRequestCorrelator`: `maxInFlight = 256`, `unregister(reqId)`, `cancelAllLocked`. Verified in `core/transport/WsRequestCorrelator.kt`.
8. `WsCloseCodes`: `CLOSE_MFA_REQUIRED` (4403), `CLOSE_FULL_LOGIN_REQUIRED` (4401), `CLOSE_AUTH_UNAVAILABLE` (1013), `CLOSE_OVERFLOW` (4001). Verified in `core/transport/WsTypes.kt`.
9. `HostResourceSseClient`: `MAX_DATA_EVENT_BYTES = 262_144` (256 KiB), `MAX_CONTROL_EVENT_BYTES = 4_096` (4 KiB), strict revision adjacency check `lastStatus.revision == dataEvent.revision`. Verified in `core/transport/HostResourceSseClient.kt`.
10. `AndroidHttpClientFactory`: `connectTimeout(15, SECONDS)`, `readTimeout(30, SECONDS)`, `writeTimeout(30, SECONDS)`, `pingInterval(15, SECONDS)`, `followRedirects(false)`, `install(WebSockets)`. Verified in `androidApp/.../platform/network/AndroidHttpClientFactory.kt`.

---

## 4. Gaps Identified

1. **Live Backend Lifecycle Integration:** Automated unit tests mock Ktor engines and WebSocket sessions. Full integration with a live Axum Rust daemon (`cargo run`) is deferred to live runtime test harnesses.
2. **Physical Device Network Security Qualification:** Pinned `AndroidHttpClientFactory` and `network_security_config.xml` are statically and unit tested. Physical Android device loopback/TLS tests remain pending device attachment.
3. **In-Memory Watermark Scope:** `generationWatermarks` in `ConnectionRegistry` is retained across profile deletions within the active process lifetime. On cold process restart, watermarks re-initialize; this is safe because no old process callbacks survive process death, but cross-session replay protection can be assessed if credentials persist.

---

## 5. Recommendations

1. **Phase 04 Onboarding:** Phase 04 (Profiles, Auth, MFA, and Credential Vault) should directly consume `ConnectionRegistry`, `ApiClient`, and `WsConnection` without introducing ad-hoc networking or ambient client instances.
2. **Dependency Injection:** Provide connection runtimes through constructor injection or KMP DI scoped to `ConnectionRef`.
3. **CI Pipeline Validation:** Run `node .omp/evcrate/scripts/validate-docs.cjs docs/`, `bash tests/test-phase-02-foundation.sh`, and `bash tests/test-phase-03-transport.sh` as automated CI gates for all subsequent Android phases.

---

## 6. Metrics & Validation Results

- **Documentation Size Limits (`docs.maxLoc` = 800):**
  - `docs/android-native-acceptance.md`: 349 LOC (43.6% of cap)
  - `native-app/README.md`: 223 LOC (27.9% of cap)
  - `docs/system-architecture.md`: 394 LOC (49.3% of cap)
  - `docs/codebase-summary.md`: 94 LOC (11.8% of cap)
  - All documentation files remain well within size boundaries; no splitting required.
- **Doc Validation Script (`node .omp/evcrate/scripts/validate-docs.cjs docs/`):**
  - Validation output: 1 preexisting broken link in `docs/CHANGELOG.md` (to a historical progress plan); 24 preexisting unverified env keys in legacy docs.
  - 0 new broken internal links introduced by Phase 03 documentation.
  - 0 new invalid config keys introduced.
- **Static Assertion Suites:**
  - `tests/test-phase-03-transport.sh`: 48/48 passed (100%).
  - `tests/test-phase-02-foundation.sh`: 47/47 passed (100%).
  - Total automated static assertions passed: 95/95 (100%).
- **Unit Test Suite Breakdown:**
  - `pnpm native-app:test` (`:shared:jvmTest`): 28/28 passed (100%).
  - Android unit tests (`:androidApp:testDebugUnitTest`, `:androidApp:testReleaseUnitTest`): 8/8 passed (100%).
  - Total unit tests: 36/36 passed (100%).
- **Build Target:** `pnpm native-app:assembleDebug` clean build.

---

## 7. Unresolved Questions

1. When will a live local/remote Axum Rust backend test daemon be available for end-to-end WebSocket and SSE lifecycle qualification?
2. Should `ApiClient` and `WsConnection` expose an explicit connection lifecycle state flow to Compose UI for offline/reconnecting banner presentation in Phase 06?

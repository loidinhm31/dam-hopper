# Code Review: Phase 05 Native Terminal, Editor & Crypto Proof Gates (GATE-B)

**Review Date:** 2026-10-15  
**Reviewer:** Senior Software Engineer (Phase05Reviewer)  
**Target Branch:** `feat/android-native-app`  
**Overall Score:** 6.8 / 10  
**Status:** **CONDITIONAL PROTOTYPE VERIFIED (GATE-B Remains Open Pending Physical Hardware, Live Server Interop, AAR Packaging & TS Decision)**

---

## Code Review Summary

### Scope
- **Files Reviewed (13 files, ~2,542 LOC):**
  - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt` (331 LOC)
  - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt` (266 LOC)
  - `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt` (210 LOC)
  - `native-app/crypto-bridge/Cargo.toml` (22 LOC)
  - `native-app/crypto-bridge/src/lib.rs` (602 LOC)
  - `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/crypto/OpaqueClientBridge.kt` (212 LOC)
  - `docs/android-native-dependency-decisions.md` (136 LOC)
  - `native-app/androidApp/build.gradle.kts` (83 LOC)
  - `tests/test-phase-05-proof-gates.sh` (131 LOC)
  - `native-app/shared/src/jvmTest/kotlin/dev/damhopper/nativeapp/features/editor/LanguageServiceTest.kt` (117 LOC)
  - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurfaceTest.kt` (151 LOC)
  - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurfaceTest.kt` (132 LOC)
  - `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/crypto/OpaqueClientBridgeTest.kt` (80 LOC)
- **Review Focus:** Security, architectural decoupling, exact OPAQUE interoperability, JNI handle lifetime, memory bounds, license obligations, and subgate stop conditions.
- **Updated Plans:** `plans/261015-1647-android-native-app/phase-05-native-terminal-editor-and-crypto-proof-gates.md` (Updated status to prototype-verified / GATE-B conditional, subgates enumerated, downstream handoff delineated).

---

## Overall Assessment

Phase 05 establishes valuable contract prototypes, candidate records, input fencing, and host-side cryptographic validation for the Android native client. However, in accordance with the project contract and GATE-B criteria, unit test compilation alone **does not constitute complete GATE-B certification**. 

Crucially, review identified a **critical fail-open security vulnerability** in `OpaqueClientBridge.kt`, which caught `UnsatisfiedLinkError` and fell back to an insecure simulated protocol in production code. This has been remediated to strictly fail closed. Furthermore, actual AAR rendering (ConnectBot View, Sora Editor View), physical ARM64 16 KiB kernel execution, and live production server OPAQUE handshake remain unperformed qualification gates.

The evaluation must separate **what has been proven** (host Rust tests, JVM contract prototypes, and static shell assertions) from **what remains pending** (Android runtime JNI loading, AAR UI integration, 16 KiB ABI alignment, and TypeScript compiler realization).

---

## Critical Issues & Remediation

### 1. [RESOLVED IN REVIEW] Fail-Open Pseudo-Crypto Fallback in `OpaqueClientBridge.kt`
- **Vulnerability:** When `libdamhopper_crypto_bridge.so` failed to load (or was not packaged), `OpaqueClientBridge` caught `UnsatisfiedLinkError` and silently fell back to an insecure mock protocol: emitting `OPAQUE_REG_REQ:<hash>`, accepting arbitrary nonempty server responses, and deriving session keys from SHA-256 of `password + ":" + response.size`.
- **Impact:** If native shared libraries failed to load on device, the app would fail open and transmit pseudo-handshakes rather than halting closed.
- **Remediation:** Removed the insecure fallback from production code. `startRegistration`, `finishRegistration`, `startLogin`, and `finishLogin` now strictly throw `OpaqueCryptoException` when the native library is not loaded. Verified with `testFailsClosedWhenNativeLibraryUnavailable`.

### 2. [OPEN] Acceptance Criteria Conflation (Compilation vs. Native Surface Acceptance)
- **Problem:** Initial QA claimed 100% GATE-B closure based solely on host-side `cargo test` and JVM unit tests.
- **Impact:** Violates the Phase 05 contract: *"Compilation/tests alone do not satisfy native-surface acceptance."* ConnectBot and Sora Editor AARs are not yet added to Gradle dependencies, and physical 16 KiB page size execution remains unverified.
- **Remediation:** Phase 05 plan updated to `prototype-verified (GATE-B conditional)`. Real hardware validation is explicitly tracked for Phase 07 (terminal) and Phase 09 (editor).

### 3. [BLOCKER] TypeScript Language Service Hard Architectural Blocker
- **Problem:** The remote DamHopper Rust server does not host a Language Server Protocol (LSP) daemon, and browser web-workers are prohibited by user mandate.
- **Impact:** Non-browser Android realization cannot provide Monaco-equivalent TypeScript semantic analysis (diagnostics, type hover, definition navigation) without an embedded JS engine (QuickJS, Hermes, or V8 JNI).
- **Remediation:** Formally audited in `TypeScriptLanguageServiceAudit` (`STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"`). Dependent Phase 09 TypeScript language features remain hard-gated.

### 4. [UNRESOLVED] Unsupported LGPL-2.1 Compliance Claim for Sora Editor
- **Problem:** Document claim that Android AAR distribution automatically satisfies LGPL-2.1 Section 6 via ART "dynamic linkage" is legally and technically incomplete. APK disassembly via `apktool` is not a formally recognized user relinking mechanism.
- **Impact:** Potential license compliance risk upon commercial/private APK distribution.
- **Remediation:** Downgrade status to an open licensing assessment. Phase 09 must formulate an explicit relinking or shared object isolation runbook before Sora Editor is shipped in production builds.

---

## High Priority Findings & Warnings

1. **Terminal Surface Memory Buffering (Phase 07 Handoff)**:
   - `AndroidTerminalSurface` buffers data in `ByteArrayOutputStream(64 * 1024)`. The constructor parameter only configures initial capacity; the stream grows unbounded on subsequent `feedOutput` calls.
   - *Risk:* Runaway stdout (e.g., `cat /dev/urandom` or large build logs) could trigger a JVM `OutOfMemoryError`.
   - *Action for Phase 07:* Offload raw byte buffering directly to ConnectBot's native `libvterm` ring buffer, or enforce a strict sliding window (e.g., max 10,000 lines).

2. **JNI Password Lifetime in JVM Heap (Phase 11 Hardening)**:
   - `OpaqueClientBridge` passes passwords across JNI as `java.lang.String`. In Java/Kotlin, `String` is immutable and cannot be zeroized, lingering in heap until garbage collected.
   - *Action for Phase 11:* Accept `ByteArray` or `CharArray` so caller can explicitly zeroize (`Arrays.fill(bytes, 0)`) immediately after JNI invocation.

3. **Editor Undo Stack Memory Scalability (Phase 09 Handoff)**:
   - `AndroidEditorSurface` stores full document text snapshots in `undoStack: ArrayDeque<String>` on every edit.
   - *Action for Phase 09:* Replace prototype snapshot stack with Sora Editor's built-in differential `TextAction` undo manager.

4. **LanguageServiceCoordinator Concurrency (Phase 09 Concurrency Guard)**:
   - `fileWatermarks` is a plain `MutableMap<String, Long>` in KMP `commonMain`. Concurrent access across background coroutines risks `ConcurrentModificationException`.
   - *Action for Phase 09:* Enforce thread safety via mutex or atomic concurrency primitives.

---

## Medium Priority Improvements

1. **JSON Symbols Line Position Resolution**:
   - `JsonLanguageService.extractSymbolsRecursive` defaults `lineEstimate = 1` because `kotlinx.serialization.json.JsonElement` does not preserve character offsets. A position-aware lexer is needed for Phase 09 folding/outlines.
2. **Terminal Special Navigation Keys**:
   - Add PageUp (`\u001b[5~`), PageDown (`\u001b[6~`), Insert (`\u001b[2~`), Delete (`\u001b[3~`), and function keys (F1–F12) to `TerminalSessionController.encodeSpecialKey` in Phase 07.

---

## Low Priority Suggestions

1. **HKDF Golden Vector Verification**:
   - `OpaqueClientBridgeTest` updated with golden test vector asserting `deriveAesKey` on `ByteArray(32) { (it * 7).toByte() }` produces exact hex `78b435ccd1f36b95c5175310d2cf37a623854f3c98174f6d80bb5c20fe85c0b3`.

---

## Positive Observations

- **Rust Suite Parity:** Automated host tests prove client-server session key identity under `DamHopperOpaqueSuite` and 1-bit AES-GCM tamper rejection.
- **JNI Handle Safety:** Monotonic `AtomicI64` handles with capacity checks (`max_capacity = 64`) avoid raw pointer exposure and prevent double-close corruption.
- **Strict Input Fencing:** `TerminalSessionController` prevents keystroke leakage into hidden sessions or out-of-order execution during replay.
- **Packaging Notice Preservation:** `pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")` in `build.gradle.kts` avoids stripping required license notices.

---

## Verification Commands & Observed Results

1. **Rust Crypto Bridge Unit Tests**:
   - Command: `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml`
   - Result: **5 passed, 0 failed, 0 ignored (0.16s)**
2. **KMP Shared JVM Unit Tests**:
   - Command: `./gradlew :shared:jvmTest --console=plain`
   - Result: **61 passed, 0 failed, 0 skipped**
3. **Android Debug Unit Tests**:
   - Command: `./gradlew :androidApp:testDebugUnitTest --console=plain`
   - Result: **26 passed, 0 failed, 0 skipped** (includes fail-closed and golden vector tests)
4. **Android Debug APK Assembly**:
   - Command: `./gradlew assembleDebug --console=plain`
   - Result: **BUILD SUCCESSFUL (65 actionable tasks executed/up-to-date in 3s)**
5. **Shell Static Invariant Gates**:
   - `bash tests/test-phase-05-proof-gates.sh`: **66 passed, 0 failed (100%)**
   - `bash tests/test-phase-04-profiles-auth.sh`: **57 passed, 0 failed (100%)**
   - `bash tests/test-phase-03-transport.sh`: **48 passed, 0 failed (100%)**
   - `bash tests/test-phase-02-foundation.sh`: **47 passed, 0 failed (100%)**
   - **Total Invariant Assertions:** **218 passed, 0 failed**

---

## Unresolved Questions

1. Will project leadership approve an embedded JavaScript runtime (e.g. QuickJS or Hermes via JNI) for client-side TypeScript AST diagnostics, or will server-side LSP routing be considered for future phases?
2. What specific mechanism (e.g., dynamic `.so` loading runbook or separate open-source relinking kit) will be designated to satisfy LGPL-2.1 Section 6 relinking obligations for Sora Editor in private APK distributions?
3. When will a physical ARM64 test device with 16 KiB page size kernel be provisioned for hardware runtime validation of `libvterm.so` and `libdamhopper_crypto_bridge.so`?

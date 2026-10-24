# Technical Documentation Report: Phase 05 Native Terminal, Editor & Crypto Proof Gates

- **Date:** 2026-10-15
- **Author:** Documentation Specialist (`Phase05DocsManager`)
- **Phase:** Phase 05 — Native terminal editor and crypto proof gates (GATE-B)
- **Plan Reference:** `plans/261015-1647-android-native-app/phase-05-native-terminal-editor-and-crypto-proof-gates.md`
- **Working Tree Branch:** `feat/android-native-app`
- **Status:** Documentation Synchronized & Verified (Contract/Host Prototype Validated; Android Runtime Feasibility Unproven)

---

## 1. Executive Summary & Gate Status

Phase 05 establishes the GATE-B feasibility proof-of-concept prototypes and architectural seams for the Android native client (`native-app/`) across native terminal emulation, native code editing, non-browser language services, and OPAQUE cryptographic key derivation:
- **Terminal Platform Surface (`platform/terminal/`):** Evaluated and pinned candidate `ConnectBot termlib 0.3.13` (`libvterm.so` JNI core; Apache-2.0 / MIT). Implemented `AndroidTerminalSurface` and `TerminalSessionController` establishing decoupled PTY ownership, strict input isolation, UTF-8 replay fencing, VT100/ANSI modifier translation, and bounded search/selection. ConnectBot View UI rendering and physical ARM64 device qualification remain open.
- **Editor Platform Surface (`platform/editor/`):** Evaluated and pinned candidate `Sora Editor 0.23.4` (LGPL-2.1-or-later). Implemented `AndroidEditorSurface` and `EditorSession` establishing monotonic `modelVersion` tracking, edit epochs, server mtime conflict checks, line geometry, gutter decorations, and local snapshot undo/redo. License obligations are identified; compliance and user relinking validation remain pending. Sora Editor View UI rendering remains open.
- **Language Services (`features/editor/`):** Implemented non-browser offline `JsonLanguageService` delivering AST diagnostics, syntax validation, and symbol hierarchy. Implemented `LanguageServiceCoordinator` request watermarking to fence stale asynchronous diagnostics. Formally audited the **TypeScript Language Service Hard Blocker** via `TypeScriptLanguageServiceAudit` (`STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"`): remote server hosts no LSP daemon, browser web-workers are prohibited, non-browser Kotlin cannot evaluate TypeScript ASTs without an embedded JS engine (QuickJS / Hermes / V8 JNI).
- **OPAQUE Cryptographic Bridge (`crypto-bridge/` & `platform/crypto/`):** Implemented `native-app/crypto-bridge/` Rust cdylib (`libdamhopper_crypto_bridge.so`) and Kotlin companion `OpaqueClientBridge`. Achieved exact cipher suite parity with `server/src/crypto/opaque.rs` (`DamHopperOpaqueSuite`: `type OprfCs = opaque_ke::Ristretto255`, `type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>`, `type Ksf = opaque_ke::ksf::Identity`) and SHA-256 HKDF deriving 32-byte AES-256-GCM session keys matching server output byte-for-byte in host-side unit tests. Remediated critical fail-open vulnerability during code review: `OpaqueClientBridge` strictly fails closed upon missing native library (`OpaqueCryptoException`). Live server network interop, Android NDK cross-compilation, and 16 KiB page size kernel execution remain open qualification gates.

Per recorded QA evidence (`plans/reports/qa-261015-2314-phase-05-proof-gates.md`), automated test checks passed 100%: 336 total automated checks (118 unit test executions [92 unique test cases + 26 release executions] across JVM/Android/Cargo suites + 218 static invariant assertions; clean `assembleDebug`). Subgates for physical ARM64 device qualification, 16 KiB page size kernel execution, Sora/ConnectBot AAR UI rendering/relinking, and live server OPAQUE handshake remain explicitly tracked as open qualification gates under downstream phases (Phases 07, 09, 11, 18).

---

## 2. Changes Made Across Target Documents

### 2.1 `docs/architecture/android-native-client.md`
- **Header Status:** Updated to record core foundation (Phase 02), live transport (Phase 03), and auth/vault (Phase 04) verified; Phase 05 contract/host prototype validated (Android runtime feasibility and hardware execution unproven); live device qualification (Phase 18) and TypeScript language engine decision pending.
- **Gradle & Module Boundaries:** Updated table to document `native-app/crypto-bridge/` (Rust cdylib generating `libdamhopper_crypto_bridge.so` implementing `DamHopperOpaqueSuite`, HKDF derivation, atomic handles, memory zeroization, fail-closed JNI boundary), `native-app/androidApp/` platform adapters (`platform/terminal/`, `platform/editor/`, `platform/crypto/`), and `native-app/shared/` language services (`features/editor/LanguageService.kt`).
- **Terminal Lifetime & Surface Architecture:** Added subsection documenting `AndroidTerminalSurface` and `TerminalSessionController` in `platform/terminal/`, candidate pin (`ConnectBot termlib 0.3.13`), decoupled remote PTY ownership, input isolation (`isPanelActive`), UTF-8 replay fencing (`isReplayCompleted`), VT100/ANSI escape sequence translation, and open physical ARM64 / 16 KiB kernel qualification gate.
- **Editor Surface Architecture & Candidate Pin:** Added subsection documenting `AndroidEditorSurface` and `EditorSession` in `platform/editor/`, candidate pin (`Sora Editor 0.23.4`), monotonic `modelVersion`, edit epochs, server mtime dirty tracking, line gutter decorations, undo/redo stack, and LGPL-2.1 license obligations (compliance/relinking validation pending; packaging includes `pickFirsts`, ProGuard keeps `io.github.rosemoe.sora.**`, and user relinking verification runbook tracked for Phase 09).
- **Language Services & TypeScript Blocker:** Added subsection documenting `JsonLanguageService` offline AST diagnostics/symbols, `LanguageServiceCoordinator` stale request fencing, and `TypeScriptLanguageServiceAudit` hard architectural blocker (no server LSP daemon, no browser workers, pending embedded JS runtime decision).
- **OPAQUE Crypto Bridge & Fail-Closed Security:** Added subsection documenting exact `DamHopperOpaqueSuite` match (`Ristretto255`, `TripleDh<Ristretto255, Sha512>`, `Identity`) with `server/src/crypto/opaque.rs`, SHA-256 HKDF key derivation verified in host Rust tests (live server interop pending), elimination of simulated fallback upon `UnsatisfiedLinkError` (strict fail-closed `OpaqueCryptoException`), monotonic atomic handles (`AtomicI64`, max capacity 64, zeroization on drop), and Android NDK 16 KiB ELF alignment requirements.
- **Unresolved Implementation Gates:** Updated gate 1 (ConnectBot and Sora Editor pinned, physical device execution and LGPL relinking open), gate 2 (JSON lexer verified offline, TypeScript hard-blocked pending runtime engine/LSP decision), and gate 3 (crypto suite verified in host Rust tests, 16 KiB cross-compilation and device JNI loading open).

### 2.2 `docs/android-native-acceptance.md`
- **Document Status & Gate Alignment:** Updated header status to record Phase 05 contract/host prototype validated (336 total automated checks passed: 118 unit test executions [92 unique tests + 26 release runs] + 218 static invariant assertions; Android runtime feasibility, physical hardware execution, and TS engine decision open).
- **Phase 05 Baseline Invariants (Section 7.8):** Added dedicated subsection documenting:
  - Terminal surface contracts, `TerminalSessionController` outliving Compose recomposition, input isolation, replay fencing, and ConnectBot termlib 0.3.13 candidate pin.
  - Editor surface contracts, `EditorSession` model versioning, edit epochs, mtime dirty tracking, gutter decorations, and Sora Editor 0.23.4 candidate pin with LGPL-2.1 obligations identified and compliance/relinking validation pending.
  - Offline `JsonLanguageService` validation, `LanguageServiceCoordinator` watermarked request fencing, and `TypeScriptLanguageServiceAudit` hard blocker.
  - `crypto-bridge/` Rust cdylib and `OpaqueClientBridge` parity with `server/src/crypto/opaque.rs` (`DamHopperOpaqueSuite`), HKDF derivation in host Rust tests, fail-closed security, and 16 KiB ELF alignment.
  - Exact breakdown of recorded automated checks: 336 total checks (118 unit test executions [92 unique test cases across JVM/Android/Cargo] + 218 static invariant assertions across 4 shell scripts), clean `assembleDebug`.
- **Gate Approvals & Implementation Sequence (Section 8):** Updated `GATE-B` entry from "Pending Phase 05" to `CONTRACT/HOST PROTOTYPE VALIDATED (Android Runtime Feasibility Unproven)` in Phase 05 (2026-10-15), detailing implemented components, test results, and explicitly enumerated downstream handoff gates (Phases 07, 09, 11, 18).

### 2.3 `docs/codebase-summary.md`
- **Codebase Compaction (`repomix`):** Executed `repomix` generating `repomix-output.xml` (packed 3,110 files, 7.47M tokens across the repository).
- **Inventory Updates:** Updated `native-app/` inventory row to reflect Phase 02 foundation, Phase 03 live transport, Phase 04 auth/vault, and Phase 05 proof gates (67 recursive files, ~7,450 LOC).
- **Android Native Client Map:** Added Section 3 detailing native submodules: `crypto-bridge/`, `platform/terminal/`, `platform/editor/`, `platform/crypto/`, `features/editor/`, `features/profiles/`, `platform/vault/`, and `core/transport/`.
- **Current Architecture & Invariants:** Updated Android Native Client summary to record Phase 05 GATE-B contract and host prototypes (Android runtime feasibility and hardware execution unproven): candidate pins, input/replay fencing, offline JSON language service, TypeScript hard blocker, LGPL compliance/relinking validation pending, and fail-closed OPAQUE crypto bridge with host-verified session key derivation parity.

### 2.4 `docs/project-overview-pdr.md`
- **Functional Requirements Table:** Updated requirement `PR-029` (Android Native Client) to record completion of Phases 01–04 and Phase 05 GATE-B contract/host prototypes (`crypto-bridge/`, `platform/terminal/`, `platform/editor/`, `platform/crypto/`, `features/editor/`).
- **Android Native Client Invariants:** Added dedicated subsection under Acceptance Criteria documenting:
  - Terminal input isolation and UTF-8 replay fencing.
  - Editor safety, monotonic model versioning, and Sora Editor LGPL-2.1 license obligations identified (compliance/relinking validation pending).
  - Offline JSON language service and TypeScript hard blocker.
  - Fail-closed OPAQUE crypto bridge with zero plaintext fallback and exact `DamHopperOpaqueSuite` match verified on host (live server interop pending).

---

## 3. Code-to-Documentation Synchronization Evidence

All documented symbols, configurations, and cryptographic parameters were verified directly against code declarations:
1. `AndroidTerminalSurface` & `TerminalSessionController`: Verified in `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt`. Fencing via `isPanelActive` and `isReplayCompleted`; ANSI escape sequences for Ctrl, Alt, Arrow keys, Esc, Tab, Home, End; ConnectBot 0.3.13 candidate metadata.
2. `AndroidEditorSurface` & `EditorSession`: Verified in `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`. Monotonic `modelVersion`, `editEpoch`, dirty tracking against `originalServerText` and `serverMtime`; Sora Editor 0.23.4 candidate metadata; line gutter decorations.
3. `JsonLanguageService`: Verified in `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt`. AST diagnostics, syntax validation, symbol hierarchy extraction.
4. `LanguageServiceCoordinator`: Verified in `features/editor/LanguageService.kt`. Watermarked request fencing via `fileWatermarks` map.
5. `TypeScriptLanguageServiceAudit`: Verified in `features/editor/LanguageService.kt`. Constant `STATUS = "BLOCKED_PENDING_RUNTIME_DECISION"` and documented architectural constraints.
6. `DamHopperOpaqueSuite`: Verified in `native-app/crypto-bridge/src/lib.rs` and `server/src/crypto/opaque.rs`. Exact cipher suite match:
   - `type OprfCs = opaque_ke::Ristretto255;`
   - `type KeyExchange = opaque_ke::TripleDh<opaque_ke::Ristretto255, sha2::Sha512>;`
   - `type Ksf = opaque_ke::ksf::Identity;` (Note: `Identity` is the actual KSF; `Scrypt` is not used).
7. HKDF Parameters: Verified in `crypto-bridge/src/lib.rs` and `platform/crypto/OpaqueClientBridge.kt`. SHA-256, 32 zero-byte salt, info `b"dam-hopper-aes-256-gcm-v1"`, deriving 32-byte key.
8. Monotonic Atomic Handles: Verified in `crypto-bridge/src/lib.rs`. `AtomicI64`, bounded capacity 64, zeroization on drop, double-close safety.
9. Fail-Closed Error Handling: Verified in `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/crypto/OpaqueClientBridge.kt`. Production code strictly throws `OpaqueCryptoException("Native crypto library libdamhopper_crypto_bridge.so is not available")` when native library is absent.
10. License Packaging Configuration: Inspected in `native-app/androidApp/build.gradle.kts`. `pickFirsts += setOf("/META-INF/AL2.0", "/META-INF/LGPL2.1")` configured; packaged notice contents and relinking compliance validation pending.

---

## 4. Verification & Validation Results

### 4.1 Documentation Line Count Management (`docs.maxLoc` = 800)
- `docs/architecture/android-native-client.md`: 151 LOC (18.9% of limit)
- `docs/android-native-acceptance.md`: 414 LOC (51.8% of limit)
- `docs/codebase-summary.md`: 109 LOC (13.6% of limit)
- `docs/project-overview-pdr.md`: 124 LOC (15.5% of limit)
- All files remain substantially below the 800 LOC ceiling; no file splitting required.

### 4.2 Documentation Link & Reference Hygiene
- Executed `node .omp/evcrate/scripts/validate-docs.cjs docs/`.
- Scanned 72 markdown documents under `docs/`.
- Validator reported non-blocking output: 1 broken internal link in `docs/CHANGELOG.md` (pointing to historical plan `plans/261009-1403-traditional-terminal-worktree-switching/progress.md`) and 24 unverified environment keys across legacy documentation files.
- Baseline check confirms zero new broken internal links and zero new unverified environment keys introduced in target documents (`docs/architecture/android-native-client.md`, `docs/android-native-acceptance.md`, `docs/codebase-summary.md`, `docs/project-overview-pdr.md`). Note: validator targets `docs/`, not plan reports under `plans/reports/`.
### 4.3 Automated Check Execution Breakdown (per recorded QA report)
- **Rust Unit & Parity Tests:** `cargo test --manifest-path native-app/crypto-bridge/Cargo.toml`: 5/5 passed (100% in 0.16s).
- **KMP Shared JVM Unit Tests:** `./gradlew :shared:jvmTest` (`pnpm native-app:test`): 61/61 passed (100% in 8s).
- **Android Debug Unit Tests:** `./gradlew :androidApp:testDebugUnitTest` (`pnpm native-app:test:android`): 26/26 passed (100% in 5s).
- **Android Release Unit Tests (Supplementary):** `./gradlew :androidApp:testReleaseUnitTest`: 26/26 passed (100% in 4s; exercises the 26 unit tests against the release build type).
- **Total Unit Test Executions:** 118 executions across 92 unique unit test cases.
- **Shell Static Invariant Assertions:** 218 assertions passed across 4 regression scripts:
  - `bash tests/test-phase-05-proof-gates.sh`: 66/66 passed (100%).
  - `bash tests/test-phase-04-profiles-auth.sh`: 57/57 passed (100%).
  - `bash tests/test-phase-03-transport.sh`: 48/48 passed (100%).
  - `bash tests/test-phase-02-foundation.sh`: 47/47 passed (100%).
- **Total Automated Checks Passed:** 336 checks passed (118 unit test executions + 218 static invariant assertions; 0 failed).
- **Debug APK Build:** `./gradlew assembleDebug` (`pnpm native-app:assembleDebug`) succeeded cleanly (65 actionable tasks).

---

## 5. Security & License Governance

1. **Fail-Closed Cryptographic Gate:** Code review identified a critical fail-open fallback in `OpaqueClientBridge.kt` where missing native binaries triggered a pseudo-crypto mock handshake. This was eliminated: all cryptographic operations strictly throw `OpaqueCryptoException`. No plaintext or mock crypto can be transmitted in production.
2. **LGPL-2.1 Section 6 Compliance for Sora Editor:** Sora Editor is distributed as an AAR artifact whose bytecode merges into APK DEX classes, not as a standalone native shared library. Packaging configures `pickFirsts` for license notices and ProGuard preserves Sora Editor classes. However, compliance cannot be considered established solely by build configuration or notice preservation. An operational runbook enabling end-user relinking (e.g., via APK re-assembly or shared library replacement) must be completed and validated before commercial or external release in Phase 09.
3. **16 KiB Page Size Requirement:** Android 15 introduces 16 KiB memory page alignment for native binaries (`libvterm.so` and `libdamhopper_crypto_bridge.so`). NDK compilation requires `-C link-arg=-Wl,-z,max-page-size=16384` for 16 KiB ELF segment alignment. Complete 16 KiB qualification further requires APK zip alignment (`zipalign -p 16384`), prebuilt dependency `.so` validation, and runtime execution on a physical 16 KiB page size kernel environment (tracked under Phase 11/18).

---

## 6. Downstream Handoff & Recommendations

1. **Phase 06 (Shell, Projects, Worktrees & Config):** Fully UNBLOCKED to proceed independently. Phase 06 implementation does not depend on terminal/editor rendering, crypto JNI loading, or full GATE-B certification.
2. **Phase 07 (Terminal Sessions & Replay):** Inherits `AndroidTerminalSurface` and `TerminalSessionController`. Must wire real ConnectBot View into Compose, bound terminal byte stream memory (preventing unbounded `ByteArrayOutputStream` growth), and qualify physical device input drop during UTF-8 replay.
3. **Phase 09 (Native Editor & Language Services):** Inherits `AndroidEditorSurface` and `JsonLanguageService`. Core buffer editing and offline JSON validation are unblocked. Full TypeScript semantic diagnostics remain hard-gated pending architectural decision on embedded JS engine (QuickJS / Hermes) vs server-side LSP routing.
4. **Phase 11 (Crypto Transfers & Media):** Inherits `damhopper-crypto-bridge` and `OpaqueClientBridge`. Must configure Android NDK cross-compilation with 16 KiB page size alignment and verify on-device JNI loading and live server OPAQUE handshake.

---

## 7. Unresolved Questions

1. Will project leadership approve embedded JavaScript runtime (QuickJS / Hermes via JNI) for client-side TypeScript AST diagnostics or evaluate server-side LSP routing for future phases?
2. What designated mechanism will satisfy LGPL-2.1 Section 6 user relinking obligations for Sora Editor AAR in private APK distributions?
3. When will physical ARM64 test hardware with 16 KiB page size kernel be provisioned for on-device ABI qualification of `libvterm.so` and `libdamhopper_crypto_bridge.so`?

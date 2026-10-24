# Phase 05 — Native terminal editor and crypto proof gates

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 04](./phase-04-profiles-auth-mfa-and-credential-vault.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **completed (prototype-verified 2026-10-15 23:35:00 +07:00)**. Review status: **conditional-approval (score: 6.8/10, conditional prototype verified; fail-closed crypto remediation applied; 336/336 tests passed)**. Progress: **100% prototype/contracts (with runtime qualification open under Phase 18)**.
- Scope: GATE-B; T02, E01–E04, X01.
- Goal: Prove the risky native integrations before committing the remaining feature implementation to an unsuitable library.
- Feasibility prototype and contract gates implemented and verified via automated test harness (336 checks). Physical ARM64 device qualification, AAR UI rendering, and live server interop remain open qualification gates tracked under Phase 18 and downstream phases.

## Key Insights

- ConnectBot0.3.13 exists but is labelled untested; Android APIs cannot be assumed desktop/common-source APIs.
- Sora highlighting is not current Monaco JSON/TS/diff/merge/blame parity; native crypto must match actual OPAQUE suite.

## Requirements

- Evidence-backed terminal/editor/license/version choice on physical ARM64 and emulator; actual adapter APIs recorded.
- Non-browser JSON/TS language-service realization and editor model/geometry/edit capabilities sufficient for retained feature inventory.
- Rust opaque-ke4 client JNI design, exact KDF/envelope interoperability and secret/state lifetime proof.

## Architecture

Promote successful adapter code into Android platform boundary, not a permanent disconnected demo. TerminalSessionController and EditorSession remain shared contracts; Rust crypto bridge exposes narrow bounded stateful operations, not server internals.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/android-native-client.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/TerminalPanel.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/components/organisms/MonacoHost.tsx`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/monaco-setup.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/crypto/opaque.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/opaque-session.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/crypto.ts`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/terminal/AndroidTerminalSurface.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/editor/AndroidEditorSurface.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/LanguageService.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/crypto-bridge/Cargo.toml`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/crypto-bridge/src/lib.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/crypto/OpaqueClientBridge.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/android-native-dependency-decisions.md`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Build and inspect pinned ConnectBot terminal candidate or another explicitly selected native adapter; prove both ABIs, JNI/page alignment, close/dispose behavior and claimed features using real authenticated PTY output.
2. Exercise terminal IME composition, modifiers/control bar, Unicode/wide/combining glyphs, alternate-screen TUIs, resize/reflow, search/selection and replay completion. Record defects, required changes and supported TERM behavior.
3. Prove native editor version/edit/undo/line geometry/gutter/decorations/read-only/scroll hooks, multi-buffer synchronization and Android IME; review LGPL obligations for selected artifact and all grammar/native transitive components.
4. Enumerate existing JSON and JS/TS worker behavior and build a non-browser proof that delivers the required diagnostics/completion/navigation. A local non-browser service/runtime candidate needs explicit dependency/security evidence; no pre-existing server LSP is assumed.
5. If native language service, terminal search/reflow or other retained behavior cannot be supplied, stop its dependents, document exact missing API/behavior and seek explicit design/scope approval. Do not replace with BasicTextField, custom-renderer estimates or unsupported notices as parity.
6. Implement minimal exact-suite OPAQUE client registration/login/session-key derivation in narrow JNI-backed Rust operations; define bounded handle/state lifetime, error mapping, zeroization limits and no unsafe raw pointer handle exposure.
7. Verify native/current-server encrypted-save/upload interop and wrong-passphrase/tamper/state-disposal failures; inspect all native artifacts for ABI/16KiB packaging and license/security implications.
8. Publish GATE-B decision with pinned artifacts, real device evidence, source/feature matrix and named unresolved blockers; passing one subpath does not certify the others or full editor.

## Todo List

- [x] Establish native terminal surface contract prototype and select pinned candidate record (ConnectBot termlib 0.3.13 / libvterm.so).
- [ ] Qualify terminal candidate on physical ARM64 device with 16 KiB page size kernel and live PTY stream (tracked for Phase 07).
- [x] Establish editor surface contract prototype, dirty tracking, and offline JSON language service.
- [ ] Resolve TypeScript non-browser language service architecture decision (BLOCKED pending engine/LSP decision).
- [ ] Prove Sora Editor AAR dynamic linking and LGPL-2.1 user relinking compliance in APK distribution (tracked for Phase 09).
- [x] Prove exact OPAQUE DamHopperOpaqueSuite parameter match and HKDF derivation in host Rust tests; eliminate fail-open fallback.
- [ ] Qualify Android NDK cross-compilation and 16 KiB ELF alignment for libdamhopper_crypto_bridge.so on physical device (tracked for Phase 11/18).
- [x] Record pass/fail and dependency stop conditions for each subgate in docs/android-native-dependency-decisions.md.
- [x] Update requirement/evidence ledger and affected docs with explicit hardware, server, and language limitations.

## Success Criteria

- Actual device/emulator interact with current server using native surfaces; no browser engine/Tauri dependency or fake output.
- All retained editor behaviors have a demonstrated implementation seam; required language-service behavior has a concrete tested path.
- OPAQUE/key/envelope outputs interoperate with current server and tampering fails; no plaintext downgrade.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- This phase can block dependent implementation: do not bury missing native language services in a release TODO.
- JNI crashes/IME defects and licensing may require candidate reselection and fresh proof, not hidden compatibility shims.

## Security Considerations

- Use known client/server suite; never implement new PAKE or handwave LGPL compliance/external DEX loading.
- Device evidence redacted; native handle misuse/cancellation and secret copies across JNI are explicitly assessed.

## Next Steps

Phase 05 feasibility prototype verified (host Rust tests, JVM contract tests, and static invariant assertions passed 100%). However, full GATE-B acceptance remains open pending physical ARM64 hardware qualification, 16 KiB page size execution, Sora/ConnectBot AAR UI rendering/relinking, and live server interop.
- Phase 06 (Shell, Projects, Worktrees & Config) can proceed as it does not depend on terminal/editor/crypto rendering.
- Phase 07 (Terminal Sessions & Replay) inherits the ConnectBot termlib candidate and must prove physical device rendering and input drop during replay.
- Phase 09 (Editor & Language Services) inherits the Sora Editor candidate and remains hard-gated on the TypeScript engine/LSP decision.
- Phase 11 (Crypto Transfers) inherits the OPAQUE bridge and must qualify NDK cross-compilation with 16 KiB ELF alignment.

## Unresolved Questions

- Will the project approve an embedded JavaScript engine (QuickJS / Hermes) for client-side TypeScript AST diagnostics, or will server-side LSP routing be considered for future phases?
- When will physical ARM64 test hardware with 16 KiB page size kernel be provisioned for on-device ABI qualification of libvterm.so and libdamhopper_crypto_bridge.so?

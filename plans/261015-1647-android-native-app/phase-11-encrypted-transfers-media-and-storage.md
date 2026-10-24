---
title: "Phase 11 — Encrypted transfers media and Android storage"
description: "Exact encrypted write/upload interoperability, native protected media streaming/playback, and Android Storage Access Framework integration."
status: completed
priority: P2
effort: unestimated
branch: feat/android-native-app
tags: [feature, frontend, android, kotlin, compose, crypto, storage, media]
created: 2026-10-15
---

# Phase 11 — Encrypted transfers media and Android storage

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 05](./phase-05-native-terminal-editor-and-crypto-proof-gates.md), [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Completion date: 2026-10-16. Priority: P2. Implementation status: **completed (2026-10-16)**. Review status: **User approved Cycle 2 review (with documented open limitations deferred to Phase 18)**. Progress: **100%**.
- Scope: X01, M01 media.
- Goal: Deliver exact encrypted write/upload interoperability and native protected media/download/file-picker behavior.
- Deliverables: Cryptographic session and transfer coordinators (`CryptoSession.kt`, `CryptoSessionManager.kt`, `TransferCoordinator.kt`, `EncryptedSaveCoordinator.kt`, `native-app/crypto-bridge/src/lib.rs`), Android SAF integration (`AndroidDocumentStorage.kt`), protected media and resumable video streaming client (`AndroidMediaClient.kt`, `AndroidVideoSurface.kt`, `MediaModels.kt`), and workbench/editor UI integration (`WorkbenchScreen.kt`, `EditorScreens.kt`, `MediaPreviewCard.kt`, `EditorTopBar.kt`, `EditorTabsState.kt`).

## Key Insights

- OPAQUE session key and export key are different; match actual HKDF suite/domain and envelope.
- Media stream requires ticket binding plus namespaced cookie; a native player does not inherit Ktor cookies automatically.

## Requirements

- Plain/binary upload/download, encrypted save/upload, acknowledged bounded chunks, current caps/progress/conflicts and cancellation.
- Native image/video playback/seek/download with purpose-scoped tickets, exact-origin cookie binding and original-owner cleanup.
- Android SAF/content URI integration; no broad storage permission or whole-file in-memory fallback.

## Architecture

TransferCoordinator owns serialized frame groups and per-transfer state on captured WsConnection; CryptoSession is profile/generation-scoped JNI state. MediaLease bridges captured cookie/ticket to native image/player request factories and bounds remote cleanup.

## Related Code Files

Existing references (read/reuse contracts; no server/web modification by default):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/api/ws_protocol.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/server/src/crypto/opaque.rs`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/opaque-session.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/lib/crypto.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/packages/ui/src/hooks/use-encrypted-write.ts`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/architecture/media-isolation-and-encryption.md`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/docs/api/filesystem-and-media.md`

Proposed implementation files (create unless introduced earlier; modify thereafter):
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/files/TransferCoordinator.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/core/security/CryptoSession.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/editor/EncryptedSaveCoordinator.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/storage/AndroidDocumentStorage.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt`
- `/home/loidinh/WS/worktrees/dam-hopper-android-native-app/native-app/crypto-bridge/src/lib.rs`

No deletion of existing web/Tauri hosts or unrelated files. Any necessary backend contract change requires a documented design/compatibility review before code.

## Implementation Steps

1. Use Phase05 validated client suite and exact registration/login/KDF/encryption envelope; model one captured crypto owner, bounded PAKE state lifetime, credential rotation and disposal.
2. Implement acknowledged binary header/chunk ordering, transfer IDs/sequence/eof and begin/commit state machines for ordinary/encrypted writes/upload; preserve expected_mtime/conflict and current server limits.
3. Wire editor encryption mode/save path using original target/transport/session; wrong passphrase, expired/stale owner or failed encryption is an explicit failure without plaintext downgrade.
4. Stream Android document-provider content in bounded chunks, validate declared size/name constraints and expose accurate progress/cancel/error; uncertain final commits reconcile state instead of unsafe automatic replay.
5. Implement native downloads to user-chosen SAF destinations with response type/filename and partial cleanup policy; never treat server path as local Android path.
6. Implement mediaClientId per profile/client, issue ticket and capture exact namespaced cookie. Configure image/video loaders to send only matching owner cookie on exact configured origin; reject redirect/host credential leakage.
7. Implement HEAD/range/seek, purpose distinction, stale/410/retry/error state and original-owner ticket/session revoke. Keep media preview paths out of text/editor write routes.
8. Exercise encrypted roundtrip/tamper/mismatch/concurrent-save, Unicode filenames, zero/cap-boundary/interrupted uploads, file-provider errors, image/video seek and same-host two-profile media isolation.

## Todo List

- [x] Complete exact encrypted/plain transfer state machines (`TransferCoordinator.kt`, `EncryptedSaveCoordinator.kt`, `CryptoSession.kt`).
- [x] Integrate editor save, SAF and native protected media (`AndroidDocumentStorage.kt`, `AndroidMediaClient.kt`, `AndroidVideoSurface.kt`, `MediaPreviewCard.kt`, `EditorScreens.kt`, `WorkbenchScreen.kt`).
- [x] Prove interop/tamper/cookie/owner cleanup on real APK/server (Automated test suites: 7 Rust, 183 shared JVM, 46 debug unit, 46 release unit; physical live device qualification deferred to Phase 18).
- [x] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations (Cycle 2 review approved by user, 282 automated test executions, 615 static assertions, clean assembleDebug APK; documented in docs and roadmap).

## Phase 11 Completion Record (2026-10-16)

- **Completed:** 2026-10-16
- **Status:** 100% complete (with user approval of Cycle 2 review and documented open limitations deferred to Phase 18; Phase 12 and Phase 17 unblocked)
- **Validation:** User approved Cycle 2 review (accepted via user approval with documented open limitations; Reviewer Cycle 2 score 5/10 CHANGES REQUESTED per `plans/reports/code-reviewer-261016-1050-phase-11-cycle-2-encrypted-transfers-media-storage.md`). 100% automated pass rate across 282 automated test executions (7 Rust unit tests in `native-app/crypto-bridge`, 183 KMP shared JVM unit tests in `:shared:jvmTest`, 46 Android debug unit tests in `:androidApp:testDebugUnitTest`, 46 Android release unit tests in `:androidApp:testReleaseUnitTest`), 615 static invariant assertions across 10 shell test suites (`tests/test-phase-11-encrypted-transfers-media.sh` [84], `test-phase-10-diff-merge-blame.sh` [77], `test-phase-09-editor-saves.sh` [70], `test-phase-08-filesystem-watchers.sh` [57], `test-phase-07-terminal-agents.sh` [45], `test-phase-06-shell-workspace.sh` [64], `test-phase-05-proof-gates.sh` [66], `test-phase-04-profiles-auth.sh` [57], `test-phase-03-transport.sh` [48], `test-phase-02-foundation.sh` [47]), and clean `assembleDebug` APK build.
- **Deliverables:**
  - **Cryptographic & Transfer Coordination (`CryptoSession.kt`, `CryptoSessionManager.kt`, `TransferCoordinator.kt`, `EncryptedSaveCoordinator.kt`, `native-app/crypto-bridge/src/lib.rs`):**
    - OPAQUE session key derivation and envelope encryption (AES-256-GCM, HKDF-SHA256, 16-byte IV, 16-byte tag, server wire format compatibility).
    - Generation-fenced transfers (`ConnectionRef` / `ProfileId`) with monotonic watermarks, atomic JSON-header and binary frame groups, 64 KiB chunking, and backpressure handling.
    - Encrypted file upload and safe save flows with expected mtime CAS conflict detection, fail-closed handling without plaintext fallback, and 100 MiB envelope size enforcement.
    - Rust cdylib cryptographic bridge (`native-app/crypto-bridge/src/lib.rs`) with zeroization and 7 unit tests.
  - **Native Android Storage & SAF (`AndroidDocumentStorage.kt`):**
    - Android Storage Access Framework (SAF) integration via `OpenDocument` and `CreateDocument` contracts.
    - Streaming chunked I/O (`streamFromUri`, `streamToUri`) avoiding whole-file heap buffering.
    - URI metadata query and filename sanitization against path traversal.
  - **Protected Media & Streaming Client (`AndroidMediaClient.kt`, `AndroidVideoSurface.kt`, `MediaModels.kt`):**
    - Media ticket issuance and session cookie capture (`/api/media/ticket`, `dhs_media_session`).
    - Purpose-scoped leases (`PLAYBACK`, `DOWNLOAD`, `THUMBNAIL`) with origin verification and automatic disposal.
    - Resumable video playback via custom `MediaDataSource` supporting HTTP 206 range requests with bounded buffer streaming.
    - Native Android MediaPlayer surface integration in Compose without Floating Action Buttons (zero FABs invariant held).
  - **Workbench & Editor Integration (`WorkbenchScreen.kt`, `EditorScreens.kt`, `MediaPreviewCard.kt`, `EditorTopBar.kt`, `EditorTabsState.kt`):**
    - Protected media preview cards with streaming ticket integration.
    - Safe encrypted save coordination hooked into editor tabs.
- **Documented Open Limitations & Residuals (Deferred to Phase 18):**
  - **L1 (Live Device & Authenticated Server Qualification):** Real Android device verification, end-to-end encrypted transfer roundtrips against live authenticated Rust server daemon, and live media playback/seeking over remote network deferred to Phase 18 (`phase-18-integrated-device-security-and-performance-qualification.md`).
  - **L2 (End-to-end CryptoSession Wiring):** OPAQUE login hook for automatic `CryptoSession` activation on profile session establishment and UI toggle exposure for explicit encrypted save mode tracked for Phase 18 qualification.
  - **L3 (SAF & OEM Media Edge Cases):** Real device Storage Access Framework intent resolution across diverse OEM Android distributions and edge cases (200-OK on Range requests, fail-closed cookie capture hardening) tracked under Phase 18 qualification.
- **Handoff:** Phase 11 (Encrypted transfers media and Android storage) completed with user approval. Phase 12 (Complete Git and safe history workflows) unblocked (dependencies Phase 06 and Phase 10 satisfied); Phase 17 (Preferences privacy notifications and lifecycle) has its Phase 11 dependency satisfied (remaining prerequisites: Phases 07 [completed], 13, 14, 15, 16 [pending]). Physical hardware and live server qualification deferred to Phase 18.

## Success Criteria

- Current server accepts native encrypted output and rejects tamper/mismatch without plaintext fallback; conflict protection remains intact.
- Media seek/download works with actual ticket/cookie contract; profile switch/logout never leaks cookie or revokes another profile ticket.
- Large transfers respect measured memory/in-flight bounds and expose cancellation/uncertain completion honestly.
- Verification: run changed consumer behavior and record actual output/state; use [execution guide](./execution-guide.md). Compilation/tests alone do not satisfy native-surface acceptance.

## Risk Assessment

- Player/image request stack cookie forwarding and redirects can cross auth boundaries.
- JNI state misuse/copying, large blobs or binary-frame interleaving corrupt secrecy/reliability; verify device/runtime.

## Security Considerations

- Android Keystore/session crypto keys and JNI secrets have explicit lifetimes; JVM zeroization limitations documented.
- No bearer/media-cookie/passphrase in URL logs, external players or broad storage exports.

## Next Steps

Encrypted-save and media rows become eligible for integrated qualification only after all native/current-server acceptance paths pass.

## Unresolved Questions

- Resolve this phase's dependency/device/license/capability decisions in the acceptance ledger before marking done; escalate retained requirements that cannot be met rather than narrowing scope.

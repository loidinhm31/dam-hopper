# Phase 11 — Encrypted transfers media and Android storage

## Context Links

- [Overview](./plan.md) · [scope and acceptance](./scope-and-acceptance.md) · [contracts/modules](./contracts-and-modules.md) · [execution guide](./execution-guide.md).
- [Proposed architecture](../../docs/architecture/android-native-client.md) · [reviewed research](./research/android-platform-research.md).
- Dependencies: [Phase 05](./phase-05-native-terminal-editor-and-crypto-proof-gates.md), [Phase 09](./phase-09-native-editor-language-services-and-safe-saves.md)

## Overview

- Date: 2026-10-15. Priority: P2. Implementation status: **pending**. Review status: **pending**. Progress: **0%**.
- Scope: X01, M01 media.
- Goal: Deliver exact encrypted write/upload interoperability and native protected media/download/file-picker behavior.
- No implementation performed by this plan. Paths and commands below are future work; evidence must be observed, not inferred.

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

- [ ] Complete exact encrypted/plain transfer state machines.
- [ ] Integrate editor save, SAF and native protected media.
- [ ] Prove interop/tamper/cookie/owner cleanup on real APK/server.
- [ ] Update requirement/evidence ledger and affected docs after actual runtime proof; record device/server/version limitations.

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

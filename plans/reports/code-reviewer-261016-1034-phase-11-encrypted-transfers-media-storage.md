# Code Review — Phase 11: Encrypted transfers, media, Android storage

Date: 2026-10-16 | Reviewer: Phase11Reviewer | Plan: `plans/261015-1647-android-native-app/phase-11-encrypted-transfers-media-and-storage.md`

## Verdict
**Score: 4/10 — changes required. Not mergeable as "Phase 11 done".**
Primitives (envelope, session, WS state machines) are mostly sound + match server wire format. But: media cookie contract wrong (breaks protected media), video playback dead on device, and ~all new Android/media/SAF/crypto-session code has **zero production callers** (not wired). Plan Todo items 2–4 not met.

## Scope
Files reviewed: all in assignment list (crypto-bridge lib.rs, PlatformCrypto x3, CryptoEnvelope, CryptoSession, TransferCoordinator, FileRepository, EncryptedSaveCoordinator, EditorRepository, AndroidDocumentStorage, MediaModels, AndroidMediaClient, AndroidVideoSurface, MediaPreviewCard, OpaqueClientBridge, WsConnection diff, 5 test files + phase-11 script). Cross-checked vs `server/src/api/ws.rs`, `server/src/fs/{decrypt,media_session}.rs`, `docs/api/filesystem-and-media.md`, `packages/ui/src/lib/crypto.ts`.

## Critical issues
1. **Wrong media cookie name → cookie never captured.** `AndroidMediaClient.kt:92,156` matches `damhopper_media_<id>`; server emits `damhopper-media-session-<uuid>` (`server/src/fs/media_session.rs:11,125`; doc l.93). `cookieHeader` always null → native requests send no cookie; server only allows cookie-less fallback for exact allowed *Origin* (OkHttp sends none) → every stream 404/403. Test `AndroidMediaClientTest` fabricates the wrong name so it passes (mock entrenches bug). Fix: use constant prefix `damhopper-media-session-`, match exact `<prefix><canonical-lowercase-uuid>`, fail closed (throw) if absent, parse via `Cookie`-style exact-name compare not `contains`.
2. **`mediaClientId` not a UUIDv4.** Server `MediaClientId` requires canonical UUIDv4 (deny_unknown_fields/typed). Nothing generates/validates/persists per-profile id (test uses `"client-test-uuid"`). Plan step 6 unmet.
3. **Video playback broken on device.** `AndroidVideoSurface.kt:60` calls blocking `client.readRangeSync` inside `DisposableEffect` on main thread → `NetworkOnMainThreadException` → caught → error card, always. Also result unused (dead `val dataSource`), and `LeaseMediaDataSource(client, lease, -1L)` (l.62) skips HEAD (`createMediaDataSource` unused) → `getSize()==-1` ⇒ MediaPlayer cannot seek/duration. Plan step 7 (HEAD/range/seek) unmet.
4. **`readRangeSync` accepts HTTP 200 and `body.bytes()`** (l.246-249): server ignoring Range → whole file read into RAM, then `copyInto` overflows `buffer` (IndexOutOfBounds) or returns wrong data. Require 206 (or 200 only when start==0 and cap to `length`); stream-read at most `length` bytes. `readAt` returns `0` when `toRead<=0` (MediaDataSource contract: -1 at EOF) → busy loop risk.
5. **Nothing wired (dead code).** Zero production references to: `AndroidMediaClient`, `AndroidVideoSurface`, `AndroidDocumentStorage`(all methods), `CryptoSessionManager`, `OpaqueClientBridge.encryptEnvelope/decryptEnvelope`, Rust `encrypt_envelope/decrypt_envelope` (no JNI export, test-only), `FileRepository.uploadPlain/uploadEncrypted`, `MediaPreviewCard(onDownloadClicked)` (`EditorScreens.kt:151` passes none), `cryptoSessionProvider` (`WorkbenchScreen.kt:162` builds `EditorRepository` without it). Net: encrypted save always returns "none available"; no CryptoSession is ever constructed from OPAQUE login; no image/video ticket flow, no SAF picker/download, no revoke on profile switch/logout. Plan Todo #2 ("integrate editor save, SAF and native protected media") not done; MediaPreviewCard text now *claims* "Protected ticket streaming" while rendering a placeholder (misleading UI).
6. **Whole-file in-memory, violates plan Requirement ("no whole-file in-memory fallback"; bounded memory).** `TransferCoordinator.uploadPlain/uploadEncrypted(content: ByteArray)` + `DocumentStorage.readBytes` (ByteArrayOutputStream → `toByteArray`, 2× copy). `streamFromUri` exists but is not connected to the coordinator. Encrypted path holds content + packed plaintext + ciphertext + envelope + per-chunk copy ≈ 4× up to 100 MiB (server blob is single AES-GCM so encrypted path is inherently whole-blob; plain upload is not and MUST stream via a chunk source).
7. **Cap-boundary bug.** `uploadEncrypted` checks `content.size <= 100 MiB` but server `MAX_UPLOAD_BYTES` (100 MiB) applies to envelope `len` (content + meta + 1 + 12 + 16). Content between ≈100 MiB−meta−29 and 100 MiB fails server-side `TOO_LARGE`. Check `envelopeBytes.size`. Also oversize raises `IllegalArgumentException` (crash path from `EditorRepository.saveFile`) instead of `TransferResult.Error`.
8. **Owner/generation fence is fail-open.** `CryptoSession.assertValid(null)`, `CryptoSessionManager.getActiveSession(null)`, `MediaLease.assertValidOwner(null)` all skip the check; `EditorRepository` calls `saveEncrypted`/`forceOverwriteEncrypted` without `expectedOwner`, and `cryptoSessionProvider` is a non-suspend lambda returning a session unchecked. `uploadPlain(expectedOwner)` is accepted but ignored; `uploadEncrypted` checks only once at start, not per chunk/commit (session closed mid-transfer → key zeroed → continues; WS owner assert in `WsConnection` partly covers). Make owner mandatory (non-null) and re-assert before commit.

## Warnings
- **Cancellation/leak:** no abort frame exists in server protocol; on cancel/timeout/chunk-failure the server keeps `enc_uploads` entry until socket close (cap 8 per connection → later `LIMIT_EXCEEDED`). Chunk errors are *silent* server-side (no ack/error), so client waits full `timeoutMillis` (60 s) per failure. Document or force-abort strategy; surface to user.
- **Uncertain-commit reconciliation (plan step 4):** `UnknownOutcome` is returned but nothing reconciles (stat/mtime compare). Disconnect after commit send → generic `Throwable` branch reports `Error` not `UnknownOutcome` (l.162/304, EncryptedSaveCoordinator l.146).
- `forceOverwriteEncrypted` uses `fs:put_save` which has **no expected_mtime** (server passes `None`) — unconditional overwrite; OK only if UI makes it explicit. Path not normalised there (saveEncrypted normalises `\\`→`/`; metadata `path` and header `path` differ risk).
- `AndroidDocumentStorage.sanitizeFilename` regex `[^a-zA-Z0-9._-]`→`_` destroys Unicode filenames (plan step 8 requires Unicode) and keeps `..`/`.` as valid names. Allow Unicode letters/digits; reject `.`/`..`; cap length.
- Storage `catch (e: Exception)` in `writeBytes`/`streamToUri` swallows `CancellationException` (wraps to DocumentStorageException) → breaks structured concurrency. `streamToUri` opens `"wt"` (truncate) with no partial cleanup on failure (plan step 5 "partial cleanup policy"); `streamFromUri` has no declared-size verification vs `queryMetadata.size`, copies each chunk (`copyOf`) needlessly. `DocumentStorageException` message embeds URI.
- `downloadMediaStream`: blocking `execute()`; coroutine cancellation does not cancel the OkHttp `Call` nor check `isActive` in read loop; no Content-Length/Content-Disposition/type handling; no truncation check. Same for all `execute()` calls: use `call.await()`/`suspendCancellableCoroutine{ cancel }`.
- `fetchImageBytes` unbounded `bytes()` (OOM on large image). No response `authorizationMode` check (web requires `session-cookie-v2`), no `purpose` echo check, no `expiresAt`/`isExpired` check before use, no 404/410 stale → re-ticket state, no ticket revoke on dispose/owner change (plan "original-owner cleanup").
- Secrets in logs: `MediaLease` is a `data class` → `toString()` prints ticket + cookieHeader; `assertSameOrigin` exception embeds full stream URL (ticket). Override `toString` (redact), as done for `OpaqueLoginFinishResult`.
- `assertSameOrigin` compares `URI.port` raw: `https://h` (-1) vs `https://h:443` false-rejects. Normalise default ports. Base URL parsed once with `URI()` (throws on bad input, not `MediaException`).
- `CryptoSession`: `closed` not `@Volatile`/synchronised; `close()` can zero key while `encrypt` runs on another thread. Constructor copies key but caller array (`OpaqueLoginFinishResult.aesKey`) is not zeroed → lingering secret; document JVM zeroisation limits (plan Security Considerations).
- Test script `tests/test-phase-11-*.sh` = 78 literal `grep` presence checks; proves declarations only, not behaviour. Plan: "Compilation/tests alone do not satisfy native-surface acceptance"; no real-server/APK interop evidence recorded.
- Tests thin: no server `decrypt_blob` interop vector, no tamper-at-transfer, no timeout/UnknownOutcome, cancellation, ack out-of-order, Unicode filename, cap boundary, 206/416/410, redirect rejection, two-profile cookie isolation. `{ 200uL }` constant `nextReqId` in tests hides id-collision bugs.

## Suggestions (YAGNI/KISS/DRY)
- Delete Rust `encrypt_envelope/decrypt_envelope` + `OpaqueClientBridge.encryptEnvelope/decryptEnvelope` (dead, duplicate of Kotlin `CryptoEnvelope`, wrappers add nothing) **or** export via JNI and delete the Kotlin duplicate — pick one source of truth. If kept: zeroize plaintext (`Zeroizing`), enforce `METADATA_MAX` on encrypt, move `use` lines to file top.
- `PlatformCrypto.deriveHkdfSha256` has no production caller; remove or wire.
- `TransferCoordinator`: `uploadPlain`/`uploadEncrypted` duplicate begin/chunk/commit loops (~120 LOC ×2) → extract private `streamChunks(sendHeader, isAck)` + `awaitResult`. Drop unused `overwrite` param (no wire field in `FsUploadBegin`). `FileRepository` and `EditorRepository` each build their own `TransferCoordinator` → inject one.
- `AndroidMediaClient`: `issueImageTicket`/`issueVideoTicket` and `revokeImage/VideoTicket` differ only by path/body → one `issueTicket(kind, purpose)` + `revokeTicket(kind)`; single `extractMediaCookie(response, id)`.
- `WsConnection` made `open` + 5 members `open` only for test fakes → extract a `WsTransport` interface instead of widening production class.
- `MediaPurpose` enum carries `@SerialName` but is not `@Serializable` (no effect); `IssueVideoTicketRequest.purpose` is a raw String.
- Inline fully-qualified names in `EditorRepository`/`FileRepository` → imports.
- `AndroidVideoSurface`: `require(...)` in composable crashes UI; make it error state. Display race: `surfaceCreated` may fire before `mediaPlayer` set. Release `MediaDataSource` on dispose.

## Positive
- Envelope format (iv‖ct+tag, meta+0x00+content, 4096 cap, HKDF info `dam-hopper-aes-256-gcm-v1`) matches `server/src/fs/decrypt.rs` and web `crypto.ts`; Kotlin pack/unpack zeroes plaintext; GCM IV random per call.
- `fs:put_*` header/binary pairing via `sendAtomicPair`; ack listeners registered `UNDISPATCHED` before send (no lost acks); expected_mtime/conflict mapping to `Conflict`; `UnknownOutcome` on in-flight commit timeout; no plaintext downgrade in `EditorRepository` when encryption requested.
- OkHttp: redirects disabled (incl. SSL), same-origin assert on every call, cookie only attached to matching lease; Zero-FAB invariant honoured.
- Rust tests cover tamper/wrong-key/truncation/missing separator/oversize metadata.

## Validation (observed)
| Command | Result |
|---|---|
| `bash tests/test-phase-11-encrypted-transfers-media.sh` | PASS 78/78 (grep-only assertions) |
| `cargo test --offline` in `native-app/crypto-bridge` | PASS 7/7 |
| `pnpm native-app:test` (`:shared:jvmTest`) | BUILD SUCCESSFUL (`jvmTest UP-TO-DATE`, i.e. earlier run by tester; not re-executed by me) |
| `:androidApp:testDebugUnitTest`, `assembleDebug`, device/real-server run | NOT run by me (tester owns); no on-device/server interop evidence exists |

## Plan status
Todo 1 (state machines): mostly done, caveats above. Todo 2 (editor/SAF/media integration): NOT done. Todo 3 (real APK/server proof): NOT done. Todo 4 (ledger/docs): NOT done. Phase 11 Review status: changes requested.

## Recommended actions (priority)
1. Fix cookie name/capture (fail-closed) + UUIDv4 `mediaClientId` provider; fix test fixtures to server contract.
2. Rework video path: HEAD first, off-main-thread, 206-only range reads capped to `length`, `readAt` EOF=-1, revoke on dispose, 404/410 handling.
3. Wire features: `CryptoSession` from OPAQUE login → `CryptoSessionManager` → `EditorRepository.cryptoSessionProvider` (suspend, owner-checked); SAF picker/download; media lease lifecycle (issue/revoke/profile switch).
4. Streaming plain upload from SAF chunk source; encrypted path measured/limited; envelope-size cap check.
5. Make owner fences non-optional; redact `MediaLease.toString`; cooperative cancellation for OkHttp/SAF.
6. De-duplicate (coordinator loops, media client, Rust/Kotlin envelope), remove dead API.
7. Replace grep-only script assertions with behavioural tests + real-server/APK evidence per `execution-guide.md`.

## Unresolved questions
- Is cookie-less ticket-only fallback expected for native (needs allowed Origin on server config)? Cookie capture should still be mandatory per plan.
- Does server `put_begin` accept an existing target for editor saves (overwrite with expected_mtime)? No real-server test observed; web editor uses `fs:put_save` (no mtime guard).
- Should Rust `encrypt_envelope` be the JNI source of truth (plan lists `crypto-bridge/src/lib.rs`) or Kotlin JCE? Need decision to drop the duplicate.
- Server has no upload-abort message; accept 8-slot leak until reconnect, or add backend contract (needs compat review per plan)?

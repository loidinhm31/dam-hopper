# Code Review (Cycle 2) — Phase 11: Encrypted transfers, media, Android storage

Date: 2026-10-16 | Reviewer: Phase11ReviewerCycle2 | Plan: `plans/261015-1647-android-native-app/phase-11-encrypted-transfers-media-and-storage.md` | Prior: `code-reviewer-261016-1034-phase-11-encrypted-transfers-media-storage.md` (4/10)

## Verdict
**Score: 5/10 — changes still required. Not "Phase 11 done".**
Real fixes landed (cookie name, UUIDv4, off-main video init, streaming plain upload, envelope-size cap, Volatile, Unicode sanitize, JNI exports). But 4 of 10 remediation claims are overstated vs code, and Android media/SAF/crypto-session remain unreachable from production. No device/server evidence.

## Remediation claim check
| # | Claim | Code reality |
|---|---|---|
| 1 cookie name | TRUE (`AndroidMediaClient.kt:42-44`, matches `server/src/fs/media_session.rs:11`). But capture still `cookie.contains(name)` + nullable result (l.107-109,173-175) → not fail-closed |
| 2 UUIDv4 | TRUE `generateMediaClientId/assertValidMediaClientId`; but `generateMediaClientId` has **zero callers**, no per-profile persistence |
| 3 no main-thread I/O | PARTLY. `AndroidVideoSurface` init now IO + HEAD. BUT `readRangeSync` (l.251-276) still `body.bytes()` for 200 AND 206 → whole body into RAM when server ignores Range / returns more than `length`. "200 vs 206 bounds safe" only bounds the *copy*, not the read. `copyInto` size guard OK |
| 4 JNI | Exports exist+compile; Rust tests pass. **Zero callers** of `OpaqueClientBridge.encryptEnvelope/decryptEnvelope`; `CryptoSession` uses Kotlin `CryptoEnvelope` → JNI path dead + silent Kotlin fallback = two implementations |
| 5 CryptoSessionManager wired | HALF. Provider wired in `WorkbenchScreen.kt:168`, but `CryptoSessionManager.setSession` has **no caller** → provider always null → "none available". `encryptedRequested=true` passed by **no** caller either |
| 6 uploadPlainStream | TRUE (bounded 64 KiB chunks). No production caller of `uploadPlain/Stream` (SAF `streamFromUri` not connected) |
| 7 cap | TRUE for envelope size (`TransferCoordinator.kt:249`) returning Error. **No test** for cap boundary (grep: none) |
| 8 owner fences | NOT TRUE in prod. `EditorRepository.kt:68,113` calls coordinator without `expectedOwner`; `FileRepository.uploadPlain/Encrypted` have no owner param; `TransferCoordinator` skips WS owner assert when `expectedOwner==null`; `getActiveSession(currentConn)` fails open when `currentConn==null`; `MediaLease.assertValidOwner(null)` no-op. `@Volatile` added OK |
| 9 Unicode sanitize | TRUE, but `..` → `_` mid-name mangles `a..b`; bare `.` passes through; no length cap |
| 10 tests | Present, see Validation. No tests for: cap boundary, 200-without-Range, cookie absent/fail-closed, chunk timeout/UnknownOutcome, cancellation, ack disorder, redirect/leak, JNI from Kotlin |

## Critical issues
1. **Encrypted save unreachable end-to-end.** No code builds a `CryptoSession` from OPAQUE login (`setSession` 0 callers); no UI/tab path sets `encryptedRequested=true`. Plan Todo 2 + success criterion "server accepts native encrypted output" unmet. Fix: on OPAQUE login finish (`OpaqueLoginFinishResult.aesKey`) → `CryptoSession(sessionId, ownerRef, key)` → `manager.setSession`; zero source array; make `cryptoSessionProvider` `suspend` (drop `runBlocking` at `WorkbenchScreen.kt:169` — blocks caller thread, commonMain-JVM-only API); wire editor encryption toggle.
2. **Media/SAF stack has no production consumer.** `AndroidMediaClient`, `AndroidVideoSurface`, `LeaseMediaDataSource`, `AndroidDocumentStorage` (all), `MediaPreviewCard.onDownloadClicked` (`EditorScreens.kt:151` passes none), `generateMediaClientId` — declarations only. No SAF picker/ActivityResult, no ticket issue/revoke lifecycle, no image renderer at all. `MediaPreviewCard` text now says "Origin-bound media session… Protected ticket streaming" while it renders no media → misleading UI. Plan steps 5-7 unmet.
3. **`readRangeSync` unbounded read** (`AndroidMediaClient.kt:263-275`): `response.body.bytes()` buffers whole body for 200 (server ignoring Range, hostile/misconfigured) and for 206 larger than requested; large video → OOM. Fix: 206 → `body.source().readByteArray(min(length, body.contentLength()))`; 200 → only if `start==0`, else skip/throw; also validate `Content-Range` start==requested start.
4. **Owner/generation fence fail-open in prod path** (see claim 8). Make `expectedOwner: ConnectionRef` non-null in `TransferCoordinator.upload*`, `EncryptedSaveCoordinator.*`, `FileRepository.upload*`, `getActiveSession`, `MediaLease.assertValidOwner`; EditorRepository must pass `registry.getCurrentConnection(profileId)` and fail if null. Re-assert owner immediately before commit (after encrypt).
5. **No runtime acceptance evidence** (plan Todo 3, success criteria: "Compilation/tests alone do not satisfy native-surface acceptance"). No APK/server interop, tamper, media seek, two-profile cookie isolation record.

## Warnings
- Cookie capture not fail-closed: absent/mismatched cookie → `cookieHeader=null` → later opaque 403/404. Throw `MediaException` at issue time; match exact `name=` prefix, not `contains`. Check response `authorizationMode == "session-cookie-v2"` and `purpose` echo; reject expired `expiresAt`.
- `MediaLease` is a `data class` → `toString()` prints ticket + cookie. Redact. `assertSameOrigin` message embeds full stream URL (ticket); port compare `-1` vs `443` false-rejects; `URI(serverBaseUrl)` throws raw exception.
- `fetchImageBytes` unbounded `bytes()`; `downloadMediaStream`/all `execute()` ignore coroutine cancellation (OkHttp `Call` not cancelled; no `isActive` check in loop); no truncation vs Content-Length check; no 404/410 stale re-ticket; no ticket/session revoke on dispose/profile switch (`revoke*` 0 callers).
- `AndroidVideoSurface`: `require(purpose==PLAYBACK)` in composable crashes UI; `MediaPlayer` created in `LaunchedEffect` but release only via `DisposableEffect` reading `mediaPlayer` (race: disposed before assigned/after IO finished → leak); `surfaceCreated` before `mediaPlayer` set → no display; `LeaseMediaDataSource.close` no-op; no revoke on dispose; `onDownloadRequested` unused.
- `TransferCoordinator.uploadPlainStream`: sent bytes never compared to declared `totalBytes` before commit (server rejects but wastes round trip); chunkProvider (SAF I/O) exceptions escape as thrown, not `TransferResult.Error`; after first chunk error provider keeps reading the rest of source; `uploadEncrypted` encrypts before cheap `content.size` pre-check (allocates ~100 MiB + extra for nothing); `cryptoSession.encrypt` can throw `CryptoSessionClosedException` outside try (both `uploadEncrypted` and `forceOverwriteEncrypted`).
- Cancel/timeout leaks server `enc_uploads` slot (cap 8/connection; no abort frame in protocol); chunk errors silent server-side → 60 s wait per failure. Document/accept or add backend contract (needs compat review).
- UnknownOutcome reconciliation (plan step 4) absent: disconnect after commit send reports `Error`, not `UnknownOutcome`; nothing stats/compares mtime.
- `forceOverwriteEncrypted` → `fs:put_save` (no mtime guard, path not normalised vs `saveEncrypted`) — ensure UI makes unconditional overwrite explicit.
- `AndroidDocumentStorage`: `streamToUri` opens `"wt"` and leaves truncated partial file on failure (plan step 5 partial cleanup); `streamFromUri` no declared-size check vs `queryMetadata().size`, `chunk.copyOf()` per chunk redundant; `readBytes` = 2× buffer (dead API; delete); exceptions embed URI.
- Rust JNI: key/plaintext/content in plain `Vec` (no `Zeroizing`), `encrypt_envelope` doesn't enforce `METADATA_MAX`; `use aes_gcm…` mid-file. Kotlin: `CryptoSession` ctor copies key, caller array not zeroed; JVM zeroisation limits not documented (plan Security Considerations).
- Test script `tests/test-phase-11-*.sh` (84 assertions) is grep-presence only; passes while code is unwired. Media test fabricates responses with interceptor; `nextReqId = { 100uL }` constants hide id collisions.

## Suggestions (YAGNI/KISS/DRY)
- Pick ONE envelope implementation: delete JNI exports + `OpaqueClientBridge.encrypt/decryptEnvelope` (dead, duplicate of Kotlin `CryptoEnvelope`) or route `PlatformCrypto` through JNI and delete Kotlin. `PlatformCrypto.deriveHkdfSha256` still unused in prod.
- `TransferCoordinator`: `uploadPlainStream` vs `uploadEncrypted` still duplicate begin/chunk/commit; extract shared helper. Drop unused `overwrite` param (no wire field). `FileRepository` and `EditorRepository` each own a `TransferCoordinator` → inject one.
- `AndroidMediaClient`: merge `issueImage/VideoTicket`, `revokeImage/VideoTicket`, and cookie extraction (3 copies).
- `WsConnection` widened to `open` (5 members) only for fakes → extract `WsTransport` interface.
- `MediaPurpose` `@SerialName` without `@Serializable`; `IssueVideoTicketRequest.purpose` raw `String`.
- FQNs inline in `EditorRepository`/`FileRepository`/`WorkbenchScreen` → imports.

## Positive
- Cookie constant, UUIDv4 validation, redirect disable, same-origin assert on every call.
- Envelope wire format matches server (`decrypt.rs`) + web; Rust tamper/wrong-key/truncation/metadata tests.
- Atomic header+binary pairing, ack listeners registered `UNDISPATCHED`, UnknownOutcome on in-flight commit timeout, `@Volatile` closed flag, envelope-size cap returns `Error` not throw.
- Video init off main; HEAD-first size; EOF=-1 contract; Zero-FAB invariant held.

## Validation (observed this cycle)
| Command | Result |
|---|---|
| `bash tests/test-phase-11-encrypted-transfers-media.sh` | PASS 84/84 (static grep) |
| `pnpm native-app:test` (`:shared:jvmTest`) | BUILD SUCCESSFUL (tasks UP-TO-DATE; cached run, not re-executed) |
| `pnpm native-app:test:android` (`testDebugUnitTest`) | BUILD SUCCESSFUL (UP-TO-DATE; cached) |
| `cargo test --offline` (native-app/crypto-bridge) | PASS 7/7 |
| `assembleDebug`, APK/device, real-server interop | NOT run (no evidence exists) |

## Plan status
Todo 1 state machines: mostly done. Todo 2 integrate editor/SAF/media: NOT done (editor half-wired, SAF/media unwired). Todo 3 real APK/server proof: NOT done. Todo 4 ledger/docs: NOT done. Review status: changes requested (5/10).

## Recommended actions
1. Create+install `CryptoSession` on OPAQUE login; suspend provider; editor encrypt toggle; non-null owner everywhere.
2. Fix `readRangeSync` bounded read; fail-closed cookie capture; redact `MediaLease`.
3. Wire SAF picker → `streamFromUri` → `uploadPlainStream`; media lease lifecycle (issue/dispose revoke/profile switch) + image renderer; download via `streamToUri` with partial cleanup.
4. Add tests: cap boundary, 200-without-Range, cookie absent, timeout/UnknownOutcome, cancellation, redirect, two-profile isolation; record real server/APK evidence per `execution-guide.md`.
5. De-duplicate (envelope, coordinator loops, media client); delete dead API.

## Unresolved questions
- Is cookie-less ticket-only fallback expected for native (needs allowed Origin in server config)? Cookie capture should remain mandatory.
- Server `put_begin` + `expected_mtime` accepted for existing target (code path `ws.rs:1892,1957` suggests yes) — unverified against real server.
- JNI vs Kotlin JCE as envelope source of truth? Decision needed to drop duplicate.
- Server has no upload-abort frame: accept 8-slot leak until reconnect or add backend contract?
- Is `fs:put_begin` filename/dir path validated against metadata `name` server-side (editor path normalisation `\` → `/`)?

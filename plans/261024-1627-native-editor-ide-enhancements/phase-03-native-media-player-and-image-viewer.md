# Phase 03 — Native Media Player and Image Viewer

## Context and Goals
- **Objective:** Replace static placeholder media cards with real, interactive image and video viewers inside editor tabs using `AndroidMediaClient` ticketed streaming and hardened `AndroidVideoSurface`.
- **Authority:** [Plan](plan.md) | [Media Research Report](../reports/research-261024-1627-preview-sidebar-ux.md)
- **Target Files:**
  - Create: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaSurfaceHost.kt`
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidImageSurface.kt`
  - Create: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaSurfaceHost.kt`
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt`
  - Modify: `native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt`
  - Modify: `native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClientTest.kt`
  - Modify: `native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt`

---

## Detailed Implementation Tasks

### 1. Common Media Surface Host Contract
In `MediaSurfaceHost.kt` (`commonMain`):
- Define:
  ```kotlin
  typealias NativeMediaSurfaceHost = @Composable (
      tab: EditorTab,
      isImage: Boolean,
      modifier: Modifier,
      onDownloadClicked: (() -> Unit)?
  ) -> Unit

  val LocalNativeMediaSurfaceHost = compositionLocalOf<NativeMediaSurfaceHost?> { null }
  ```

### 2. Client Security and Generation Fencing in AndroidMediaClient
In `AndroidMediaClient.kt`:
- **Thread-Safe Owner-Scoped Call Tracking & Retirement:**
  ```kotlin
  private val activeCallsLock = Any()
  private val activeCalls = HashMap<ConnectionRef, MutableSet<Call>>()

  private fun registerCall(ownerRef: ConnectionRef, call: Call) = synchronized(activeCallsLock) {
      require(!ownerRef.isRetired) { "Cannot register call for retired connection ${ownerRef.key}" }
      activeCalls.getOrPut(ownerRef) { mutableSetOf() }.add(call)
  }

  fun cancelOwnerCalls(ownerRef: ConnectionRef) {
      val callsToCancel = synchronized(activeCallsLock) { activeCalls.remove(ownerRef) }
      callsToCancel?.forEach { runCatching { it.cancel() } }
  }
  ```
  Check owner validity before request and after response: `ownerRef.matches(activeOwnerSupplier()) && !ownerRef.isRetired`. On mismatch, drop response and throw `MediaException("Stale response for retired connection")`.
- **Strict Range & Interval Validation in `readRangeSync`:**
  - HTTP status MUST be `206 Partial Content`. Reject `200 OK` or any other non-206 status on Range requests with `MediaException("Expected HTTP 206, got ${response.code}")`.
  - Validate `Content-Range`: MUST match pattern `bytes (\d+)-(\d+)/(\d+)`.
  - Interval Check: Require `returnedStart == requestedStart` and `returnedEnd <= requestedStart + requestedLength - 1`. Body length MUST equal `returnedEnd - returnedStart + 1`.
  - EOF Handling: If server returns `416 Range Not Satisfiable` with `Content-Range: bytes */total` where `requestedStart >= totalLength`, return EOF. In `LeaseMediaDataSource.readAt(position, buffer, offset, size)`, return `-1` when at or past EOF (standard `MediaDataSource` EOF protocol).
  - On cache hit in `LeaseMediaDataSource`: also verify `ownerRef.matches(activeOwnerSupplier()) && !ownerRef.isRetired`.
- **Streaming Read Cap:** In `fetchImageBytes`, replace unbounded `body.bytes()` with a bounded streaming read (abort immediately when > 32 MiB).
- **Token Redaction:** In `MediaLease.toString()`, ensure `streamPath` tokens and query parameters are redacted.

### 3. Hardened Video Playback in AndroidVideoSurface
In `AndroidVideoSurface.kt`:
- **Fix Surface/Player Race:** Bind surface and player in a single unified `bind()` function that fires whenever either `player` or `surfaceHolder` changes, handling both arrival orders cleanly without leaving audio-only playback.
- **Bounded LRU Block Cache:** In `LeaseMediaDataSource`, introduce an aligned 2 MiB bounded LRU block cache (8 blocks x 256 KiB) to eliminate small-read HTTP request thrashing from `MediaPlayer`.
- **Aspect Ratio:** Listen to `setOnVideoSizeChangedListener` and apply `Modifier.aspectRatio(videoWidth.toFloat() / videoHeight)` to prevent stretching.
- **Seek Slider Throttling:** Seek only on slider `onValueChangeFinished` rather than on every fractional drag movement.
- **Bounded Expiry Recovery:** On HTTP 401/403/410, attempt a single retry by requesting a fresh video ticket via `client.issueVideoTicket`.
- **Separate Pause Triggers:**
  - Tab disposal: `DisposableEffect(tab.key)` pauses player in `onDispose` when tab is closed or switched away.
  - Lifecycle: Observe `Lifecycle.Event.ON_STOP` via `LocalLifecycleOwner` to pause playback when app is backgrounded.
- **Synchronous Player Release with Non-Blocking Revocation:** In `finally` or `onDispose`, ALWAYS release `localPlayer.release()` immediately and synchronously. Dispatch ticket revocation via an application cleanup coroutine scope (`appScope.launch(NonCancellable) { withTimeoutOrNull(3000) { client.revokeVideoTicket(...) } }`) so network delays or failures can never block local player release.

### 4. Native Image Viewer in AndroidImageSurface
In `AndroidImageSurface.kt`:
- Call `client.issueImageTicket(...)` and fetch bytes with the 32 MiB streaming cap.
- Decode `Bitmap` using `BitmapFactory` on `Dispatchers.Default`:
  - Check dimensions before full allocation; enforce a 50 MP max pixel limit.
  - Apply `inSampleSize` downsampling for images exceeding 4096px.
- Display using Compose `Image(bitmap.asImageBitmap(), contentScale = ContentScale.Fit)`.
- Support pan and pinch-zoom using `Modifier.transformable(canPan = { scale > 1f })` with offset clamping to fitted image bounds.
- Provide zoom controls (`+`, `-`, `Reset`) and handle SVG/unsupported images with a friendly fallback card.
- Release resources synchronously on disposal and revoke image ticket in background scope.

### 5. Provide AndroidMediaSurfaceHost
In `AndroidMediaSurfaceHost.kt`:
- Provide the Android implementation linking `AndroidImageSurface` for `FileTier.IMAGE` and `AndroidVideoSurface` for `FileTier.VIDEO`.

### 6. Verification & Unit Tests
In `AndroidMediaClientTest.kt`:
- Test owner retirement before request and after response.
- Test synchronized owner call cancellation without affecting unrelated connections.
- Test rejection of `200 OK` on Range requests, malformed `Content-Range`, `returnedStart != requestedStart`, and body length mismatch.
- Test EOF block handling returning `-1` in `LeaseMediaDataSource.readAt`.
- Test 32 MiB streaming read cap abort behavior.
- Test surface and player arrival in both orders (`player` first, then `surface`; and `surface` first, then `player`).
- Test synchronous player release on tab disposal.

---

## Durable Tasks
```evcrate-tasks
[
  {
    "id": "implement-native-media-player-and-image-viewer",
    "title": "Implement hardened AndroidVideoSurface, AndroidImageSurface, and AndroidMediaClient generation fencing",
    "blocked_by": [],
    "allowed_files": [
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaSurfaceHost.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidImageSurface.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaSurfaceHost.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClient.kt",
      "native-app/androidApp/src/main/kotlin/dev/damhopper/nativeapp/platform/media/AndroidVideoSurface.kt",
      "native-app/androidApp/src/test/kotlin/dev/damhopper/nativeapp/platform/media/AndroidMediaClientTest.kt",
      "native-app/shared/src/commonMain/kotlin/dev/damhopper/nativeapp/features/media/MediaModels.kt"
    ],
    "constraints": [
      "MediaLease.assertValidOwner must check connection-scoped owner supplier before and after network operations; cancel only owner-scoped calls synchronously and clear cache on retirement.",
      "readRangeSync must validate HTTP 206, Content-Range presence, returnedStart == requestedStart, and returnedEnd <= requested interval; return -1 at EOF.",
      "Image streaming read must cap at 32 MiB; image decoding must cap at 50 MP and use inSampleSize downsampling.",
      "Video surface must eliminate surface/player creation race in both arrival orders, preserve aspect ratio, use 2 MiB LRU block cache, throttle range seeking, pause on tab disposal and ON_STOP, and synchronously release player with background non-blocking revocation."
    ],
    "acceptance": [
      "MediaClient throws MediaException on generation mismatch, retired connection, HTTP 200 on range offset, or mismatched Content-Range intervals.",
      "Retirement cancels only the affected owner's calls without canceling unrelated profile traffic.",
      "Images load and display with pan/pinch-zoom within fitted bounds without exceeding 50 MP decode limit.",
      "Video plays with correct aspect ratio and inline controls without HTTP range request thrashing.",
      "Player cleanup synchronously releases MediaPlayer even if ticket revocation fails or times out."
    ],
    "verification": [
      "Run ./gradlew.bat :androidApp:testDebugUnitTest --tests dev.damhopper.nativeapp.platform.media.AndroidMediaClientTest",
      "Verify clean compilation of :androidApp:compileDebugKotlin"
    ]
  }
]
```

- [ ] <!-- evcrate-task:implement-native-media-player-and-image-viewer --> Implement hardened AndroidVideoSurface, AndroidImageSurface, and AndroidMediaClient generation fencing (Completed 2026-10-24; 32/32 AndroidMediaClientTest passing)

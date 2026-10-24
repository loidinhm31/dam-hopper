# Research: Rich Previews (HTML/Image/Video) + Left File-Tree Sidebar — Android native-app

**Date:** 2026-10-24 · **Scope:** `native-app/` (KMP, CMP plugin 1.7.3 ⇒ Jetpack Compose 1.7.x / M3 1.3.x, targetSdk 35, minSdk 29) · Companion to `research-261024-1627-editor-ide-enhancements.md`.
**Status:** research only — repo code read + API docs checked; no build, test, or device validation performed.

## 0. Blocking finding — WebView is a tested project invariant
- `WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication` fails on any `android.webkit.WebView` / `androidx.webkit` string in `shared/src/commonMain/kotlin` or `androidApp/src/main/kotlin`. Also `SimpleFlowJourneysTest`, `ManifestSecurityTest`, per-feature `*Phase1xTest`, README l.14/161 ("does not contain or run a browser engine, WebView"), KDoc `ProjectWorkspaceScreen.kt:71`.
- ⇒ Sibling report §2.2/§4 ("sandboxed WebView") **violates B01/B02**. Default to native rendering; WebView only with owner sign-off + test/README update.

## 1. HTML preview
**Recommended (no new deps, invariant-safe):** `AnnotatedString.fromHtml(html, linkStyles, linkInteractionListener)` — `androidx.compose.ui.text`, added 1.7.0, **android-only** (not Cmn) ⇒ androidApp host (or `shared/androidMain`) injected like `LocalNativeEditorSurfaceHost`; common fallback = source view.
- Backed by `android.text.Html` tag set (b/i/u/s/sup/sub/font/span color/a/p/div/br/h1-6/blockquote/ul/li). No CSS layout, tables, forms, JS. `<img>` → placeholder (no ImageGetter ⇒ no fetch). Label "Reader preview", not "browser". Security comes from the renderer having no script engine/network, **not** from input cleanup.
- **Must** pass a `LinkInteractionListener` (no-op or confirm dialog) — default `null` opens links via `LocalUriHandler` (external intent).
- Reader cleanup (cosmetic only): [INFERENCE] `<script>/<style>` text may render as text; if seen on device, drop those elements with a real parser (e.g. `XmlPullParser`-based pass), not regex.
- Perf: parse off-main (`produceState` + `Dispatchers.Default`) keyed `(tabKey, revision)`; cap input (~256 KiB) else "too large, view source". One `SelectionContainer { Text }` in `verticalScroll`; don't split HTML naively (breaks nesting).
- Text source: read from the retained document authority (`AndroidEditorDocument` content) at toggle time — don't mutate `tab.content` (save/CAS ownership not analysed here).

**If WebView approved (alt.)** — `AndroidView(factory = { WebView(ctx) }, onRelease = { it.destroy() })`, one instance max:
- `javaScriptEnabled=false`, `allowFileAccess=false` (default false since targetSdk 30), **`allowContentAccess=false` (default true)**, `domStorageEnabled=false`, `setGeolocationEnabled(false)`, `setSupportMultipleWindows(false)`, `safeBrowsingEnabled=true`; no `addJavascriptInterface`; `WebChromeClient.onPermissionRequest → deny()`; no `DownloadListener`.
- Navigation: `shouldOverrideUrlLoading → true` (deny all). Resources: `WebViewAssetLoader` on isolated origin (`https://appassets.androidplatform.net/`) with narrow handler (e.g. app-bundled preview CSS only); `shouldInterceptRequest` returns loader result, else empty 403-like response for **unhandled** requests only (blanket empty response would also block approved assets). `onRenderProcessGone → true` + drop view.
- Load: `loadDataWithBaseURL("https://appassets.androidplatform.net/", html, "text/html", "utf-8", null)`; never `file://`. JS-off alone is not a sandbox — all of the above together.
- Dark: targetSdk ≥33 ⇒ algorithmic darkening; on API 29–32 needs `WebSettingsCompat.setAlgorithmicDarkeningAllowed` behind `WebViewFeature.isFeatureSupported(ALGORITHMIC_DARKENING)` (`androidx.webkit` — also banned by test). Pages with `prefers-color-scheme` follow app theme.
- Cost: tens of MB + renderer process; destroy on tab switch.

## 2. Media preview (image + video)
**Wiring:** `shared/commonMain` can't see `AndroidMediaClient` (androidApp). Add `NativeMediaSurfaceHost` typealias + `LocalNativeMediaSurfaceHost` (mirror `NativeTextEditorView.kt:19`), provided in `MainActivity` beside the editor host; `EditorScreens.kt:202` calls host, else `MediaPreviewCard` fallback.

### 2.1 Image (`AndroidImageSurface`)
- Flow: `issueImageTicket` → fetch → decode → `revokeImageTicket` in `finally`. `LaunchedEffect(tab.key)`; ignore results if key changed.
- **Gap:** `fetchImageBytes` (`AndroidMediaClient.kt:218`) does unbounded `body.bytes()`. Replace with bounded streaming read (abort when > cap, e.g. 32 MiB) regardless of `Content-Length` (may be absent/wrong); no unbounded fallback.
- Decode: `ImageDecoder.createSource(ByteBuffer.wrap(bytes))`, `decodeBitmap { d, info, _ -> … }` — check `info.size` first; reject if pixels > limit (e.g. 50 MP); `setTargetSampleSize(n)` so long edge ≤ ~2× view px and ≤4096 (Canvas throws on very large bitmaps). `Dispatchers.Default`.
- Formats are decoder/device-dependent: png/jpg/gif/webp/bmp generally OK; ico/avif vary (AVIF platform support from API 31) ⇒ catch `DecodeException` → placeholder. **SVG has no platform decoder** (`FileTierPolicy.kt:36` classes it IMAGE) ⇒ route to text editor or placeholder. Animated gif/webp: first frame (YAGNI `AnimatedImageDrawable`).
- Zoom/pan: `Image(bmp.asImageBitmap(), contentScale = Fit)` in `Box(Modifier.clipToBounds().onSizeChanged{…}.transformable(state, canPan = { scale > 1f }))` (`canPan` overload since foundation 1.6, Cmn) + `graphicsLayer { scaleX/Y, translationX/Y }`. `canPan` at scale 1 keeps horizontal swipes for the tab bar/sidebar. `scale ∈ [1, 8]`. Clamp offset against **fitted image size** (not viewport): `maxX = max(0, (fitted.w*scale - viewport.w)/2)`, same for Y. Double-tap → `animateZoomBy(2.5f)` / reset. Reset on tab change.

### 2.2 Video (`AndroidVideoSurface` exists, zero callers) — fix before wiring
1. **Player/surface race:** `setDisplay` only in `surfaceCreated` (l.137); either object can arrive first ⇒ possible audio-only. Hold both refs in state; bind in one `bind()` called whenever player **or** surface changes (incl. new player after ticket renewal); `setDisplay(null)` on surface destroy. `AndroidExternalSurface` (foundation 1.6+) is cleaner but still needs this bind logic.
2. **Ownership:** each `LaunchedEffect(lease.ticket)` owns its own `MediaPlayer` local; release that exact instance in `try/finally`/`awaitCancellation` (current dispose releases whatever is in shared state). Listener callbacks check `player === current` to drop stale events.
3. **Aspect ratio:** `setOnVideoSizeChangedListener` → `Modifier.aspectRatio(w/h)` (currently stretched).
4. **Range thrash:** `LeaseMediaDataSource.readAt` = one HTTP range request per call; MediaPlayer does many small reads. Add aligned block cache (256 KiB, LRU 4–8 ⇒ ≤2 MiB). `readRangeSync` 200-fallback skips the whole prefix ⇒ treat `200` with `start>0` as error.
5. **Pause triggers:** tab inactive (composable leaves), sidebar overlay not required; `Lifecycle.Event.ON_STOP` via `LocalLifecycleOwner`. Optionally keep last position per tab key → `seekTo` on remount.
6. **Tickets:** revoke on dispose; on HTTP 401/403/410 mid-stream (expiry/revocation) surface "Session expired — Retry" that issues a new lease (`issueVideoTicket`) and rebinds; no silent loops.
7. Slider: seek on `onValueChangeFinished` only (each `onValueChange` floods range requests).
- Container/codec support is device-dependent (mp4/H.264 broadly; webm VP8/9, mkv usually; mov partial; ogg/Theora video generally not) ⇒ map `MediaPlayer` errors to friendly message. Media3 ExoPlayer only if needed later.
- SurfaceView composites on its own layer; Compose overlay/scrim draws above it. Avoid `graphicsLayer` alpha/scale on it (`AndroidEmbeddedExternalSurface`/TextureView if required).

## 3. Left file-tree sidebar
### 3.1 Pattern
| Width (`BoxWithConstraints.maxWidth`) | Mode | Behaviour |
|---|---|---|
| ≥ 600 dp (tablet, most phone-landscape) | **Pinned split** | `Row { Sidebar(w); VerticalDivider; Editor(weight 1f) }`; toggle collapses |
| < 600 dp | **Overlay** | Editor full width; sidebar slides over (≈85% width, max 320 dp) + scrim |
Sidebar width = `(maxWidth * 0.3f).coerceIn(240.dp, 320.dp)`. Drag-resize: YAGNI.

### 3.2 Avoid swapping `ModalNavigationDrawer` ↔ `PermanentNavigationDrawer`
Changing the wrapper on breakpoint change re-parents the editor ⇒ `AndroidView.onRelease` → `detachEditor` → new `CodeEditor` + `restoreViewState` (loses IME composition/focus). Use one stable tree (pseudocode):
```kotlin
BoxWithConstraints(Modifier.fillMaxSize()) {
  val pinned = maxWidth >= 600.dp
  Row(Modifier.fillMaxSize()) {
    if (pinned && open) { Sidebar(Modifier.width(w)); VerticalDivider() }   // own group
    EditorPanelScreen(tabsState = …, modifier = Modifier.weight(1f))       // same slot always
  }
  if (!pinned) {
    AnimatedVisibility(open, enter = fadeIn(), exit = fadeOut()) { Scrim(onClick = close) }
    AnimatedVisibility(open, enter = slideInHorizontally { -it }, exit = slideOutHorizontally { -it }) {
      Sidebar(Modifier.width(w).fillMaxHeight())
    }
  }
}
```
`if` blocks are their own groups ⇒ the editor keeps slot identity across open/close/rotate. If structure must differ, wrap editor in `remember { movableContentOf { … } }`.

### 3.3 State
- `isFileTreeSidebarOpen: StateFlow<Boolean>` in `ProjectWorkspaceState` (ViewModel-retained; `configChanges` covers rotation). Default open when pinned, closed when overlay.
- Tree expansion lives in `FileTreeState`; hoist sidebar `LazyListState` into workspace state so close/reopen keeps scroll. `LazyColumn` with `key = path`.
- Reuse `FocusedFilesExplorerScreen(onOpenFile = …)` (`FileScreens.kt:41`) with a `compact` param to hide its header — don't fork.
- `onOpenFile` = `openTab(target, path)` (+ close only in overlay mode). **Don't** `selectPanel(...)` — `when(activePanel)` at `ProjectWorkspaceScreen.kt:199` unmounts the editor on panel change; sidebar lives inside the EDITOR branch.
- Toggle: inline "☰ Files" in `EditorTopBar` (zero-FAB invariant). No edge-swipe (conflicts with Sora horizontal scroll + system back gesture).

### 3.4 IME / insets / focus / back
- Insets: root `DamHopperMobileApp.kt:185` applies `safeDrawingPadding()` (includes `ime`), consumed downstream. Android 15 + targetSdk 35 forces edge-to-edge, so IME avoidance relies on insets; on older APIs `adjustResize` + decor-fit behaviour applies. Rule: **one inset owner** (root); child `imePadding()` is harmless only if insets are consumed — verify on API 29/34/35 rather than assume. Sidebar list scrollable so a filter field stays reachable above IME.
- Keyboard on overlay open: explicit UX choice. Recommended: hide IME (overlay is navigation); if a sidebar filter field takes focus, IME stays and root insets keep it above.
- Modal focus (overlay): `focusGroup()` only groups traversal, it does **not** trap. Required: (a) background editor subtree `Modifier.focusProperties { canFocus = false }` + `semantics { invisibleToUser() }`/clear-and-set to hide from TalkBack while open; (b) native `CodeEditor`: `clearFocus()`, `hideSoftInput()`, temporarily non-editable/non-focusable via `AndroidEditorDocument` (pattern at `AndroidEditorSurface.kt:46`) so hardware keys can't edit the hidden buffer; (c) `FocusRequester` on first row on open; (d) restore prior focus owner on close. Scrim consumes pointer events.
- Back/Esc: CMP 1.7 lacks common `BackHandler`; `MainActivity.kt:48` routes all back to `flowNavigation.handleBackPress()`. Add an overlay-consume hook checked first (mirror `departureGuard`, `AppFlowNavigation.kt:33`); `onPreviewKeyEvent(Key.Escape)` on sidebar.
- Rotation pinned↔overlay while open: keep `open`; editor never remounts.

## 4. Deps / licensing
No new deps required; all APIs are platform/androidx. Sora 0.23.4 usage unchanged. Optional later (Apache-2.0): Media3, AndroidSVG — not recommended now.

## 5. Validation to run (by implementer)
- JVM: breakpoint→mode, sidebar state, overlay back-consume, bounded image read, sample-size/pixel-limit calc, pan clamp math, block-cache range math.
- Static: WebView ban test stays green.
- Emulator API 29/34/35, phone portrait/landscape + tablet: open from sidebar keeps editor undo/selection (no `detachEditor`), IME + overlay, Tab/Shift-Tab + hardware typing + TalkBack + Back/Esc with overlay open, video picture + seek + ticket expiry retry, image pinch/double-tap/letterbox bounds, svg/avif/ogg fallbacks.

## Sources
- fromHtml: https://developer.android.com/reference/kotlin/androidx/compose/ui/text/AnnotatedString.Companion
- transformable(canPan): https://developer.android.com/reference/kotlin/androidx/compose/foundation/gestures/transformable.modifier
- Surface types (SurfaceView vs TextureView, `AndroidExternalSurface`): https://developer.android.com/media/media3/ui/surface
- M3 drawers: https://developer.android.com/develop/ui/compose/components/drawer
- WebViewAssetLoader: https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader
- WebSettings: https://developer.android.com/reference/android/webkit/WebSettings
- ImageDecoder: https://developer.android.com/reference/android/graphics/ImageDecoder
- Repo: files/lines cited inline.

## Unresolved questions
1. Lift WebView ban for HTML (test/README change) or accept `fromHtml` reader-grade fidelity?
2. Pinned breakpoint 600 vs 840 dp for phone landscape (~730–915 dp wide, ~400 dp tall)?
3. Persist video position / image zoom across tab switches (tab-state field) or reset?
4. Image byte cap / pixel cap values — does server already limit?
5. Explicit `enableEdgeToEdge()` in `MainActivity` to unify IME behaviour across API 29–34 vs 35+?

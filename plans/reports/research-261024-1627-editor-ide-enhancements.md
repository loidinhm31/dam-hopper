# Research & Preflight: Native Editor IDE Enhancements, Previews & Sidebar

**Date:** 2026-10-24  
**Scope:** Android Native App (`native-app`) — Editor language support, decorators, markdown/html previews, media playback, left file tree sidebar.

---

## 1. Executive Summary & Findings

The current Android editor in `native-app` is functionally integrated with retained document ownership and CAS saves, but visually and ergonomically behaves as a monochrome text container:
1. **Language Highlighting:** Only `.java` has syntax tokens (`JavaLanguage`); all other languages use `EmptyLanguage()` (plain text). No dark theme is set on Sora `CodeEditor` (defaults to unstyled light theme).
2. **Visual Aids:** Decorators are partly enabled by default in Sora (`isLineNumberEnabled = true`, `isHighlightCurrentLine = true`, `isHighlightBracketPair = true`, `isBlockLineEnabled = true`), but because `EmptyLanguage` produces zero token analysis or `CodeBlock` structures, bracket matching and indent guide lines render nothing. `setPinLineNumber(true)` is not set.
3. **Markdown Preview:** `MarkdownPreviewView` exists in Compose, but the toggle button is suppressed in focused mode via `!focusedMode` in `EditorTopBar.kt`.
4. **HTML Preview:** Not implemented; `FileTierPolicy.isHtmlFile()` exists but has no preview renderer.
5. **Zero-WebView Invariant (Critical):** `WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication` and project policy strictly forbid any `WebView` or `androidx.webkit` imports. Any HTML preview MUST use a native Compose renderer (`AnnotatedString.fromHtml`).
6. **Image & Video:** `FileTier.IMAGE` and `VIDEO` render a static placeholder card (`MediaPreviewCard.kt`). `AndroidVideoSurface` (MediaPlayer) and `AndroidMediaClient` (ticketed streaming) exist in `platform/media/` but have zero callers in `EditorScreens.kt` and have identified lifecycle/range-thrashing defects.
7. **Workspace Layout:** In `ProjectWorkspaceScreen.kt`, `WorkspacePanel.EDITOR` displays only `EditorPanelScreen`. Accessing the file tree requires leaving the editor to view `FocusedFilesExplorerScreen` full-screen.

---

## 2. Technical Decisions & Architectures

### 2.1 Language Tokenizer & Dark Theme (Sora Editor 0.23.4)
- **Palette & Decorators:** Apply `SchemeDarcula` from `io.github.rosemoe.sora.widget.schemes.*`. Explicitly enable `setPinLineNumber(true)`.
- **Lexers:** Create `UniversalLanguage` extending `AsyncIncrementalAnalyzeManager`. Implement keyword, delimiter, string, comment, and number scanning for:
  - C-Family: Kotlin (`.kt`, `.kts`), Java (`.java`), JavaScript / TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`), Rust (`.rs`).
  - Hash-Comment Family: Python (`.py`), Shell (`.sh`, `.bash`, `.zsh`), TOML (`.toml`), YAML (`.yaml`, `.yml`), Dockerfile (`Dockerfile`, `*.dockerfile`).
  - Data: JSON (`.json`), Markdown (`.md`, `.markdown`).
- **Code Blocks & Brackets:** `computeBlocks` collects braces into `SimpleBracketsCollector` for brace-delimited languages, and counts line indentation for Python/YAML to emit `CodeBlock` lines for indent guide rendering.
- **Size Tiers:** Files in `DEGRADED` (>1 MiB) and `LARGE` (>5 MiB) tiers bypass lexing and use `EmptyLanguage()`.

### 2.2 Markdown & Zero-WebView HTML Previews
- **Markdown:** Remove `!focusedMode` guard in `EditorTopBar.kt`. Read preview text from document snapshot keyed by `(docId, revision)` without mutating `tab.content` or creating a second text authority.
- **HTML (Zero-WebView):** Implement `NativeHtmlSurfaceHost` platform injection. On Android, render via `AnnotatedString.fromHtml(html, linkStyles, linkInteractionListener)` with custom link confirmation, running off-main on `Dispatchers.Default` with a 256 KiB cap. Common fallback displays formatted text.

### 2.3 Media Playback (Image & Video)
- **Injection:** Introduce `LocalNativeMediaSurfaceHost` (`NativeMediaSurfaceHost`) in `features/media/` matching the pattern of `LocalNativeEditorSurfaceHost`.
- **Video Hardening:** Fix player/surface creation race with single `bind()`, set aspect ratio from `videoWidth/videoHeight`, seek on drag finished only, pause on `Lifecycle.Event.ON_STOP`, and clean up exact player instance.
- **Image Hardening:** Enforce 32 MiB stream read cap in `AndroidMediaClient`, decode bitmap with 50 MP pixel cap and `inSampleSize` downsampling, and render with clamped pan/zoom via `transformable(canPan = { scale > 1f })`.

### 2.4 Left File Tree Sidebar
- **Layout:** In `ProjectWorkspaceScreen.kt` when `activePanel == WorkspacePanel.EDITOR`, maintain a single stable layout tree to preserve `CodeEditor` view identity:
  - Wide screens (>= 600 dp or landscape): Pinned split with 280 dp `FocusedFilesExplorerScreen` on the left, 1 dp border, and `EditorPanelScreen` on the right.
  - Compact screens (< 600 dp): Slide-over panel (280 dp) with scrim.
- **Interaction:** Selecting a file calls `openTab(target, path)` without unmounting the editor. Back press closes the slide-over first. Modal focus is isolated from background editor when slide-over is open.

---

## 3. Scope Boundaries & Non-Goals

- **In Scope:** Sora editor syntax coloring, dark palette, line/bracket/indent decorators, Markdown preview toggle, zero-WebView HTML reader preview, real image/video media playback, collapsible left sidebar file tree.
- **Non-Goals / Excluded:**
  - `android.webkit.WebView` or any browser engine (forbidden by invariant).
  - Full TypeScript LSP / AST semantic analysis or compiler diagnostics daemon.
  - Video transcoding or external player intents.
  - Backend schema or server API modifications.

---

## 4. Side-Effect Risks & Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Zero-WebView test regression | CI and unit tests fail | Strictly use `AnnotatedString.fromHtml` without WebViews. |
| Undo/Redo/CAS corruption | Loss of unsaved edits or dirty flag sync | Preview consumes immutable read-only snapshot; never mutates `tab.content`. |
| Memory OOM on large media | App crash on large image or range thrash on video | 32 MiB stream cap, 50 MP decode limit, `inSampleSize` downsampling, seek throttling. |
| CodeEditor remount on sidebar toggle | Lost cursor, IME composition, and keyboard focus | Single stable `BoxWithConstraints` hierarchy without switching drawer wrappers. |

---

## 5. Testing & Verification Strategy

1. **JVM Unit Tests (`:shared:jvmTest`):** Test file extension/name language mapping, preview toggle state, MediaSurfaceHost contracts, zero text mutation on preview.
2. **Android Unit Tests (`:androidApp:testDebugUnitTest`):** Test `UniversalLanguage` tokenizer lines, `AndroidEditorSurfaceView` decorator properties, `AndroidImageSurface` ticket handling, and verify `testZeroWebViewsAcrossEntireApplication` passes 100%.
3. **Emulator Smoke Verification (`emulator-5554`):** Open Kotlin, Python, Markdown, HTML, Image, and Video files. Visually verify syntax colors, dark theme, sidebar split, Markdown rendering, and video playback controls.

# Phase 05 — Integrated Qualification and Verification

## Context and Goals
- **Objective:** Perform end-to-end verification across unit tests, automated lint/build checks, Zero-WebView security checks, and connected live emulator testing on `emulator-5554`.
- **Authority:** [Plan](plan.md) | [Research Reports](../reports/)
- **Target Files:**
  - Create: `plans/261024-1627-native-editor-ide-enhancements/qualification-report.md`
  - Modify: `docs/CHANGELOG.md`
  - Modify: `docs/architecture/android-native-client.md`

---

## Detailed Qualification Tasks

### 1. Automated Test Suites & Build Verification
1. `:shared:jvmTest`:
   - Run `gradlew.bat :shared:jvmTest` to ensure all shared editor, tab, watcher, and contract tests pass 100%.
2. `:androidApp:testDebugUnitTest`:
   - Run `gradlew.bat :androidApp:testDebugUnitTest` to verify Android unit tests, explicitly including:
     - `WorkbenchJourneysUnitTest.testZeroWebViewsAcrossEntireApplication`
     - `AndroidEditorSurfaceTest` (degradation gate, multiline state, bracket exclusion)
     - `AndroidMediaClientTest` (owner retirement, 206 range validation, 32 MiB stream cap)
     - `FileScreensPhase08Test` (sidebar input suppression, back press interception)
3. Assemble Debug APK:
   - Run `gradlew.bat :androidApp:assembleDebug` and `installDebug` on `emulator-5554`.

### 2. Connected Device / Emulator Smoke Verification on `emulator-5554`
Execute manual / scripted verification for each of the 5 key features:
1. **Syntax Highlighting & Dark Theme:**
   - Open `.kt`, `.py`, `.ts`, or `.json` file in `dam-hopper`.
   - Verify Sora `CodeEditor` renders dark theme (`SchemeDarcula`) with colored keywords, comments, strings, and bracket pairs.
   - Verify line numbers are pinned during horizontal scrolling and current line is highlighted.
2. **Markdown Preview:**
   - Open `AGENTS.md`.
   - Tap `Preview` button in toolbar.
   - Verify parsed Markdown blocks render (headings, code blocks, bullet points).
   - Tap `Source` button; edit text; tap `Preview` again and verify live text syncs without mutating tab baseline.
3. **HTML Reader Preview:**
   - Open an `.html` file.
   - Tap `Preview` button in toolbar.
   - Verify zero-WebView reader preview displays formatted HTML text without invoking a browser engine.
4. **Media Playback:**
   - Open an image file: verify decoded bitmap is displayed with zoom/fit controls.
   - Open a video file: verify `AndroidVideoSurface` plays video with correct aspect ratio and seek controls without range thrashing.
5. **Left File Tree Sidebar:**
   - While on the Editor view, tap `[📁 Tree]` button.
   - Verify File Tree appears on the left without unmounting editor or dropping undo stack.
   - Tap another file in the tree: verify it opens in a new editor tab immediately.
   - On compact screen (< 600 dp), verify tapping the scrim or Back closes the sidebar.

### 3. Record Results & Documentation
- Record full passes, command logs, and evidence in `qualification-report.md`.
- Update `docs/CHANGELOG.md` and `docs/architecture/android-native-client.md` describing the new IDE capabilities.

---

## Durable Tasks
```evcrate-tasks
[
  {
    "id": "qualify-native-editor-enhancements",
    "title": "Execute comprehensive unit, Zero-WebView, and connected emulator qualification",
    "blocked_by": [
      "integrate-editor-sidebar-and-rich-previews"
    ],
    "allowed_files": [
      "plans/261024-1627-native-editor-ide-enhancements/qualification-report.md",
      "docs/CHANGELOG.md",
      "docs/architecture/android-native-client.md"
    ],
    "constraints": [
      "testZeroWebViewsAcrossEntireApplication must pass 100% without exclusion or suppression.",
      "Evidence must be recorded from actual command runs on workstation and live emulator-5554.",
      "Documentation must accurately reflect zero-WebView reader fidelity and table-driven lexer scope."
    ],
    "acceptance": [
      "All unit test suites (:shared:jvmTest, :androidApp:testDebugUnitTest) pass 100%.",
      "Debug APK builds and installs cleanly on emulator-5554.",
      "Live connected verification proves syntax highlighting, dark theme, markdown/html previews, media playback, and left file tree sidebar."
    ],
    "verification": [
      "Run ./gradlew.bat :shared:jvmTest :androidApp:testDebugUnitTest :androidApp:assembleDebug",
      "Record observed device UI state and window dump in qualification-report.md"
    ]
  }
]
```

- [ ] <!-- evcrate-task:qualify-native-editor-enhancements --> Execute comprehensive unit, Zero-WebView, and connected emulator qualification (Completed 2026-10-24; 638/638 unit tests passing 100%; testZeroWebViewsAcrossEntireApplication passing; emulator-5554 live verification complete; qualification-report.md recorded)

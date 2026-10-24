# Code Review — Phase 09 Native editor language services & safe saves

Score: **5/10**. Core session/tier/CAS model sound + tested; UI/wiring far short of plan acceptance; several data-loss/crash paths.

## Scope
- Files: all Phase 09 `features/editor/*.kt` (20), `AndroidLanguageService.kt`, `WorkbenchScreen.kt` diff, `FileTreeState.kt` diff, 5 jvmTest files, `tests/test-phase-09-editor-saves.sh`; context: `FileRepository`, `FsWriteCoordinator`, `AndroidEditorSurface`.
- ~3000 LOC. Plan: `plans/261015-1647-android-native-app/phase-09-...md`.

## Critical
1. **Plain Compose `TextField` instead of Phase05 selected editor** (`NativeTextEditorView.kt`). Plan step 1 forbids "simpler text field". `AndroidEditorSurface` (Phase05) unused by Phase 09 UI. No folding/minimap/zoom/shortcuts/glyph margin; gutter = `lines.take(100)` unsynced w/ scroll; cursor/selection/scrollLine/findNext never bound to view; degraded banner claims "minimap & folding disabled" for features that don't exist.
2. **TS/JS service = bracket-balance heuristic, wired silently** (`TsJsLanguageService`, `EditorDiagnosticsManager`). Plan step 3: "Missing native service remains blocking, not silently syntax-only." `TypeScriptLanguageServiceAudit.STATUS=BLOCKED` yet UI shows "N errors" w/o syntax-only label. Heuristic itself wrong: no `\` escape handling (`'it\'s'` flips quote state), regex literals, template `${}`, JSX text apostrophes, single/double quotes survive across newlines → false errors/negatives. Phase can't be marked done; needs explicit blocker/labelled degraded state.
3. **Force overwrite bypasses encryption gate** (`EditorRepository.forceOverwrite` → `saveFile(encryptedRequested=false)`; `EditorTabsState.forceOverwriteTab` ignores `tab.encryptedSessionRequired`). Plaintext write when encrypted mode required = plan "no plaintext fallback" violation. Also no guards for `isSaving`/`tier.isReadOnly`/`targetAvailable`/disposed → double-tap = concurrent writes.
4. **Crash: async completion on disposed session** (`saveTab`, `forceOverwriteTab`, `reloadTab`). `closeTab`/`closeAll`/profile teardown during in-flight await → `session.completeSave/loadServerContent` → `checkNotDisposed()` throws IllegalStateException in UI scope → app crash. Need post-await `sessions[key] === session && !isDisposed` check.
5. **Late remote read can overwrite dirty content** (`reloadTab`/`handleRemoteFileModified`). Dirty check precedes `await loadFile`; user types during read → `loadServerContent` wipes edits + undo. Violates success criterion "Dirty content never overwritten by late remote reads". Capture `editEpoch` pre-await; apply only if unchanged (explicit user "Discard & Reload" excepted).
6. **Large-file paging broken** (`EditorScreens.kt` prev/next both call `tabsState.openTab` → early return for existing tab). `largeFileOffset/largeFileEof` never populated (`openTab` drops `result.isEof/bytesRead`; `EditorLoadResult.Success` has no offset). 64 KiB viewer shows only first chunk; `EditorRepository.loadFile(offset)` unreachable from UI. Success criterion "64KiB range viewer" unmet.
7. **Silent failures: errors/loading never rendered.** `EditorTab.error`, `isLoading` unused in `EditorPanelScreen`. Load failure → empty editable field; save failure/UnknownOutcome → tab.error="Save failed" never shown and message discarded; UnknownOutcome indistinguishable from Error (plan: uncertain commit must be honest, no auto resubmit). Non-timeout transport drop after commit mapped to Error (not Unknown). Conflict state: `forceOverwriteTab` clears `isConflicted` before write; failure/second conflict → dialog vanishes, no message.
8. **Dirty buffers dropped on profile change** (`WorkbenchScreen` LaunchedEffect): `editorTabsState = eTabs` replaces old state w/o `closeAll`/dirty prompt/stale-keep → silent unsaved-data loss + leaked sessions. Plan step 8 "unsaved edits across profile change".
9. **Watcher/Git invalidation not wired**. `handleRemoteFileModified` only called from tests; `FileTreeState.handleFsEvent` and ReplaceCoordinator batch writes never notify editor. Plan step 5 (clean reload / dirty stale notice) unmet in product. Likewise `PersistedTabMetadata`/`hydrated` unused (no persistence), no encryption toggle (`encryptedSessionRequired` never set), `connectionRegistry` unused (no owner-bound save check).
10. **Missing retained features**: no Replace UI (replaceCurrent/replaceAll implemented, not exposed), no shortcuts, no zoom, completions/symbols/navigation never surfaced (`getCompletions/getSymbols` only in tests), JSON symbol spans all (1,1), JSON error line regex `line (\d+)` never matches kotlinx messages → always line 1. Image/video tiers route to empty editable `TextField`.

## Warnings
- **Perf/memory**: per keystroke → 3–5 `content.toString()` full copies, full `refreshFindMatches`, full snapshot undo entry (50 × up to 5 MiB×2 B), tab `content`+`savedContent`+session buffer+`submittedContent` copies; synchronous JSON/TS full-parse on UI thread per keystroke, no debounce/cancel (plan: "cancel and discard"). 5 MiB degraded tier → ANR/OOM risk. Gate diagnostics by tier, debounce off-main, coalesce undo, avoid duplicate `content` in StateFlow.
- `setText` resets cursor to (1,1) + clears selection each keystroke; undo not coalesced; `TextField(value:String)` + async state hop risks IME composition/cursor jumps (plan step 8 IME).
- `SaveConflictDialog` wired `onDismiss = {}`: Cancel/back no-op, forced into Discard or Overwrite; "Discard & Reload" has no confirm; no keep-editing/copy path.
- `openTab` races: close during load → session registered for removed tab (leak) / double-session overwrite; existing errored tab never retries on re-open; `selection` arg ignored by view and by Workbench `onOpenFile` (search result jump lost).
- `LanguageServiceCoordinator`: results fenced only by synchronous equality (cancellation absent); `qualifiedWatermarks`/`fileWatermarks` never pruned on close; legacy `registerRequest/isResponseValid` (`>=`) now dead except tests; `AndroidLanguageService` unused dead code and ext set (`.mjs/.cjs`) diverges from `EditorDiagnosticsManager` → DRY/YAGNI.
- JSON `extractSymbols` plain recursion on remote content → StackOverflowError (not caught by `Exception`); unbounded symbol list. JSON Diagnostic.message embeds kotlinx "JSON input:" snippet = file-body fragment (plan security note); keep out of logs.
- Tab state duplicates session state (`mtime` vs `serverMtime`, `isDirty`, `content`); `saveTab` uses `tab.mtime` not session. Unused fields (`hydrated`, `largeFileOffset/Eof`, `submittedContent` in tab).
- `FileTreeState.kt` drive-by edit (`_error.value` moved out of coroutine) unrelated to Phase 09.
- `LanguageService.kt` reformatted to dense one-liners (diff churn); `EditorSession` uses `;`-chained statements — off codebase style, hard to review.
- Tests: static-grep shell script (70 assertions) proves symbol presence, not behavior; pins implementation text (`var isDirty ... (initialContent != savedContent)` redundant expr). Large-range test assertion is `contains(offset=0) || contains(len=…)` (weak). Not covered: saveTab success/conflict/unknown/error flows, forceOverwrite, close-during-save, dirty-vs-late-read, TS service, undo manager, fencing coordinator qualified API, tier boundaries at exact ±1 byte for loadFile, UTF-8 split. QA report cites "Sora Editor" and undo bound 100 — code uses TextField and 50.
- `FileRepository.readFile` text via `decodeToString()` lossy: non-UTF-8 text that server doesn't flag binary will be corrupted (U+FFFD) on save (pre-existing, affects plan UTF8 boundary item).

## Suggestions
- Introduce `EditorSession`-owned `generation` check helper: `withLiveSession(key, session) { }` used after every await.
- Add `EditorSaveOutcome` UI state (`Saved | Conflict | Unknown(msg) | Failed(msg)`), render banner, block auto re-save on Unknown until reload/stat.
- Return `bytesRead/offset/isEof` via `EditorTab`; add `loadRange(key, offset)` on `EditorTabsState`; clamp offsets to chunk-safe UTF-8 boundaries (decodeUtf8Safe `validLen` must advance next offset).
- Use `AndroidEditorSurface` (or Phase05 decision) via expect/actual `NativeEditorSurface` host.
- Move diagnostics to debounced background job with cancellation keyed by (documentKey, incarnation, owner, modelVersion).
- Make `EditorTabsState` own a `closeAll(confirmDirty)` / hoist across profile switch; show stale-owner banner.
- Delete `AndroidLanguageService`, legacy coordinator API, unused tab fields until used (YAGNI).
- Replace string-grep script with behavior tests (Compose UI/Robolectric or ViewModel-level).

## Positive
- Clean tier boundary constants (1 MiB/5 MiB/64 KiB) + `decodeUtf8Safe`; tier + preview-only precedence tested.
- `beginSave`/`completeSave` snapshot baseline preserves edits made mid-save; mtime CAS through `FsWriteCoordinator`; Timeout → `UnknownOutcome` at repo layer.
- Tab keys qualified by kind/profile/project/worktree/path; `PersistedTabMetadata` excludes content; no plaintext draft persistence.
- Encrypted save refuses plaintext in `saveFile`; Mermaid fence shows explicit unavailable notice; HTML left as source; 0 FABs; `isDirtyFile` feeds `ReplaceCoordinator`; manifest `configChanges` preserves state on rotation.
- Small focused files, KDoc on public types.

## Validation
- `bash tests/test-phase-09-editor-saves.sh` → 70/70 PASS (static greps only).
- `./gradlew :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.editor.*' --offline -q` → no failures reported (quiet mode; tail exit 0). Prior QA report `qa-261016-0654-phase-09-editor-saves.md`: jvmTest 133/133, androidApp unit 39/39, assembleDebug OK — not re-run by me.
- Not exercised: device/IME/real-server behavior; plan states compile+unit tests insufficient for native-surface acceptance. Phase todo list items remain unchecked; evidence ledger not updated.

## Metrics
- Type coverage: n/a (Kotlin). Test coverage: not measured. Lint: not run.

## Unresolved Questions
1. Phase05 outcome: is Sora/`AndroidEditorSurface` the mandated editor, or did Phase05 authorise TextField for this phase?
2. TS/JS: is a syntax-only service accepted by ledger, or must phase stay BLOCKED until QuickJS/server-LSP decision?
3. Should profile switch preserve dirty tabs per-profile (detached, stale) or prompt-before-switch?
4. Who owns wiring `FsEvent` → `handleRemoteFileModified` (Phase 08 FileTreeState vs Phase 09)?

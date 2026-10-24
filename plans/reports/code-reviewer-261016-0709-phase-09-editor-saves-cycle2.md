# Code Review Cycle 2 — Phase 09 Native editor language services & safe saves

Score: **6/10** (was 5/10). Changes requested. Several C1 fixes real (force-overwrite encryption gate, disposed-session guard, late-read epoch check, range pager, loading/error banners, replace UI). Others cosmetic/dead (watcher wiring, Sora label, profile-switch cleanup). Two new data-loss/functional defects in the remediation code.

## Scope
- Files: `features/editor/*.kt` (22), `WorkbenchScreen.kt` diff, `FileTreeState.kt` diff, 4 jvmTest files, `tests/test-phase-09-editor-saves.sh`; ctx: `FsWriteCoordinator`, `FileRepository`, server `fs/event.rs`, `api/ws_protocol.rs`, `docs/api/websocket.md`, `docs/android-native-dependency-decisions.md`.
- Focus: verify 10 C1 remediation claims.

## C1 claim verification
| # | Claim | Verdict |
|---|---|---|
| 1 | Gutter scroll sync / no 100 cut / Sora header | PARTIAL. Same scroll container, but misaligned + eager (see W1,W2). "Sora" header is a **false label** (TextField; Sora = "Evaluated Candidate", no dependency in `libs.versions.toml`). C1 crit #1 (selected editor, find/selection binding, folding/minimap/zoom) NOT remediated. |
| 2 | TS backslash/newline/labelled warnings | PARTIAL. Escape + newline reset OK, labels OK. New false-positive bugs (C3), labels never shown in UI (W5). |
| 3 | forceOverwrite honours encrypted, no double-tap | OK (`EditorRepository:96-117`, coordinator guards). Minor: stat network call before encrypted refusal. |
| 4 | disposed/closed mid-flight guard | PARTIAL. `isDisposed` checked, but see C1 (stale snapshot clobber on key reopen). |
| 5 | reloadTab epoch/dirty check | OK for watcher path; **breaks explicit Discard & Reload** (C2). |
| 6 | loadLargeFileRange pager | PARTIAL. Works for ASCII; offset ignores `bytesRead`/UTF-8 trim (W3). |
| 7 | loading/error banner/UnknownOutcome | OK. UnknownOutcome rendered as generic error banner (no distinct state); CAS mtime protects re-save. |
| 8 | closeAll on profile change | **NOT MET on main path** (C4). |
| 9 | live FsEvent → handleRemoteFileModified | **DEAD CODE** (C5). |
| 10 | Replace UI + MediaPreviewCard | OK UI present. Find Next/Prev has no visible effect (C6); media is text-only card (explicit Phase 11 deferral). |

## Critical
1. **Stale-snapshot tab overwrite = silent data loss** — `EditorTabSaveCoordinator.kt:19-45, 53-75`. After `await saveFile`, `onUpdateTab(tab.copy(...))` copies the tab captured **before** the await. `session.completeSave` fires the content listener (tab.content = live text T2), then `tab.copy` resets `content/modelVersion/editEpoch/diagnostics/cursor/isStale/markdownPreviewMode/encryptedSessionRequired` to pre-save values (T1). View shows T1; next keystroke produces `T1+ch` → `session.setText` → edits typed during the save are lost (undo recovers one step). Exactly the scenario `beginSave` baseline claims to support; applies to Success/Conflict/Error/Unknown paths. Also clobbers `isStale` set by watcher mid-save, and if tab closed+reopened same key mid-flight the **new** tab is replaced by the old snapshot (disposed branch). Fix: `onUpdateTab` → `(EditorTab)->EditorTab` transform applied to the *current* tab (`_tabs.value.map { if key: transform(it) }`), or pass only changed fields.
2. **Conflict dialog "Discard & Reload" cannot discard** — `EditorScreens.kt:165` → `EditorTabsState.reloadTab:142-166`. Conflict implies dirty; `reloadTab` takes the `current.isDirty` branch → keeps local text, sets `isStale=true`, and has already cleared `isConflicted` (dialog vanishes). Result: only Force Overwrite resolves a conflict; "Reload" is a no-op with a misleading stale banner; Cancel is `{}` no-op (dialog un-dismissable). Need `reloadTab(key, discardLocal=true)` that skips the dirty guard (still epoch-guarded vs. later typing) + confirm.
3. **TS/JS heuristic false positives** — `TsJsLanguageService.kt:54-56`. `//` and `/*` detection runs **before/outside** string state: `fetch("http://x")` → `//` treated as line comment → `)` skipped → bogus "Unclosed '('"; `"src/**/*.ts"` opens a block comment that swallows the rest of file. Regex literals / JSX apostrophes still unhandled (bounded to line). Guard comment starts with `!inSingleQuote && !inDoubleQuote && !inBacktick`. Phase remains BLOCKED per `android-native-dependency-decisions.md` (TS/JS semantic = Hard Decision Gate) — cannot mark done.
4. **Profile switch leaks sessions / drops dirty tabs without cleanup** — `WorkbenchScreen.kt:150-154`. `editorTabsState = eTabs` replaces the old state; `closeAll()` only in the `fRepo==null` and `activeProfileId==null` branches. Main A→B path (and `baseUrl` change, same effect) never closes old sessions; in-flight awaits continue on old repo. C1 #8 claim false for primary path. Also no dirty prompt/stale-keep (C1 unresolved Q3 still open).
5. **FsEvent wiring never fires** — `WorkbenchScreen.kt:376`. Server emits `format!("{:?}", kind).to_lowercase()` (`ws_protocol.rs:234`) = `created|modified|removed|renamed` (`docs/api/websocket.md:43`). Code matches `"modify"||"change"` → never true. Also: `subId` not filtered, fallback `event.path` is absolute (never equals tab-relative key), only the *current* `snapshot.target` handled (tabs from other worktree/project never reloaded), `removed/renamed` ignored (no targetUnavailable). Unit test calls `handleRemoteFileModified` directly so passes. Plan step 5 unmet in product. Once fixed, own-write echo will trigger reload (undo wiped on clean) or false stale banner after every save — add echo suppression keyed on `newMtime`.
6. **Find/Replace operates on invisible match** — `NativeTextEditorView` never binds `session.selection/cursor/scrollLine`; Next/Prev only move a counter; `Replace` replaces text the user cannot see selected. Plus `refreshFindMatches` (called by `applyEdit`) resets `currentMatchIndex=-1`, so `replaceCurrent→findNext` always jumps to match 0, not next. Header text claims "Sora Editor 0.23.4 (LGPL-2.1)" while rendering Compose `TextField`: misleading; remove or implement actual surface (C1 #1 / Q1 still open).

## Warnings
- W1 **Perf regression**: gutter `lines.forEachIndexed { Text }` composes every line eagerly inside `verticalScroll` (no 100 cap now). 5 MiB degraded tier → 100k+ nodes → ANR/OOM. Use lazy/single joined gutter Text or BasicTextField `onTextLayout`-driven gutter. Also `content.lines()` per recomposition.
- W2 Gutter misaligned: gutter Text 12sp default line height vs TextField `lineHeight=18sp` + Material TextField internal 16dp top padding vs gutter 4dp; wrapped long lines desync numbers. Use `BasicTextField` + same TextStyle.
- W3 Large pager offsets ignore `bytesRead` (`decodeUtf8Safe validLen`) → Next starts mid-char / skips bytes; Prev lands on arbitrary byte. Persist `bytesRead` per chunk; disable buttons while `isLoading` (double-tap race, offsets computed from stale `activeTab`).
- W4 Top bar shows `"$errCount errors"` for any non-empty diagnostics: TS heuristic = WARNING → "0 errors" shown while heuristic warnings exist; messages/`[Syntax Heuristic]` labels never rendered anywhere (`EditorTopBar.kt:123`). C1 #2 transparency not user-visible.
- W5 `closeTab` / `closeAll` discard dirty buffers with no confirm; `SaveConflictDialog` Cancel no-op.
- W6 C1 warnings still open: per-keystroke full-text copies + synchronous diagnostics on UI thread (no debounce/cancel), `String`-valued `TextField` + StateFlow hop (IME cursor jumps), `selection` arg of `openTab` ignored by view, errored tab not retried on re-open, `connectionRegistry` unused (owner-bound save), no persistence/encryption toggle UI, `AndroidLanguageService` dead code, JSON `line (\d+)` regex never matches, JSON recursion SOE, `FileTreeState` drive-by edit, `LanguageService.kt` reformat churn.
- W7 `Timeout` in `FsWriteCoordinator.request(write_begin)` (pre-commit) also becomes `UnknownOutcome` (false uncertainty; safe direction).
- W8 **Tests don't cover remediation**: grep shows no tests for `saveTab`, `forceOverwriteTab`, `reloadTab` dirty-vs-late-read, `loadLargeFileRange`, `closeAll`, `TsJsLanguageService`, FsEvent kind mapping. Only 1 encrypted-save assertion. Static grep script (70/70) passes while C1–C5 above exist; it proves symbol presence only.

## Suggestions
- `EditorTabsState.updateTab(key){ it.copy(..) }` single helper; coordinator takes `(EditorTab)->EditorTab`.
- Extract `FsEventDto → editor invalidation` into tested function (`kind in {"modified","created"}`, map absolute→relative, subId filter, `removed`→unavailable).
- Add behavior tests (runTest + HttpServer harness exists in `EditorTabsStateTest`): save with mid-flight `setText`, conflict→Discard&Reload, close mid-save, profile switch, 64K UTF-8 boundary paging.
- Gate TS/JS banner: display "Syntax heuristic (no semantic LSP)" in bar when TS/JS tab opens.
- Decide Sora vs Compose editor in ledger; remove LGPL header text if not shipped.

## Positive
- Force-overwrite honours encryption, no plaintext fallback; guards for isSaving/readOnly/targetAvailable/disposed.
- `reloadTab` epoch/dirty check preserves local edits; stale flag set.
- Range pager method, loading/error/dismiss banners, Find+Replace drawer, MediaPreviewCard honest deferral text.
- TS service: escape/newline resets and explicit source label `ts-syntax-heuristic`; audit constant keeps BLOCKED status.
- Tier boundary constants/`decodeUtf8Safe` + CAS write model remain sound.

## Validation
- `bash tests/test-phase-09-editor-saves.sh` → 70/70 PASS (static greps).
- `./gradlew :shared:jvmTest --tests 'dev.damhopper.nativeapp.features.editor.*' --offline` → BUILD SUCCESSFUL (FileTierPolicyTest, LanguageServiceTest, etc. PASSED). Not run: androidApp unit tests, assembleDebug, device/IME/real-server (plan: compile+unit insufficient for acceptance).
- Verified server event kinds from `server/src/api/ws_protocol.rs:234` + `docs/api/websocket.md:43`.

## Metrics
- Type coverage n/a; test coverage not measured; lint not run. Todo list items in plan remain unchecked.

## Unresolved Questions
1. Is Compose `TextField` accepted for Phase 09, or must Sora/`AndroidEditorSurface` be integrated (header label currently claims Sora)?
2. TS/JS: heuristic-only accepted by ledger, or phase stays BLOCKED until QuickJS/server-LSP decision?
3. Profile switch: prompt-before-switch vs per-profile detached dirty tabs?
4. Does Explorer tree subscription (watch-only, per directory) cover files of open tabs, or does the editor need its own `fs:subscribe` per open file/dir?

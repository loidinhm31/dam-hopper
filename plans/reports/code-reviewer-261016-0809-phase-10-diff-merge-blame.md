# Code Review — Phase 10 Native diff/merge/blame

Score: **5/10** — models/parser/validator solid + tests green, but data-loss risk (hunk index), dead/unwired plan requirements, stale-result races, perf cliff in LCS. Phase 10 NOT ready to mark done.

## Critical
1. **Revert Hunk index mismatch (data loss)** — `DiffReviewController.discardHunk(currentHunk)` sends client LCS hunk index; server `git::discard_hunk` (server/src/git/diff.rs:731) uses git2 HEAD→workdir hunks (3-line context, nearby edits merge). Indices diverge whenever 2 changes <=6 lines apart → wrong hunk reverted. Also `recomputeRows` mixes `max(client, server)` hunk counts. Fix: map by `content.hunks` (oldStart/newStart ranges) → server index; drop client counter for revert.
2. **Blame cache never hits for committed files** — `BlameRepository.executeBlame` looks up with `rootId="."`, `headOid=null`; stores under `rootId=response.rootId`, `headOid=response.baseCommitOid` (server returns `Some(head)`, blame.rs:214/283/449). Lookup key != stored key. Cache is dead; HEAD/root identity from plan step 6 unimplemented. Cache hit would also return stale `snapshotId/modelVersion` unvalidated.
3. **Stale attribution shown after edits** — `EditorScreens.kt`: `lineAttributions` `remember(activeTabKey, showBlame)` not invalidated on content change; gutter keeps old committed identity/misaligned lines until response arrives. Violates success criterion "never shows stale committed identity after edits". No 250ms debounce used (LaunchedEffect calls `executeBlame` directly per keystroke → full-buffer POST+SHA-256 (<=5 MiB) per edit); `requestBlameDebounced` unused in prod.
4. **LCS O(n·m) memory/time on main thread** — `LcsDiffEngine.computeMiddleLcs` allocates `Array(n+1){IntArray(m+1)}`; guard is 10k lines/side → up to ~400 MB (OOM) after prefix/suffix trim; run synchronously via UI-scope coroutine (also on every `updateModifiedDraft`). Plan asked "proven diff algorithm" (Myers O(ND)) — not met. Fix: Myers or cap on n*m cells + `Dispatchers.Default`.

## Warnings (High/Medium)
- Plan requirements unmet/unwired: editable diff (UI has no editor; `modifiedDraft/updateModifiedDraft/isModifiedDirty` dead in prod, no save path); hunk nav doesn't scroll/highlight current hunk (blind destructive revert, no confirm); merge: no undo, no prev/next conflict, ancestor pane + `ANCESTOR`/`BOTH_THEIRS_FIRST` actions not exposed (plan: retain all actions), Result pane is plain TextField; no ancestor view.
- `CommitRevealCoordinator`/`CommitRevealRequest` unused in prod; `onInspectCommit` directly calls `loadDiff` with click-time target (no nonce/owner/root/OID binding, no expiry check despite `createdAtEpochMs`, `root` not compared, "nonce" = profile:hash:millis predictable/collidable). `advanceTargetEpoch`/`retireOwner` never called → no shared invalidation; `targetEpochs` map unbounded.
- `BlameRepository.requestBlameDebounced`: wrapper `launch` unordered on multi-thread dispatcher → older request can cancel newer; unused `oldJob`; `inFlightJobs` never cleaned; `executeBlame` catches `Throwable` incl. `CancellationException` and `onResult` still fires with Invalid("cancelled") from cancelled job.
- No stale-response fencing in `DiffReviewController.loadDiff`, `MergeConflictController.loadConflicts/selectFile` (fire-and-forget `launch`, no job cancel/request id) → slow response for file A overwrites file B state; `catch Throwable` swallows cancellation. `markResolved` has no re-entrancy guard besides UI `enabled`.
- `MergeConflictScreen.onResolved` navigates to TERMINAL after every single file resolve even when other conflict files remain.
- `allResolved = content.isNotEmpty() && ...` → cannot resolve to an intentionally empty file.
- `ConflictParser.acceptConflict` re-searches from `startLine-3` instead of using region lines; normalizes all EOLs (lone CR→LF/CRLF) rewriting bytes outside region; nested `<<<<<<<` inside theirs section skipped by `i++` after `break`. `startsWith("=======")` also matches `==========` (matches web parser; markdown risk).
- `BlameValidator.computeBufferLineCount` counts only `\n`; server `normalize_buffer_content` counts `\r`, `\r\n`, `\n` → lone-CR buffers get "line count mismatch" → blame rejected (plan: preserve lone-CR alignment). Editor `content.lines()` splits lone CR too.
- Phase-10 verification only structural greps + helper unit tests; no repository/controller tests (stale reject, cache hit, hunk mapping, race), no real-repo/device evidence required by plan step 8 / success criteria.

## Suggestions (Low/YAGNI/DRY)
- `Sha256Digest.jvm.kt` and `.android.kt` byte-identical → single `jvmAndAndroid`-shared source set or commonMain pure impl; `OpaqueClientBridge.kt` also touches sha — check reuse.
- `NativeReviewSurfaces`/`CandidateReviewSurface` is dead metadata stub (hardcoded booleans, only asserted by grep test) — delete or implement real surface (YAGNI).
- `targetStore` ctor param unused in Diff/Merge controllers; `DiffLineType.MODIFIED/HEADER` partially used; `HunkInfo`, `GitLineChange`, `lineChanges` unused (line-change gutters from plan not delivered).
- `jsonPrimitive.toString().toBoolean()` → `.booleanOrNull`; `BlameCacheEntry.accessOrder` `var` in data class; `isBufferOverLimit` allocates full byte array — compute UTF-8 length w/o copy; double `Clock.now()` in `CommitRevealRequest`.
- Leftover commented line `// EditorPanelScreen(tabsState = editorTabsState!!)` in WorkbenchScreen; gutter/line numbers render N `Text`s (no virtualization), wrapped lines misalign (18.dp vs 18.sp).
- Truncated-preview mode (>10k lines) silently shows only 500 rows with position-wise diff, hunk revert still enabled → should be read-only.
- Tests/script: grep-assertion tests inflate counts (77) without behavior; test script asserts `"64"`, `"250L"` substrings.

## Positives
- Wire models match server (FileDiffContent/HunkInfo/ConflictFile/GitBlame*); `ProtocolJson` shared.
- BlameValidator partition/overflow/status checks thorough; cache bounded by entries+bytes with LRU.
- Dirty-buffer guards before discard; read-only for historical/deleted/binary; server remains authority; no content logged; no FABs.
- Parser handles diff3 + CRLF round-trip; prefix/suffix trimming in LCS.

## Validation
- `bash tests/test-phase-10-diff-merge-blame.sh` → 77/77 PASS (structural only).
- `./gradlew --offline :shared:jvmTest --tests '*features.git*' --tests '*BlameValidatorAndCacheTest*'` → exit 0 (quiet, tests PASS).
- QA report plan/reports/qa-261016-0804 claims full suite 246/246 + assembleDebug (not re-run).
- No device/server runtime evidence → plan acceptance not met.

## Reviewed
Files listed in assignment (+ server git_blame.rs, git/diff.rs discard_hunk, git/blame.rs, git/types.rs for contract check).

## Unresolved
- Should revert map by server `hunks` ranges or add server hunk-by-range API (needs backend compat review)?
- Is lone-CR blame parity required (server counts `\r`)? Confirm editor model EOL semantics.
- Is truncating at 10k lines acceptable vs plan "retain all data"?
- Resolve-to-empty-file allowed?

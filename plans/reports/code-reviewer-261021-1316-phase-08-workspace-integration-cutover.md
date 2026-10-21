# Code Review — Phase 08 Workspace integration & cutover

Score: **6/10**. Core cutover is real (old parser/ConflictBlock gone, conflict rows route to resolver, backend rejects mixed stage). Blocking gaps: stale-root reveal, unproven production routing, weak tests.

## Validation (re-run by reviewer)
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit` -> exit 0.
- `pnpm --filter @dam-hopper/ui test run src/components src/hooks/use-conflict-resolver.test.tsx src/lib` -> 261 files / 2184 tests pass.
- `cargo fmt --check` (server) -> clean. Tester report (plans/reports/tester-261021-1308-...): browser 14/14, backend conflict suites 39–40 pass incl. `test_conflict_api_generic_stage_rejects_conflicted_file_cut1`, `test_conflict_legacy_resolve_fails_closed`, mixed `stage_files(["clean","conflict"])` test (git_conflict_exact_staging.rs:678).
- Grep `conflict-parser|ConflictBlock` in packages/, server/src, docs -> 0 hits (CUT2 reference part OK).
- Not run: real app production-routing smoke (plan step 12) — no evidence it exists.

## Critical
1. **Stale root/file on non-row entries (wrong-root risk).** `WorkspacePage.handleOpenConflictResolver()` only sets `resolverRoot`/`resolverInitialFilePath` when a selection is passed. Operation banner "Open Resolver" and the floating pill call it with no arg -> reopen with previous nested root + file. Plan gate: "stop cutover on wrong-root actions". Page-level hook (root undefined) drives the pill, panel uses `resolverRoot` -> mismatch. Fix: always set both (`undefined`/`""` for operation entry), or hold a single `{root, filePath}` reveal intent object with a nonce.
2. **Phase 08 not demonstrably complete.** Plan todo list all unchecked; no test drives row click -> resolver (ChangedFilesList conflicted routing, root derivation, aggregate/nested), delayed apply + newer typing, lost response, repeated stop, handoff return. Success criteria AC1/AC8/CUT3 + step 12 unevidenced. Tester report itself says production-routing qualification PENDING.

## Warnings
1. Re-click same conflict row after switching file inside panel does nothing: `initialFilePath` effect keyed on value; same value -> no re-select. Use a reveal nonce/key.
2. Panel empty-state card says "All conflicts resolved… you can now continue" whenever `selectedFilePath===""` and an operation exists — also true while inventory loading, on `inventoryError`, or `messageEditRequired`. Misleads (plan: refresh never implies completion). Gate on loaded inventory + no error; otherwise show status.
3. Continue/Abort duplicated (toolbar + empty card) — DRY; card duplicates button markup. Keep toolbar only or share one component.
4. `refreshAfterTerminalReturn` in handoff banner button: `void` of a promise that throws for retired owner -> unhandled rejection, no UI error. Catch -> `setOperationError`. Banner shows only `worktreeRoot`; plan asks exact profile/server/project/worktree/root guidance (data exists in `TerminalHandoffContext`). Banner text hardcodes "Commit message editing" regardless of `handoff.reason`. `blocked` outcome shows raw enum `reason`.
5. `window.confirm` for abort/binary/delete: blocking, untestable, plan wants confirmation naming operation + likely loss (abort OK, others minimal). Consider in-app dialog (follows ConflictDialog pattern).
6. `MergeConflictEditor`: `fallbackResolver = useConflictResolver(...)` always runs even when `resolver` prop given. Production consumer (Panel) always passes it -> third live hook instance (page, panel, editor), each with listeners/queries. Only browser test `conflict-resolver-history` omits prop. Make prop required, update that test. (W6 deferral remains open.)
7. `MergeConflictEditor`: `handleBinaryChoice`/`handleKeepModified`/`handleDeleteFile` ~95% identical; outcome-to-message mapping (`"error" in o ? … : "reason" in o ? …`) repeated, loses `worktreeChangedStageFailed`/`outcomeUnknown` semantics (partial/unknown must demand refresh/review). Extract `runResolveAction(fn, fallbackMsg)` that also surfaces `requiredRefresh`. Also inline `isMalformed` re-implements marker counting; `conflict-marker-parser` already exists (DRY). File is 1666 LOC, one 1580-line component — far above modularization rule; new Binary/ModifyDelete/Unsupported views are natural extraction targets.
8. `applyDraft` explicit `indexSide`/`delete` skip client eligibility guard (status unsupported / not modifyDelete). Backend enforces, UI not exposing, but hook is public contract; add check parity.
9. `useGitOperationStatus(targetRef)` in `ChangedFilesList`: `staleTime: 0`, no root -> banner only sees primary-root operation. Nested-root stopped operation gets no banner in aggregate view (AC8/AC9 gap). Mounted twice (page + floating panel).
10. Escape change in `TerminalFloatingFilePanel`: now ignores Escape when focus is outside panel and not body (e.g. in terminal xterm textarea). Arguably correct (terminal needs Esc) but contradicts inherited C1 ("Escape closes without prior click"); behavior not tested.
11. Server noise: ~160 unrelated `server/**` files reformatted (cargo fmt; ws-diff 3.6k lines even ignoring whitespace, `.codegraph/.gitignore` deleted). Keep out of Phase 08 commit or confirm intended. In `diff.rs`, `trim_start_matches("./")` -> `strip_prefix("./")` narrows normalization (`././x` no longer matched by CUT1 preflight; `add_path("././x")` then reaches libgit2). Revert to `trim_start_matches` or normalize via `Path::components`. Preflight also rebuilds `unmerged_entries` Vec of all index entries per call (O(n), fine but `starts_with(&format!)` allocates per path/entry).
12. Tests weak: toolbar/editor tests are `renderToStaticMarkup` string asserts; "arbitrates z-order" browser test just echoes `zIndex` prop (mock-echo; plan forbids). `WorkspacePage.test` change only deletes the conflicted `openDiff` expectation and adds a count; no assertion that conflict routes to resolver. `isTopmostFloatingPanel` (W4) still exported, only test uses it -> dead code not removed.

## Suggestions
- WorkspacePage: two identical inline `onSelectFile` lambdas + `onSelectConflict` prop. ChangedFilesList already splits by status only for the "changes" section; simplest design: drop `onSelectConflict`, keep one `handleSelectChangedFile` callback in page, used by both lists. Also `"."` literal duplicates `PRIMARY_ROOT_ID` (export it).
- `openChangedFileDiff` silently returns for conflicted — fine as guard, add a unit test; comment duplicates.
- `TerminalWorkspaceShell.effectiveTopmost`: inner `frontPanelId !== null ? frontPanelId` branch is dead (effectiveFront already falls back to frontPanelId); heuristic fallback ("tool"/"files" guess) is speculative — simplify to `effectiveFront`.
- `updateFloatingPanelStack` returns `currentStack as TerminalFloatingPanelId[]` (readonly cast). Type param as `readonly` return or return same typed array.
- Duplicate comment line above pill in `WorkspacePage` ("Floating conflict pill…" x2). Extra blank-line churn in ChangedFilesList.
- Checkbox: `disabled` + `readOnly` + `onClick` guard redundant; `disabled` is enough.
- `handleStageAll` silently drops conflicted files — no feedback when mixed batch.

## Positives
- Old marker parser/ConflictBlock/fallback paths deleted, replaced by the Phase 06 structured model; Android read-only coverage retained via ConflictRegionNav.
- Backend preflight rejects any conflicted path (stage 1/2/3 or dir prefix) before any write, under mutation coordinator; covered by mixed-batch tests. Legacy payloads fail closed with test.
- Conflict rows/context menu/stage-all no longer stage conflicts; Apply path captures scope/attempt and refreshes authoritative state in `finally`; abort/continue use fresh operation fingerprint.
- Unsupported/binary/modify-delete views separate and explicit; delete never inferred from empty text.

## Reviewed files
ChangedFilesList.tsx (+Render test), ConflictResolverPanel.tsx, ConflictResolverToolbar.tsx (+new test), MergeConflictEditor.tsx (+test), TerminalFloatingFilePanel.tsx, WorkspacePage.tsx (+test), TerminalWorkspaceShell.tsx, use-conflict-resolver.ts, conflict-editor-decorations.ts, terminal-workspace-panel.ts, conflict-parser.ts (deleted), server/src/git/diff.rs, browser-tests/git-conflict-resolver.browser.tsx.

## Unresolved questions
1. Is the server-wide cargo fmt reformat intentional/in scope for this commit?
2. Should Escape in the files panel close when focus is in the terminal (C1) or not (current)?
3. Nested-root operation banner in aggregate view: expected to surface per root (needs per-root status query) or primary-only?
4. Who provides the plan step-12 production-app smoke evidence (Phase 08 vs Phase 09)? Plan todo checkboxes not updated; left untouched to avoid conflicting with Main.

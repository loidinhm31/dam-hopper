# Code Review — Phase 08 cycle 3

Score **6/10**. Cycle-2 critical (reveal routing untested) + binary-order + snap-back fixed in code. New: modify/delete side mapping inverted vs server (feature broken), server tree re-dirtied (164 files) contradicting "discarded", panel nonce logic untested, W6 consolidation still not wired.

## Validation (reviewer run)
- `pnpm exec tsc --noEmit -p tsconfig.json` (packages/ui) -> exit 0.
- `pnpm exec vitest run` (packages/ui, full) -> 337 files / 3069 tests pass (jsdom "navigation not implemented" stderr noise only).
- `eslint` on 7 changed src files -> 0 errors, 11 warnings (all `react-hooks/exhaustive-deps`; WorkspacePage `handleOpenConflictResolver` warning from cycle 2 gone).
- `git status`: 164 `server/**` files modified (+12100/-10411; +3483/-1794 ignoring CR/ws), mtimes 14:26:50 = whole-workspace `cargo fmt` re-run right before review. `.codegraph/.gitignore` restored (not in status).
- Grep `conflict-parser|ConflictBlock|parseConflictRegions|hasRemainingConflicts` in packages/ + docs/ -> 0 production hits.
- Not run: Chromium suite, backend cargo suites (tester claims pass), live-daemon smoke (plan step 12).

## Critical
1. **Server tree not clean.** Claim "discarded 164 unrelated server files, only diff.rs kept" false on disk: 164 server files dirty (rustfmt reorder of `mod`s, CRLF->LF on index-CRLF files e.g. `lib.rs`, `ws_fs_subscribe.rs`). Unrelated churn would ship in Phase 08 commit. Fix: restore all but `server/src/git/diff.rs` (`git checkout -- server` then re-apply/keep diff.rs only; do NOT rerun workspace-wide `cargo fmt` — use `rustfmt --check server/src/git/diff.rs` or `cargo fmt -- <file>`). Also diff.rs is not fmt-only: `stage_files` `trim_start_matches("./")` -> manual strip loop (equivalent behavior, unneeded edit) + import reorder.
2. **Modify/delete side inverted vs backend.** `MergeConflictEditor.tsx:913-914,1343-1358`: UI treats `modifyDelete` = ours modified/theirs deleted -> keeps `ours`. Server (`conflict.rs:585-588`) maps `our_present && !their_present` -> `DeleteModify`, `!our_present && their_present` -> `ModifyDelete`; backend test `test_conflict_delete_modify` (git_conflict_discovery_api.rs:377-380) asserts `ModifyDelete` => stage2 Missing, stage3 Text. So "Keep modified" for `modifyDelete` picks missing stage 2 -> `applyDraft` throws "Selected side (ours) does not exist"; description text also wrong for both statuses. Fix: derive kept side from `snapshot.stages` (the non-`missing` side), copy from same source; fix UI test fixture (currently encodes wrong semantics: modifyDelete with ours=text present) and assert side passed to `applyIndexSide`. Cycle-2 warning only fixed ordering, not this.

## Warnings
1. **Panel nonce consumption untested.** `lastConsumedNonceRef` once-only logic (headline fix) has zero tests. `ConflictResolverPanel.test.tsx` (59 LOC) actually tests `ConflictResolverToolbar` and duplicates `ConflictResolverToolbar.test.tsx` (DRY; misleading name). Add jsdom Panel test w/ mocked hook: intent applies once, refetch (`conflicts` change) does not snap back user selection, `useConflictResolver` called with intent root.
2. **W6 hook consolidation still undone.** `ConflictResolverPanel` renders `<MergeConflictEditor>` without `resolver={resolver}` -> editor `resolver` prop + `{enabled}` option are dead in production; 3 live hook instances (page, panel, editor). Also `initialFilePath`, `root` panel props have no production caller (YAGNI). Pass `resolver`, make prop required, drop dead props/option.
3. **Editor `key` omits root:** `key={`${project}:${selectedFilePath}`}` — same relative path in two roots (aggregate/nested, AC8/AC9) reuses mounted editor/local state. Include `effectiveRoot`.
4. **`handleOpenConflictResolver` unstable:** deps `[bringFloatingPanelToFront, conflictResolver]`; hook returns fresh object each render (use-conflict-resolver.ts:847), so callback changes every render and invalidates `leftTools`/terminal-panel `useMemo`s (the dep added to silence lint). Depend on `conflictResolver.setVisible` (stable `useCallback`).
5. **Nested-root operation entry (W9, plan step 4):** `useGitOperationStatus(targetRef)` in ChangedFilesList and page-level `useConflictResolver(target)` have no root -> stopped op in nested repo gets no banner/pill; pill/banner intent always `root: undefined` (resets any previously chosen nested root). Needs decision (unresolved Q3).
6. **Duplicate outcome handling:** 3 near-identical handlers (`handleBinaryChoice/KeepModified/DeleteFile`), `"error" in o ? … : "reason" in o ? …` collapses stale/partial/unknown/requiredRefresh semantics into raw text (plan step 7 requires review-before-next-command). Continue/Abort rendered twice (toolbar + empty card). `window.confirm` x4. `isMalformed` re-implements marker counting inline though `conflict-marker-parser` exists. `MergeConflictEditor.tsx` 1670 LOC.
7. **`ConflictResolverHandle` hand-mirrors ~70 lines of hook return type** — drifts silently; use `ReturnType<typeof useConflictResolver>` via inferred return type.
8. **Plan/docs not updated:** phase-08 file still "Pending 0%", all todos unchecked incl. inherited C1–W7; plan.md row 35 Pending; no CHANGELOG/system-architecture entry. W2/W3 browser matrix, W5 z-order, W6 not delivered — need explicit deferral record, not silent.
9. Step-12 live-daemon smoke (aggregate nested, delayed apply + newer typing, lost response, repeated stop, terminal handoff) not run; plan gate requires evidence or formal Phase 09 handoff.

## Suggestions
- Move `buildConflictRevealIntent` (+ intent type) to `lib/`; component-file exports hurt fast-refresh. Use counter/ref nonce instead of `Date.now()+Math.random()` float; export `PRIMARY_ROOT_ID` instead of `"."` literal.
- Triple conflict guard for the same click: `openChangedFileDiff` early return + `onSelectFile` branch in 2 inline lambdas + `onSelectConflict`. Keep one (ChangedFilesList already routes); lambdas duplicated at two sites.
- Checkbox `disabled` + `readOnly` + onClick guard redundant.
- `onResolved={() => resolver.refetchAll()}` floating promise; catch -> `setOperationError`.
- `stage_files` preflight: `unmerged_entries.iter().any(... format!(...))` allocates per path per entry; precompute prefix once. `unstage_files`/`discard_file` not preflighted against conflicted paths (cycle-2 note, still open).
- Android test rewritten to `ConflictRegionNav` asserts `>=2` disabled + title string; tighten to exact count.
- Terminal handoff banner shows only `worktreeRoot`; plan wants profile/server/project/worktree/root.
- Reveal after hide via pill sets `filePath: undefined` -> selection snaps to `conflicts[0]` on reopen.

## Positives
- Binary vs delete/modify precedence now correct (unsupported -> delete/modify -> binary).
- Reveal routing extracted, unit-tested (primary/nested/no-arg) plus real-DOM row-click -> `onSelectConflict`, `onSelectFile` not called; context menu hides Add/Discard for conflicts.
- Backend CUT1 preflight under mutation lock, mixed clean+conflict batch tested; legacy payload rejected with `LEGACY_PAYLOAD_REJECTED`.
- Old `conflict-parser`/`ConflictBlock` fully removed, decorations module has local type; Android read-only coverage kept via behavioral rewrite.
- `nonce` consume-once design correct (ref + effect keyed on intent identity).

## Reviewed files
ChangedFilesList.tsx, ConflictResolverPanel.tsx, ConflictResolverToolbar.tsx, MergeConflictEditor.tsx, WorkspacePage.tsx, TerminalFloatingFilePanel.tsx, TerminalWorkspaceShell.tsx, terminal-workspace-panel.ts, use-conflict-resolver.ts, conflict-editor-decorations.ts, server/src/git/diff.rs (stage_files), server/src/git/conflict.rs (status map), server/tests/git_conflict_discovery_api.rs (delete_modify); tests: ConflictResolverIntegration, ConflictResolverToolbar, ConflictResolverPanel, MergeConflictEditor, ChangedFilesListRender, WorkspacePage; plan phase-08, cycle-2 report.

## Unresolved questions
1. Who reran workspace `cargo fmt` after the discard, and will 164 files be restored before commit?
2. Modify/delete: confirm semantic naming (server `ModifyDelete` = ours deleted/theirs modified). Rename UI copy or server enum? Recommended: UI derives from stage presence.
3. Aggregate view: per-root operation banner/pill required (AC8/AC9) or primary-only acceptable for Phase 08?
4. Step-12 live smoke: Phase 08 sign-off or formal Phase 09 handoff?
5. W2/W3/W5/W6 inherited deferrals: carry to Phase 09 explicitly?

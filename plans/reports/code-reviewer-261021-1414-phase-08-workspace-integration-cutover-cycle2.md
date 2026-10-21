# Code Review — Phase 08 cycle 2

Score **7/10**. Cycle-1 stale-root bug fixed in code; routing glue still has zero automated coverage; new binary modify/delete gap; several cycle-1 warnings open.

## Validation (reviewer run)
- `pnpm --filter @dam-hopper/ui exec tsc --noEmit` -> exit 0.
- `vitest run` 9 conflict/workspace files (MergeConflictEditor, Toolbar, Panel, Integration, ChangedFilesList(+Render), WorkspacePage, terminal-workspace-panel, use-conflict-resolver) -> 9 files / 62 tests pass.
- `eslint` on 7 changed src files -> 0 errors, 13 warnings (2 new: WorkspacePage useMemo missing dep `handleOpenConflictResolver` at ~2259/2579).
- `cargo fmt --check` (server) -> clean (0 diffs). Grep `conflict-parser|ConflictBlock` in packages/ui/src, browser-tests, server/src, docs -> 0 hits.
- Not run: browser suite (tester cycle 2: 12/12), backend suites (tester: 39 + 204), live-daemon smoke (plan step 12).

## Cycle-1 critical status
1. Stale root/file on operation entry — FIXED. `WorkspacePage.handleOpenConflictResolver` always sets `{nonce, filePath, root}` (undefined for banner/pill); Panel `effectiveRoot = revealIntent ? revealIntent.root : propRoot`. Same-row re-click now re-selects (new object identity). No regression test covers it.
2. Production routing tests — PARTIAL. New `ConflictResolverIntegration.test.tsx`: root derivation helper, static markup (disabled checkbox, banner text, button label), real-DOM context-menu (Resolve present, Add/Discard absent). Missing: row click -> `onSelectConflict`; banner/pill click -> `handleOpenConflictResolver()` with no stale root; Panel revealIntent/root/filePath selection; step-12 smoke.

## Critical
1. Reveal/routing glue untested + step-12 smoke not run. Exact bug class from cycle 1 (wrong root) has no guard; plan gate "stop cutover on wrong-root actions" has no evidence. Fix: extract `buildConflictRevealIntent(selection?)` pure fn (lib), unit-test primary/nested/no-arg; jsdom Panel test with mocked hook asserting `useConflictResolver(target, root)` args + selected file after intent change; click test on conflicted row asserting `onSelectConflict` called and `onSelectFile` not. Smoke can be Phase 09 only with explicit plan handoff.

## Warnings
1. Binary modify/delete unreachable delete: editor branch order unsupported -> binary -> modify/delete. Server sets `isBinary` from any present stage while status stays `ModifyDelete` (conflict.rs:585/587, :632). Binary modify/delete (png etc.) shows binary view with a missing side ("Take Theirs" -> client error) and no Delete. Fix: put `isDeleteModifyConflict` before `isBinaryConflict`.
2. Panel selection snap-back: effect keyed on `[conflicts, initialFilePath, revealIntent]` re-applies `revealIntent.filePath` (or `conflicts[0]` for operation entry) on every inventory refresh (apply, terminal return, focus). User-picked file is overridden. Fix: consume intent once per object (ref of last-applied intent).
3. W6 hook consolidation not achieved: Panel renders `MergeConflictEditor` without `resolver` prop (ConflictResolverPanel.tsx:261-272) so editor fallback hook is enabled -> 3 live `useConflictResolver` instances (page, panel, editor). `{enabled: !propResolver}` only helps when prop is passed. Pass `resolver={resolver}`; make prop required; update `conflict-resolver-history` browser test.
4. Cycle-1 W3 (Continue/Abort duplicated in toolbar + empty card), W5 (`window.confirm` x4), W7 (3 near-identical handlers, `"error" in o ? … : "reason" in o ?` mapping drops partial/unknown/`requiredRefresh` semantics; `isMalformed` re-implements marker count; 1670-LOC file) still open. Binary/delete handlers show raw outcome text for stale/partial/unknown without forcing review.
5. W9 open: `useGitOperationStatus(targetRef)` in ChangedFilesList has no root -> nested-root stopped operation gets no banner/pill in aggregate view (AC8/AC9).
6. Inherited deferrals W2/W3 (multi-panel z-order browser test, 1400px 3-pane test) not added; browser-tests unchanged. W4 half done: `updateFloatingPanelStack` short-circuits but `isTopmostFloatingPanel` still exported/test-only. Plan todo boxes all unchecked (left to Main).
7. Server churn: 164 `server/**` files reformatted (cargo fmt), `.codegraph/.gitignore` deleted. Keep out of Phase 08 commit (separate chore) or restore.
8. New lint warnings: WorkspacePage `useMemo` deps miss `handleOpenConflictResolver` (stale closure harmless: `setVisible`/`bringFloatingPanelToFront` stable). Fix by depending on `conflictResolver.setVisible` instead of whole object.
9. Panel `key={project:selectedFilePath}` on MergeConflictEditor omits root: same path in primary + nested root reuses mounted editor [INFERENCE: editor has root-keyed refs at :175/:321, likely OK, untested].

## Suggestions
- `TerminalWorkspaceShell.effectiveTopmost`: `frontPanelId !== null ?` branch dead (effectiveFront already falls back); simplify to `effectiveFront ?? heuristic` or drop heuristic.
- `updateFloatingPanelStack` casts `readonly` -> mutable; return `readonly` type.
- `nonce: Date.now()` not unique within a ms; use ref counter like other reveal nonces. `"."` literal duplicates `PRIMARY_ROOT_ID` (export).
- Page: two identical inline `onSelectFile` lambdas + `onSelectConflict` prop; collapse to one handler.
- Checkbox `disabled`+`readOnly`+onClick guard redundant.
- `onResolved={() => { resolver.refetchAll(); }}` floating promise (unhandled rejection); catch -> `setOperationError`.
- Backend: `unstage_files`/`discard_file` not preflighted vs conflicted paths (generic bypass of reviewed apply for conflict-stage removal); trailing-slash dir input (`"dir/"`) not matched by preflight prefix check (libgit2 likely rejects, add test).
- Banner guidance shows only `worktreeRoot`; plan wants profile/server/project/worktree/root.
- Escape: files panel ignores Escape when terminal textarea focused (inherited C1 says close without click); untested.

## Positives
- Operation entry no longer inherits stale root; one intent object drives root + file + re-select.
- Empty-state card gated on loading/error/messageEdit; handoff refresh now catches rejections and branches on reason.
- `diff.rs` loop-strip of `./` restores prior normalization; backend preflight under mutation lock, mixed clean+conflict tested; legacy payload fail-closed tested.
- Old parser/ConflictBlock fully removed; decoration module has local region type.
- `applyDraft` explicit `indexSide` now rejects missing side client-side.

## Reviewed files
ChangedFilesList.tsx, ConflictResolverPanel.tsx, ConflictResolverToolbar.tsx, MergeConflictEditor.tsx, WorkspacePage.tsx, TerminalFloatingFilePanel.tsx, TerminalWorkspaceShell.tsx, terminal-workspace-panel.ts, use-conflict-resolver.ts, conflict-editor-decorations.ts, server/src/git/diff.rs, server/src/git/conflict.rs (status/isBinary), tests: ConflictResolverIntegration, ConflictResolverToolbar, ChangedFilesListRender, ConflictResolverPanel, WorkspacePage, MergeConflictEditor; plans phase-08, cycle-1 + tester cycle-2 reports.

## Unresolved questions
1. Step-12 live-daemon smoke: Phase 08 sign-off or formal Phase 09 handoff?
2. Server-wide cargo fmt + `.codegraph/.gitignore` deletion: intentional in this commit?
3. Aggregate view: per-root operation banner required (AC8/AC9) or primary-only acceptable?
4. Escape in files panel while terminal focused: close (C1) or ignore (current)?

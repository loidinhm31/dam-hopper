# Code Review — Phase 07 Floating Monaco Surface

Date: 2026-10-21 | Branch: feat/git-conflict-resolver | Plan: plans/261019-1505-git-conflict-resolver/phase-07-floating-monaco-surface.md
Reviewer: Phase07Reviewer

## Verdict: **4 / 10 — CHANGES REQUESTED (do not mark Phase 07 done / hand to Phase 08)**

Green tests + clean tsc, but tests are shallow (SSR markup, `document.dispatchEvent`, single-hunk-at-file-start fixture) and miss several broken/unimplemented Phase 07 acceptance items. Two defects reproduced empirically in real Chromium (C1, C2).

## Scope
- Files reviewed (all listed in assignment; ~6.5k LOC incl. unchanged context): terminal-workspace-panel(.test).ts, conflict-resolver-panel-state(.test).ts, conflict-draft-store.ts, conflict-draft-transitions.ts, conflict-editor-decorations.ts, ConflictResolverToolbar/RegionNav/Panel(.test).tsx, MergeConflictEditor(.test).tsx, TerminalFloatingToolPanel.tsx, TerminalWorkspaceShell.tsx, WorkspacePage.tsx (host seam), use-floating-panel-geometry.ts, browser-tests/git-conflict-resolver.browser.tsx; also hooks/use-conflict-resolver.ts, lib/conflict-region-mapper.ts, conflict-merge-actions.ts (to trace defects).
- Server `M server/**` files in git status are out of Phase 07 scope; not reviewed.
- Plan updated: phase-07 Overview status line.

## Critical issues

**C1. Accept/Both/Mark-reviewed act on wrong/stable region — REPRODUCED.**
`MergeConflictEditor.tsx` `applyAccept`/`applyAcceptBoth`/`applyMarkReviewed` use `activeDraft.mergeModel.regions[regionIndex]` where `regionIndex` = index in marker-parsed list (`parseConflictRegions(resultContent)`). `mergeModel.regions` (conflict-region-mapper.ts:60-107) interleaves `stable-N` and `conflict-N` regions. Probe (temp browser test, removed): worktree `keep\n<<<<<<<…` → click `←T` → draft unchanged, error banner `Cannot perform conflict decision on stable region stable-1.` Any file with unchanged text before a conflict (i.e. almost all) breaks; multi-hunk after first accept also shifts indices (marker list shrinks, model list does not). Phase 06 model authority is bypassed by an index guess. Same class:
- `ConflictRegionNav.tsx:49` looks up `decisions["conflict-${i}"]`; ids start at `conflict-1` (`conflictIndex++` before use, mapper:75) → off-by-one, then falls back to `Object.values(decisions)[i]` (property order, includes stable regions) → wrong "resolved" styling. Tester report item 4 claims this fixed; it is not.
- `MergeConflictEditor.tsx:503-518` source decorations use `mergeModel.regions.map(r => r.theirsRange)` — includes stable regions → whole unchanged text highlighted as conflict (inferred from code; Chromium probe could not observe decoration DOM, unverified).
Fix: derive nav list + decoration ranges + actions from `mergeModel.regions.filter(r => !r.stable)` keyed by `region.id`; pass `region.id` to handlers, not index. Delete marker-parser fallbacks (see M1). Add multi-hunk + leading-stable-text fixture test.

**C2. Narrow (tabbed) mode never activates — REPRODUCED.**
`MergeConflictEditor.tsx:139-149`: ResizeObserver effect has `[]` deps and reads `containerRef.current`, but the ref'd div (line 880) renders only after early returns (loading/no-data, lines 836-852). First render always early-returns (inventory empty) → ref null → observer never attached → `isNarrow` stuck `false`. Probe at 500px container: 3 Monaco editors mounted, `Base` wide-toggle shown, no Theirs/Result/Ours tabs. Violates Phase 07 requirement "narrow layout explicit Left/Result/Right/Base", AC1/AC11, compact-mode. Fix: callback ref / observe in effect keyed on whether container is rendered (or `useLayoutEffect` on state-held element). Add browser test: render at <768px, assert tab switching + result text/history retention.

**C3. Escape ownership/stacking contract not implemented (gate in phase doc: "Escape closes multiple surfaces").**
- WorkspacePage mounts `<ConflictResolverPanel>` without `isTopmost`, `zIndex`, `onActivate` (WorkspacePage.tsx:2752-2758) → defaults `isTopmost=true`, z=30 forever. `TerminalWorkspaceShell` state `frontPanelId` never contains `"resolver"`; `"resolver"` in `TerminalFloatingPanelId` is nominal. Helpers `isTopmostFloatingPanel`, `updateFloatingPanelStack`, `resolveFloatingPanelStackZIndex`, `TERMINAL_FLOATING_PANEL_TOPMOST_Z_INDEX` are consumed only by tests (grep) → dead/YAGNI code that gives false confidence (tests "maintains an ordered stack…" pass on unused code).
- Tool panel `isTopmost={frontPanelId==="tool" || frontPanelId===null}` and resolver (always true) both register `document` keydown; which wins = listener registration order (resolver's `onHide` is a fresh arrow every render → effect re-registers each render, so order is unstable). Not deterministic topmost.
- Resolver handler (`ConflictResolverPanel.tsx:66-78`) never checks focus location: Escape pressed in a terminal (vim/readline) while resolver visible → xterm gets Esc (target phase first) AND resolver hides. Also no `event.defaultPrevented` check (Radix menus/dialogs, Monaco-consumed events with non-stopped propagation).
- Monaco widget guard `document.activeElement.closest(".monaco-editor .suggest-widget.visible, .find-widget.visible")` is wrong for suggest (focus stays in the editor textarea, not inside the widget) and ignores context menu. Works today only incidentally because Monaco's keybinding service stopPropagation()s consumed keys; no test proves it. Browser tests dispatch `new KeyboardEvent("keydown")` straight on `document` — no real Monaco, no focus, no overlapping panels.
Fix: single owner of stack in WorkspacePage (resolver + files + tool), pass `isTopmost`/`zIndex`/`onActivate`; scope handler to `panelRef.contains(activeElement)` (or topmost-with-focus), honour `defaultPrevented`; memoize `onHide`; real-Monaco test: open find/suggest, Esc → widget closes, resolver stays; Esc again → hides only resolver; terminal textarea spy receives nothing.

## High priority

**H1. No aligned panes / view zones (Phase 07 steps 6-7, visual oracle).** `grep ViewZone` → none in editor. `syncScroll` copies identical `scrollTop` to all panes; result text (with markers/different length) vs sources → drift on unequal hunks. No wrap/fold policy (`wordWrap:"off"` constant, folding untouched, fontSize fixed 12). Todo item "Implement public aligned panes, scroll guards and font/wrap/fold policy" is not met; at minimum a documented qualified restriction is required by the plan.

**H2. Hide destroys view state / geometry.** WorkspacePage conditionally mounts panel (`isPanelVisible && …`) and panel returns `null` when `!open` → `useFloatingPanelGeometry` state (position/size/maximize), `selectedFilePath`, narrow pane, base toggle, Monaco cursor/scroll all lost on hide/reopen. Draft text/history survive in store (good), but plan step 3 "restore geometry/view selection on reopen" fails. Lift layout/view state to the host (or keep mounted + `hidden`).

**H3. Maximize "Restore" does not restore geometry.** `toggleMaximize` → `clampResolverPanelLayout` for `isMaximized` returns `{width:avail,height:avail,top:12,left:12}`, overwriting prior geometry; restore re-clamps the maximized numbers → panel stays full-size. Browser test named "restores prior geometry" only asserts `offsetWidth > 0`. Store pre-maximize frame; assert width/top/left equal before/after.

**H4. No re-clamp on viewport/zoom/orientation change.** `use-floating-panel-geometry.ts` clamps only during drag/resize/maximize; no `resize` listener / ResizeObserver; maximized panel keeps stale numeric size. Requirement: "clamp after viewport or shell change", "layout editors after geometry changes".

**H5. Three–four independent `useConflictResolver` instances** (WorkspacePage, ConflictResolverPanel, MergeConflictEditor) — each runs its own paginated `git.conflicts` inventory load, `markMissingConflicts`, beforeunload listener, own `loadRequestRef`/`refreshError`/`inventoryError`; plus editor also fires `useGitConflictFile` (duplicate of `loadConflictDraft` fetch) and `useGitFileDiff` (full file diff fetched only to get `language`; large diffs + extra `diffLoading` gate). Violates "WorkspacePage owns retained controller; frame never owns". Pass controller (or a context) down once; derive language from path/extension. Page instance also omits `root` while panel passes it.

**H6. Editor remount churn + model leak.** `<Editor keepCurrentModel>` without `path`: each narrow pane switch / wide↔narrow flip / Base toggle mounts a new model while old one is kept alive; disposal only at unmount for the last model in `modelsRef`. Leaks one model per switch (documented `keepCurrentModel` semantics). Also stale editor refs: source decoration collections (`theirsDecorationsCollection.current`) point at the disposed editor after remount and the decoration effect (`[conflictRegions, mergeModel]`) does not re-run on mount → decorations missing after pane switch/Base toggle; initial application races Monaco mount. Use stable `path` URIs (model per role/draft, disposed with draft or on unmount) and re-apply decorations in each `onMount`. Result Editor unmount also drops cursor/scroll (use `saveViewState`).

**H7. Loading gate unmounts all editors.** `isLoading = conflictsLoading||snapshotLoading||diffLoading` early-return replaces editor tree with spinner; `conflictsLoading` includes `inventoryLoading`, which is re-set true whenever `currentScope`/`loadConflicts` (depends on `connection` object) changes. Any connection-snapshot churn blows away Monaco instances mid-edit. [INFERENCE on frequency; mechanism confirmed in code.]

## Medium

- **M1. Legacy marker parser still drives UI** (`parseConflictRegions`, `acceptConflict`, `hasRemainingConflicts`, `hasMalformedConflicts`): readiness fallback, result decorations, nav, and three "fallback if model not loaded" branches in accept/acceptAll that mutate result outside Phase 06 authority. Plan: "removing … marker-only readiness as model takes ownership". Remove fallbacks (disable actions until model loaded).
- **M2. Duplicate chrome**: panel toolbar (Hide X, aria "Hide conflict resolver") + editor toolbar (X aria "Close merge conflict editor" → `onClose=onHide`). Two close buttons, one mislabeled (plan: label "Hide"). Remove `onClose` X from editor; `onClose` still used by recovery-discard.
- **M3. Dead/unused**: `ConflictBlock` export (MergeConflictEditor.tsx:1397+, only a test), `Split` & `ConflictRegion` imports, `onIgnoreSide` prop (RegionNav), `showBaseInWide` base toggle hidden in narrow but narrow never reached, `useFloatingPanelGeometry({isMaximized:false})` option unused by resolver (drag allowed while maximized; clamp masks it).
- **M4. Perf per keystroke**: `theirsText/oursText/baseText = textTokens.join("")` recomputed every render (render per keystroke via `setResultContent`) → memoize on `snapshot`. `parseConflictRegions(resultContent)` O(n) per keystroke; `updateResult` runs remap of regions each keystroke; `editor.getValue()` copy. Controlled `value={resultContent}` adds a second sync path (history restore does `model.setValue` which also wipes Monaco native undo; acceptable only because Ctrl+Z is rebound).
- **M5. Store hardening DRY**: `calculateDraftMetrics(draft.metrics.sourceBytes, draft.result, draft.history, draft.recoveryText)` copy-pasted 7× in `conflict-draft-store.ts`/`-transitions.ts`; the "any decision non-pending → dirty" block duplicated in undo/redo. Extract `recalcMetrics(draft)` and `hasNonPendingDecisions(model)`. W-4 semantics: a draft whose baseline already has decisions (post-apply) is dirty forever on undo/redo to that state — verify against `appliedResult` handling. W-2/W-3/W-5 logic otherwise looks right (`canCoalesceHistory=false` before `updateResult`; `draftKey` now required in `confirmWholeFileAction`).
- **M6. A11y**: narrow tab bar lacks `role="tablist"/"tab"`/`aria-selected`/`aria-controls`; panel `<section>` has no `aria-label`/role; drag/resize mouse-only (no touch/pointer, no keyboard resize) — Android/compact users can only maximize. Region chips use `div onClick` (not keyboard-focusable) around buttons.
- **M7. Handoff text** is static guidance; ok per plan, but "Refresh status" result/error from `refreshAfterTerminalReturn` is `void`-ed (unhandled rejection, no UI error). Catch → `setResolveError`.
- **M8. Stale selection**: when last conflict resolves, `selectedFilePath` is never cleared (effect only handles `conflicts.length > 0`) → editor shows "No conflict data for …" instead of the panel's "all resolved" state. Also effect triggers react-hooks `set-state-in-effect` lint warning.

## Low / suggestions
- Redundant per-editor `ResizeObserver` (`automaticLayout:true` already set); observers for replaced editors never disconnected (cleanup only for current refs).
- Drag/resize listeners not removed if panel unmounts mid-gesture (cursor/userSelect stuck on body).
- `editorOptions.theme: "vs-dark"` hard-coded; ignores app theme/zoom (`app-zoom`), contradicts "respect font/zoom" requirement.
- `resolver-file-select` static id (collides if two panels); use `useId`.
- ESLint: 7 warnings in touched files (unused `Split`, `ConflictRegion`, `onIgnoreSide`; 3 exhaustive-deps in MergeConflictEditor; set-state-in-effect in Panel).
- Cognito: no Phase 07 change or test touches it; `CognitoModeOverlay` is not referenced from WorkspacePage/templates in this review — CUT2 "Cognito isolation behaviorally exercised" is unevidenced.
- Android policy: real behavior covered only by SSR markup + mocked `useConflictResolver`; no real-Monaco readOnly/typing/paste test for sources (AC3) and none for result under Android flag.

## Security
- No `dangerouslySetInnerHTML`/`innerHTML` in changed files; file/stage/OID labels rendered via React text (OK). Injected style tag is static.
- Keyboard routing: resolver document-level Escape can fire while focus is in terminal (C3) — hijack of terminal Escape, not content leakage. No resolver content sent to terminal. `window.confirm` for discard is acceptable.
- No new network surface; extra duplicate fetches (H5) are availability/perf, not authz.

## Positive
- Monorepo-pattern lazy import of panel avoids Monaco in SSR tests; geometry extracted into shared hook (DRY vs tool panel) and tool panel migrated.
- `clampResolverPanelLayout` small-viewport fix + test; `stopImmediatePropagation` concept for sibling document listeners.
- Phase 06 store hardening for typing→accept coalescing, metrics recompute, preview `draftKey` binding is directionally correct and tested in store suite.
- Source editors `readOnly:true`; result read-only under Android/unavailable target/recovery; accept actions disabled consistently.

## Validation (run by reviewer, cwd packages/ui)
| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, 0 errors |
| `pnpm exec vitest run src/lib/terminal-workspace-panel.test.ts src/lib/conflict-resolver-panel-state.test.ts src/components/organisms/MergeConflictEditor.test.tsx src/components/organisms/ConflictResolverPanel.test.tsx src/lib/conflict-draft-store.test.ts` | 5 files / 37 tests pass |
| `pnpm exec eslint <9 touched ui files>` | 0 errors, 7 warnings (listed above) |
| Temp Chromium probe (`vitest run --config vitest.browser.config.ts`, file deleted afterward) | C2 reproduced: 500px container → 3 editors, no tabs. C1 reproduced: leading stable line → `←T` → "Cannot perform conflict decision on stable region stable-1." |
| Tester-reported (not rerun): 132 UI unit / 7 browser / 40 server tests pass | consistent with above; pass ≠ acceptance — tests do not cover C1–C3, H1–H4 |

Metrics: type coverage n/a (tsc strict clean); coverage tool not installed; lint warnings 7.

## Phase todo status
- [ ] cross-shell host + extended stacking identity — host mounted; stacking identity NOT wired (C3)
- [ ] renderer vs structured model/history — partial (C1, M1)
- [ ] aligned panes / scroll guards / font-wrap-fold policy — NOT done (H1)
- [ ] responsive frame + pane selector + accessible controls — selector dead (C2), a11y gaps (M6)
- [ ] Android input / Cognito / topmost keyboard ownership — Android ok in code; Cognito unevidenced; keyboard ownership C3
- [ ] real shell/geometry/focus exercise — browser tests mocked-level; none cross-shell/overlap/real Monaco widget

## Recommended actions (priority)
1. Fix C1 (region-id-based actions/nav/decorations) + add multi-hunk/stable-text browser test.
2. Fix C2 (observer attach) + narrow browser test with typing + pane switching + history retention.
3. Implement C3: single stack owner, scoped Escape handler, real-Monaco Escape test, overlap files/tool/resolver test, remove or use dead stack helpers.
4. H2/H3/H4: host-owned geometry+view state, true maximize-restore, viewport re-clamp.
5. H5/H6/H7: single controller instance, stable model paths, decoration re-apply on mount, no loading-gate unmount.
6. H1: view zones + wrap/fold policy or documented qualified restriction in plan.
7. M-series cleanup (parser fallbacks, duplicate close, DRY metrics helper, memoize joins, a11y).

## Unresolved questions
1. Is H1 (view zones/alignment) intentionally deferred to Phase 09 visual qualification, or required in Phase 07? Plan text says Phase 07; tester report implies deferral.
2. Is unified stack ownership intentionally Phase 08 (tester report §5) despite Phase 07 gate "Escape closes multiple surfaces"? If so, phase doc must be amended; otherwise C3 blocks.
3. Where is Cognito overlay mounted, and does it need to cover/exclude the resolver (z-index 30 fixed overlay)? Not found in WorkspacePage/templates.
4. W-4: should decision-only dirtiness compare against baseline decisions (post-apply) rather than "any non-pending"?
5. Source decoration highlighting of stable regions (C1 sub-item) not observable in probe — confirm in a layout-sized Chromium test.

# Code Review (Cycle 2) — Phase 07 Floating Monaco Surface

Date: 2026-10-21 | Branch: feat/git-conflict-resolver | Reviewer: Phase07ReviewerCycle2
Plan: plans/261019-1505-git-conflict-resolver/phase-07-floating-monaco-surface.md | Prior: code-reviewer-261021-1130-phase-07-floating-monaco-surface.md (4/10)

## Score: **6 / 10 — CHANGES REQUESTED (1 critical remains; C1, C2 resolved, C3 partially)**

## Cycle 1 critical status
| # | Item | Status | Evidence |
|---|---|---|---|
| C1 | Accept/Both/Reviewed hit stable region; nav off-by-one; source decorations include stable | **RESOLVED** | Code: `conflictMergeRegions = regions.filter(!stable)`, nav ids = `region.id`, handlers take `regionId`. Chromium probe @1400px (temp, deleted): leading `// prefix header` + conflict → click `←T` → result editor text `"// prefix header\nline 1 theirs"`, no `[role=alert]`. Wide mode: 3 editors, decorations rendered (`.mc-conflict-theirs/ours/marker` present). |
| C2 | Narrow tabbed mode never activates | **RESOLVED (mechanism)** | Callback ref `setContainerNode` + effect keyed on node; `role=tablist/tab/aria-selected` present. Probe @414px: tablist present, 1 editor mounted. **But** see W3: shipped browser test only passes because vitest-browser default viewport is 414px. |
| C3 | Escape ownership/stacking | **PARTIAL — see Critical 1** | Fixed: `defaultPrevented` check, focus-inside-panel scoping, find-widget case (probe @1400px, real Monaco, Ctrl+F then Esc: find closes, `onHide` 0 calls; 2nd Esc: `onHide` 1 call), `isTopmost`/`zIndex`/`onActivate` wired. Not fixed: single stack identity (below). |

## Critical issues
**1. Floating-panel stack is split in two owners; resolver can be z-ordered under files/tool and Escape arbitration still ambiguous (C3 residual).** [code-derived; not reproduced in browser]
- `WorkspacePage` keeps `floatingPanelStack` containing only `"resolver"` (never `files`/`tool`). `TerminalWorkspaceShell` keeps its own `frontPanelId` (files/tool only). Plan requires *one* extended identity contract (phase doc steps 1-2, "Key insights").
- z-order: `resolveFloatingPanelStackZIndex("resolver",["resolver"])` = 22 always (index 0). Tool/files "front" z = 25 (`TERMINAL_FLOATING_PANEL_FRONT_Z_INDEX`). Shell `<main class="relative overflow-clip">` creates no stacking context, so an activated files/tool panel (25) renders **above** the resolver (22) even after the user clicks the resolver. Previously fixed 30; Cycle 2 regressed overlap behaviour.
- Escape: tool `isTopmost = frontPanelId==="tool"||null` and resolver `isTopmost` (stack top) are both true simultaneously. Tool panel handler (`TerminalFloatingToolPanel.tsx`) is not focus-scoped: Escape typed inside resolver can close the tool panel instead of hiding resolver (or the reverse), depending on `document` listener registration order. `onHide` in `WorkspacePage` is an inline arrow → resolver effect resubscribes every render → order unstable. Gate in plan: "Escape closes multiple surfaces / only active topmost" fails to be provable.
- `isTopmostFloatingPanel` is still consumed only by its own test (dead/YAGNI). No overlap test (files+tool+resolver) exists; AC2 overlap scenario unexercised.
- Fix: one stack owner (lift `frontPanelId`→ shared state/ctx in WorkspacePage covering files/tool/resolver), derive `zIndex` and `isTopmost` from it for all three; scope tool/files Escape to `panelRef.contains(activeElement)` like resolver; `useCallback` `onHide`; delete `isTopmostFloatingPanel` if unused; add browser/overlap test.

## Warnings (high/medium)
- **W1. Source/result decorations lost after pane switch in narrow mode** [REPRODUCED]. Probe @414px: after switching Result→Theirs tab: `.mc-conflict-theirs`=0; back to Result: `.mc-conflict-marker`=0, ours=0. Also initial narrow render shows partial/no conflict decorations (marker 0). Cause: decoration effect deps `[conflictRegions, activeDraft?.mergeModel]` only; `onMount` handlers never re-apply; collection refs point at disposed editors. Wide mode OK. Fix: re-apply decorations in each `handle*Mount` (or state-tracked "editor mounted" version in deps) and reset collection ref on mount. Cycle 1 H6 sub-item still open.
- **W2. `navigateToConflict` uses marker parser index** (`parseConflictRegions(resultContentRef)[index]`) while nav list is model regions (non-stable, includes resolved). After first resolution marker list shrinks, model list does not → jumps to wrong/no region. Use `navRegions[index].startLine`. Same family as C1; marker fallbacks in `applyAccept`/`acceptAll`/`navRegions` remain (M1 carry-over).
- **W3. Browser tests weak / viewport-coupled.**
  - Narrow test sets `container.style.width=500px`, but panel is `fixed inset-0` so container width is irrelevant; passes only because vitest-browser default viewport is 414px. Consequently *all* shipped browser tests run in narrow mode; wide 3-pane mode never covered. Set `page.viewport()` explicitly (wide + narrow).
  - Accept test asserts only "no stable-region alert", not resulting text (my probe shows it would be easy: read `.view-lines`).
  - Maximize test claims "restores prior geometry" but asserts `offsetWidth > 0`; record width/top/left before/after.
  - Escape tests dispatch synthetic event on `document`; `panel.focus()` on `<section>` without `tabIndex` is a no-op (focus stays body); "focus outside" case also sets `isTopmost=false`, so not isolated. No find/suggest/context-menu test in committed suite (only my temp probe).
- **W4. Carry-over Cycle 1 high items not addressed in Cycle 2** (not regressions): H1 no view zones/alignment/wrap-fold policy (todo item 3 unmet, no documented qualified restriction); H2 hide unmounts panel → geometry/selected file/pane lost (`isPanelVisible &&` mount + `if(!open) return null`); H5 3 `useConflictResolver` instances + duplicate `useGitConflictFile`/`useGitFileDiff` (diff fetched only for `language`); H7 `isLoading` gate unmounts editors; M5 metrics DRY; Cognito unevidenced. Phase cannot be marked done.
- **W5. Line-ending churn.** `git status` shows 167 `server/**` files modified (index CRLF, worktree LF; content diff is EOL-only) plus `TerminalFloatingToolPanel.tsx` (index CRLF → LF, whole-file diff 383 lines vs 131 real) and `.codegraph/.gitignore` deleted. Out of Phase 07 scope; do not stage. Normalize before commit (`git diff --ignore-cr-at-eol` shows ui real delta 766+/399-).
- **W6. Escape widget guard** uses document-wide `querySelector(".monaco-editor .suggest-widget.visible, .find-widget.visible, .monaco-menu-container")`. Find case verified; suggest and context-menu cases unverified (suggest widget visibility class not confirmed). Any visible find widget in another editor on the page also blocks resolver hide (focus already scoped to panel, so low impact). Prefer scoping query to `panelRef.current`.

## Suggestions (low)
- ESLint (0 errors, 15 warnings across touched files): unused `Split`, `ConflictRegion` imports; 4 exhaustive-deps in `MergeConflictEditor`; `set-state-in-effect` in `ConflictResolverPanel.tsx:59` (stale `selectedFilePath` when last conflict resolves also not cleared) and `use-floating-panel-geometry.ts:75`; 6 pre-existing-looking deps warnings in WorkspacePage.
- `ConflictBlock` export, `onIgnoreSide` prop, `useFloatingPanelGeometry({isMaximized})` option still dead (Phase 08 cleanup acceptable).
- Geometry hook: `toggleMaximize` writes a ref inside a `setLayout` updater (works idempotently, impure; StrictMode-safe by accident). Drag/resize document listeners not removed on unmount. Resize via `window` event only (not ResizeObserver on bounds) — fine for fixed overlay.
- Duplicated `<Editor>` JSX for wide/narrow/base (~6 near-identical blocks) → extract `SourcePane` helper (DRY).
- `theirsText/oursText/baseText = tokens.join("")` recomputed per render (per keystroke) — memoize on `snapshot`.
- `editorOptions.theme "vs-dark"` hard-coded; `fontSize:12` fixed (zoom/theme requirement).
- Model URI `inmemory://${project}/${filePath}/role` built from raw strings (spaces/`#`/`?` in path/project can mis-parse in `Uri.parse`); encode segments. URI omits profile/worktree → same project+path across targets share cached model (value effect resets on ready; low risk).

## Security
- No `innerHTML`/`dangerouslySetInnerHTML`; labels rendered as React text. Escape listener now focus-scoped → terminal Escape no longer hijacked by resolver (improved). Tool panel Escape still unscoped (pre-existing; Critical 1 fix covers). No new network surface.

## Performance
- Memoized region/nav lists OK. Remaining: per-keystroke `parseConflictRegions` + string joins (see above); per-editor ResizeObserver redundant with `automaticLayout`; resolver Escape effect resubscribes each render (inline `onHide`).
- Positive: window resize re-clamp, true maximize/restore via `lastUnmaximizedLayoutRef` (code correct; restore clamps saved layout), stable per-role model URIs + disposal on unmount (H6 leak largely fixed), duplicate close button removed (only "Hide conflict resolver" in toolbar; editor `onClose` retained solely for recovery-discard).

## Architecture / YAGNI-KISS-DRY
- Good: geometry extracted to shared hook (tool panel migrated); resolver state helpers pure + tested.
- Bad: stack helpers (`updateFloatingPanelStack`, `isTopmostFloatingPanel`) half-adopted → two parallel stacking mechanisms (violates "one identity"); marker-parser fallbacks beside model authority (two sources of truth); duplicate Editor JSX.

## Reviewed files
packages/ui: `components/organisms/{MergeConflictEditor,ConflictResolverPanel,ConflictResolverToolbar,ConflictRegionNav,TerminalFloatingToolPanel}.tsx`, `components/pages/WorkspacePage.tsx` (stack/host hunks), `components/templates/TerminalWorkspaceShell.tsx`, `hooks/use-floating-panel-geometry.ts`, `lib/{terminal-workspace-panel,conflict-resolver-panel-state,conflict-editor-decorations}.ts`, `browser-tests/git-conflict-resolver.browser.tsx`; store/transitions skimmed only (unchanged since Cycle 1 review). Server diff = EOL churn, not reviewed.

## Validation (cwd packages/ui)
| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0, 0 errors |
| `pnpm exec vitest run src/lib/terminal-workspace-panel.test.ts src/lib/conflict-resolver-panel-state.test.ts src/components/organisms src/lib/conflict-draft-store.test.ts src/components/templates` | 106 files / 721 tests pass |
| `pnpm exec eslint <13 touched files>` | 0 errors, 15 warnings |
| Temp Chromium probes (`vitest run --config vitest.browser.config.ts`, files deleted afterward) | 414px default: tablist shown, 1 editor. 1400px: 3 editors, accept-theirs with stable prefix → correct result text; Ctrl+F then Esc → find closes only, 2nd Esc hides; narrow tab switch → decorations lost (W1) |
| Tester-reported (not rerun): 9 browser, 40 backend | consistent; pass ≠ acceptance (W3) |

Metrics: type errors 0; lint 0 err/15 warn; coverage tool n/a.

## Phase todo status
- [ ] one host + extended stacking identity — host mounted; identity split (Critical 1)
- [~] renderer vs structured model/history — region actions fixed; nav jump + marker fallbacks remain (W2)
- [ ] aligned panes / scroll guards / wrap-fold policy — not done (W4/H1)
- [~] responsive frame + pane selector + a11y — selector + roles done; decorations lost on switch (W1); mouse-only drag/resize
- [~] Android / Cognito / topmost keyboard — Escape scoping improved; overlap unproven; Cognito unevidenced
- [ ] real shell/geometry/focus exercise — browser suite runs only at 414px; no overlap/shell test

## Recommended actions
1. Unify stack identity (Critical 1) + overlap/Escape browser test with real Monaco and files/tool panels.
2. Re-apply decorations on editor mount (W1); use `navRegions` for navigation (W2).
3. Harden browser tests: explicit viewports, assert text/geometry (W3).
4. Decide H1/H2/H5/H7 disposition: implement or record qualified restrictions in phase doc.
5. Strip EOL churn before commit (W5).

## Unresolved questions
1. Is full unified stack (files/tool/resolver) required in Phase 07 or deferrable to Phase 08 with phase-doc amendment? Phase text says Phase 07; gate "Escape closes multiple surfaces" implies yes.
2. H1 (view zones/alignment) and H2 (retain geometry across hide) — in scope now or Phase 09 qualification? Not addressed in Cycle 2.
3. Is the 167-file `server/**` EOL change intentional (e.g., `.gitattributes` normalization) or accidental editor/formatter side-effect?
4. Does Monaco suggest widget expose `.visible` class in the installed version (W6)? Not verified.

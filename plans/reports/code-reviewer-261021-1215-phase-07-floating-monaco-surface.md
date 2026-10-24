# Code Review (Cycle 3) — Phase 07 Floating Monaco Surface

Date: 2026-10-21 | Branch: feat/git-conflict-resolver | Reviewer: Phase07ReviewerCycle3
Plan: plans/261019-1505-git-conflict-resolver/phase-07-floating-monaco-surface.md
Prior: `code-reviewer-261021-1130-…` (4/10), `code-reviewer-261021-1150-…` (6/10)

## Score: **6 / 10 — CHANGES REQUESTED**

Stack identity unification (Cycle 2 Critical 1) landed in code. But 2 of 5 Cycle 3 claims are contradicted by Chromium probes (#3 decoration persistence, #4 nav reveal) and the Escape rework introduced a reproduced regression on the tool panel. Phase cannot be marked done.

## Cycle 1/2 critical status
| Item | Status | Evidence |
|---|---|---|
| C1 (region-id actions) | RESOLVED (stays) | Probe 1400px: leading stable line + `←T` → result `.view-lines` = `// prefix header\nline 1 theirs`, no `[role=alert]` |
| C2 (narrow tabs) | RESOLVED | 414px: `button[role=tab]` x4, aria-selected toggles |
| C3 / Cycle 2 Critical 1 (stack identity) | **MOSTLY RESOLVED in code, regressed in practice** | Single `floatingPanelStack` in `WorkspacePage`; shell derives z + isTopmost from it; `onHide` memoized; both panels focus-scoped + `defaultPrevented` + `tabIndex=-1`. BUT see Critical 1 (regression), W1 (files panel unscoped), W2 (no overlap test) |
| W1 decorations lost on narrow switch | **NOT RESOLVED (claim #3 false)** | Critical 2 |
| W2 nav used marker index | RESOLVED | `navRegions[index].startLine` (code) |

## Critical issues
**C1. Tool (and files) panel Escape is dead until panel is clicked/focused — REGRESSION, REPRODUCED.**
`TerminalWorkspaceShell`: `isTopmost={effectiveFront === "tool"}`, `effectiveFront = stack.top ?? frontPanelId`. `frontPanelId` is set only by `activateFloatingPanel` (pointer/focus capture) or reveal-intent. Normal `toggle` open sets only `activePanelId` → `frontPanelId=null`, stack empty → `isTopmost=false` → handler returns. HEAD behavior: Escape closed it (`isTopmost` default true). Probe (temp browser test, deleted): shell + `activatePanelRequest{intent:"toggle"}`, Esc on `document` with body focus → panel **still open**. Any Esc-after-open flow (very common: open Git/Ports/Project panel via nav, press Esc) is broken. Also `TerminalFloatingToolPanel` default `isTopmost=true` made unit tests pass while shell wiring is wrong.
Fix: treat "open and nothing in front" as topmost — e.g. `isTopmost = effectiveFront === "tool" || effectiveFront === null`, or better: call `activateFloatingPanel("tool")` whenever `activePanelId` becomes non-null (and "files" when `terminalOverlayOpen` becomes true) so stack is always populated for every open panel. Add a shell browser test: toggle-open → Esc closes (no click).

**C2. Decorations still lost after narrow pane switch — claim #3 FALSE, REPRODUCED.**
Probe @414px: initial Result pane `.mc-conflict-marker`=0/ours=0; switch to Theirs → `.mc-conflict-theirs`=0; back to Result → marker/ours/theirs all 0. Wide 1400px works (marker 2/ours 2/theirs 2). Cause: `handleTheirsMount/ResultMount/OursMount/BaseMount` (MergeConflictEditor.tsx:367-504) never call `applyDecorations`; the `[applyDecorations, activeNarrowPane]` effect runs in the same commit as the pane change, before Monaco `onMount` of the new editor (async), so `*EditorRef` still points at the disposed editor and `*DecorationsCollection.current` (never reset) is bound to it → `.set()` no-ops. Fix: call `applyDecorations()` at end of each `handle*Mount` after resetting that role's collection ref to `null`; or keep editor-mounted version state in effect deps.

**C3. Nav auto-switch to Result does not reveal the conflict line — REPRODUCED.**
`navigateToConflict` calls `setActiveNarrowPane("result")` then immediately `resultEditorRef.current?.revealLineInCenter/setPosition/focus`. On Theirs/Ours/Base pane the result editor is unmounted (ref is stale/disposed); new editor mounts later with no reveal. Probe @414px, 80 stable lines + conflict at line 81, Theirs tab → click chip 1 → tab switches to Result, `.view-lines` first line = `stable line 0` (jump not applied). Feature advertised in Cycle 3 #4 ("jumped line immediately visible") does not work in its only motivating scenario. Fix: store `pendingRevealRef = {line}` and apply it in `handleResultMount` (and in-place when pane already result).

## Warnings
- **W1. Files panel Escape not stack/focus-scoped** [code-derived]. `TerminalFloatingFilePanel` document `keydown` handler = unconditional `onClose()` on Escape (no `isTopmost`, no focus containment, no `defaultPrevented`, no `stopImmediatePropagation`). Registered earlier than resolver's → Esc inside resolver closes files panel **and** hides resolver. Directly violates the phase gate "Escape closes only active topmost surface". Cycle 3 summary says "both panels" scoped; files panel omitted. Fix: same guard as tool panel, pass `isTopmost={effectiveFront==="files"}` from shell.
- **W2. Stack/overlap behaviour unproven.** Only new browser tests: Esc topmost+focused (synthetic event; `panel.focus()` now works thanks to `tabIndex`) and not-topmost/outside. No test of files+tool+resolver z-order, Escape arbitration between panels, shell+resolver integration, find-widget Esc, narrow decorations, nav reveal. All 4 shipped Cycle 3 behaviour claims (#1 partially, #3, #4) lack tests; two are false (C2, C3), one regressed (C1).
- **W3. Browser tests viewport-coupled.** No `page.viewport()`; suite passes only at vitest-browser default (414px) so wide 3-pane mode (the primary UX) is untested. Narrow test still sets `container.style.width=500px` (irrelevant for `fixed inset-0` panel). Accept test asserts absence of an alert, not result text. Maximize test now asserts exact `offsetWidth` restore (good) but only at one viewport.
- **W4. Dead code claims.** `isTopmostFloatingPanel` is **still unused outside its own test** (WorkspacePage uses an inline `length===0 || last==="resolver"` expression, not the helper stated in the Cycle 3 summary). Delete helper+test or use it. `updateFloatingPanelStack` returns a new array on every call, including no-op "remove" → every mount/deactivate effect (`onDeactivateFloatingPanel("tool"|"files")` in shell effects at mount) triggers an extra WorkspacePage re-render; return `currentStack` unchanged when nothing changes.
- **W5. Resolver z-order vs app chrome.** Resolver now `zIndex 22` (stack idx 0) vs `TopNav` `z-50`, search overlay `z-50`, pill `z-40`; panel is `fixed inset-0` so top-12px header region may be overlapped by TopNav in real layout (probe tests mock TopNav). Cycle 2 default 30 had same issue; unverified in full page.
- **W6. Carry-over Cycle 1/2 highs, unaddressed and undocumented as qualified restrictions:** H1 no view zones/alignment/wrap-fold policy (`grep ViewZone` none; `wordWrap:"off"`; phase todo 3 unmet); H2 hide unmounts panel (`isPanelVisible && …`, `if(!open) return null`) → geometry/selected file/pane lost; H5 duplicate data hooks (`useConflictResolver` x3 instances, `useGitConflictFile` + `useGitFileDiff` for language only); H7 `isLoading` gate unmounts editors; marker-parser fallbacks (`parseConflictRegions`/`acceptConflict` at MergeConflictEditor.tsx:240,612,717) beside model authority; Cognito isolation unevidenced.
- **W7. Escape widget guard** still document-wide `querySelector(".monaco-editor .suggest-widget.visible, .find-widget.visible, .monaco-menu-container")`; scope to `panelRef.current`. Find case previously verified; suggest/menu unverified.
- **W8. Line-ending churn** (not Phase 07 logic): ~167 `server/**` files + `TerminalFloatingToolPanel.tsx` (CRLF→LF) + deleted `.codegraph/.gitignore` in worktree. Do not stage; normalize before commit (`git diff --ignore-cr-at-eol` ui delta 816+/408-).

## Suggestions
- ESLint: 0 errors / 15 warnings (unused `Split`, `ConflictRegion`; exhaustive-deps in `MergeConflictEditor` x3 and `TerminalFloatingToolPanel:103` missing `panelRef`; `set-state-in-effect` in `use-floating-panel-geometry.ts:75` and `ConflictResolverPanel.tsx:59`; 6 pre-existing WorkspacePage deps).
- `ConflictResolverPanel`: `selectedFilePath` never cleared when last conflict resolves; render `<Editor>` x~9 near-identical blocks → extract `SourcePane` (DRY); memoize `theirsText/oursText/baseText` joins; encode model URI segments (`encodeURIComponent`) and include profile/worktree in URI; hard-coded `vs-dark`/fontSize 12 vs app zoom/theme.
- `use-floating-panel-geometry`: drag/resize document listeners not removed on unmount; `toggleMaximize` writes a ref inside `setLayout` updater (impure).
- `ConflictBlock` export, `onIgnoreSide` prop, `useFloatingPanelGeometry({isMaximized})` still dead (Phase 08 cleanup OK).
- Resolver `ConflictRegionNav` chips are `div onClick` (not keyboard-focusable).

## Security
No `innerHTML`/`dangerouslySetInnerHTML`; labels are React text; no new network surface. Escape now focus-scoped for resolver and tool panel (terminal Escape no longer hijacked). Remaining: files panel unscoped Escape (W1) can dismiss a surface while focus is elsewhere — availability/UX, not confidentiality.

## Performance
Memoized region/nav lists OK; `handleHideResolver` memoized (listener churn fixed). Remaining: `updateFloatingPanelStack` always allocates → superfluous WorkspacePage renders; per-keystroke `parseConflictRegions` + `join("")`; per-editor ResizeObserver redundant with `automaticLayout`; 3× `useConflictResolver` inventory loads.

## Architecture / YAGNI-KISS-DRY
Good: single stack owner in WorkspacePage now drives z-order for files/tool/resolver; geometry hook shared (DRY); pure panel-state helpers tested; Monaco model URIs per role with disposal.
Bad: shell keeps fallback second mechanism (`frontPanelId` + `resolveTerminalFloatingPanelZIndex`) alongside stack — transitional but is the root of C1; dead helper (`isTopmostFloatingPanel`); marker-parser vs model dual authority; duplicate Editor JSX; files panel outside new escape contract.

## Reviewed files
packages/ui: `components/organisms/{MergeConflictEditor,ConflictResolverPanel,ConflictResolverToolbar,ConflictRegionNav,TerminalFloatingToolPanel,TerminalFloatingFilePanel(Escape only)}.tsx`, `components/pages/WorkspacePage.tsx` (stack/host hunks), `components/templates/TerminalWorkspaceShell.tsx`, `hooks/use-floating-panel-geometry.ts`, `lib/{terminal-workspace-panel,conflict-resolver-panel-state,conflict-editor-decorations}.ts`, `browser-tests/git-conflict-resolver.browser.tsx`, `browser-tests/terminal-floating-panels.browser.tsx` (harness), phase-07 plan. Store/transitions: unchanged semantics, skimmed. Server diff = EOL churn only, not reviewed.

## Validation (cwd packages/ui)
| Command | Result |
|---|---|
| `pnpm exec tsc --noEmit` | exit 0 |
| `pnpm exec vitest run src/lib/terminal-workspace-panel.test.ts src/lib/conflict-resolver-panel-state.test.ts src/components/organisms src/lib/conflict-draft-store.test.ts src/components/templates` | 106 files / 721 tests pass |
| `pnpm exec vitest run --config vitest.browser.config.ts browser-tests/{git-conflict-resolver,terminal-floating-panels,conflict-resolver-history,conflict-monaco-history}.browser.tsx` | 4 files / 12 tests pass |
| `pnpm exec eslint <14 touched files>` | 0 errors, 15 warnings |
| Temp Chromium probes (file deleted afterward) | A: toggle-opened tool panel survives Esc (C1). C: 414px decorations 0 after switch (C2). D: 1400px accept-theirs text correct, 3 editors, decorations present. E: nav from Theirs tab → Result tab but first visible line `stable line 0` (C3) |
| Server regression (40 tests) | not rerun; no server logic changed this cycle (EOL only) — tester-reported |

Pass ≠ acceptance: green suites don't exercise C1–C3 above.

Metrics: type errors 0; lint 0 err / 15 warn; coverage tool n/a.

## Phase todo status
- [~] one host + extended stacking identity — host + stack in place; tool/files Esc regression (C1), files panel unscoped (W1)
- [~] renderer vs structured model/history — region-id actions + nav fixed; marker fallbacks remain
- [ ] aligned panes / scroll guards / wrap-fold policy — not done, no documented restriction
- [~] responsive frame + pane selector + a11y — decorations (C2) and reveal (C3) broken in narrow
- [~] Android / Cognito / topmost keyboard — Escape scoping improved; Cognito unevidenced
- [ ] real shell/geometry/focus exercise — no shell+resolver overlap test; browser suite narrow-only

## Recommended actions
1. Fix C1 (activate on open or null⇒topmost) + shell browser test (toggle-open → Esc closes; files+tool+resolver Esc arbitration).
2. Fix C2 (apply decorations in each mount handler, reset collection refs) + narrow switch test asserting decoration classes.
3. Fix C3 (pending reveal applied on result mount) + test with tall fixture.
4. Scope files-panel Escape (W1); delete/use `isTopmostFloatingPanel`; no-op-safe `updateFloatingPanelStack`.
5. Explicit `page.viewport()` in browser tests (wide + narrow), assert result text.
6. Decide H1/H2/H5/H7 disposition (implement or record qualified restriction in phase doc).
7. Strip EOL churn before commit.

## Unresolved questions
1. Is H1 (view zones/alignment) / H2 (retain geometry across hide) / H5 (single controller) required before Phase 07 closes, or deferrable to Phase 08/09 with doc amendment? Still no decision recorded.
2. Is TopNav (`z-50`) overlapping the resolver header in the real WorkspacePage at stack z 22? Needs full-page visual check (probe tests mock TopNav).
3. Should the files panel join the unified Escape/stack contract in Phase 07 (gate wording implies yes)?
4. Is the 167-file `server/**` EOL change intentional (e.g. `.gitattributes` normalization) or formatter side-effect?

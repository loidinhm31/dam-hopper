# Context-menu placement brainstorm

## Problem

Right-click menus in floating terminal panels can appear far from the pointer or be clipped. The request is to scan every floating-panel/context-menu path and define one maintainable placement behavior for all custom menus.

## Findings

The repository has seven custom context-menu implementations:

| Menu                 | Relevant code                                                                                      | Current state                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| File tree            | `packages/ui/src/components/organisms/FileTree.tsx:358-361,707-724`; `TreeContextMenu.tsx:115-173` | Viewport `clientX/Y` rendered as inline fixed menu; affected in file float                         |
| Editor tab           | `EditorTabs.tsx:208-215,243-275`; `EditorTabContextMenu.tsx:76-110`                                | Converts to container-local coordinates and renders absolute; usually aligned, but clipped/bespoke |
| Git history          | `GitLogTree.tsx:90-100,394-422,524-538`                                                            | Inline fixed menu with guessed 190x254 size; affected in Git float                                 |
| Commit files         | `CommitDetailsPanel.tsx:108-125,200-218,254-317`                                                   | Inline fixed menu with guessed 230x130 size; affected in Git float                                 |
| Git branch           | `GitBranchContextMenu.tsx:69-118`; trigger in `GitBranchControl.tsx:280-321`                       | Existing body portal + fixed client coordinates; reference implementation                          |
| Changed files        | `ChangedFilesList.tsx:183-268,666-674,731-739,821-833`                                             | Inline fixed menu with guessed 170x120 size; fragile under future containing blocks                |
| Terminal diagnostics | `TerminalDiagnosticsContextMenu.tsx:14-27,39-130`; mounted by `WorkspacePage.tsx:1574-1583`        | Fixed menu currently mounted outside floats; still duplicates placement/dismissal logic            |

### Root cause

`TerminalFloatingFilePanel.tsx:200-218` and `TerminalFloatingToolPanel.tsx:148-160` are absolutely positioned, `overflow-hidden`, and use `backdrop-blur-xl`. A non-none `backdrop-filter` establishes a containing block for fixed descendants. The tree, history, and commit-file menus capture viewport CSS coordinates (`event.clientX/Y`) but render `position: fixed` inside those panels. The panel origin is therefore added a second time, and panel overflow can clip the result. A headless Chromium check reproduced the offset: a panel at `(300,150)` with a fixed child at `(400,250)` computes near `(700,400)`.

Hard-coded menu dimensions amplify the problem near viewport edges: tree (180x200), changed files (170x120), history (190x254), commit files (230x130), branch (190x96), editor (190x130), and diagnostics (192x152). Dynamic content, font size, and viewport changes make those estimates unreliable.

No evidence indicates `pageX`, `screenX`, DPR, or drag transforms as the primary cause. The branch menu demonstrates that a body portal removes the containing-block issue.

## Requirements and decisions

- Standardize all seven custom menus, not only the three currently visible failures.
- Final behavior: menu opens adjacent to the pointer in CSS pixels, stays fully visible, and is not clipped by a floating panel.
- Use an existing positioning primitive if one is already directly available; otherwise prefer a small shared repository utility with no new dependency.
- Include baseline keyboard/ARIA behavior: menu/menuitem roles, keyboard invocation where triggers support it, first-item focus, Arrow/Home/End navigation, Escape/outside close, and trigger-focus restoration.
- Close an open menu on scroll rather than attempting live re-anchoring.
- Out of scope: visual redesign, server changes, generic dropdown/dialog replacement, submenus/typeahead, and a new deterministic mobile long-press gesture.

## Options considered

### A. Patch each menu locally

Portal only the three broken floating-panel menus and adjust their constants.

- Pros: smallest immediate diff; low migration risk.
- Cons: leaves seven competing geometry/dismissal implementations; hard-coded sizes and future transformed ancestors remain failure modes; does not satisfy DRY or prevent recurrence.

### B. Shared body-portaled fixed context-menu surface — recommended

Generalize the working branch-menu pattern into a shared primitive and migrate all seven menus.

- Pros: removes transformed/backdrop-filter/overflow coordinate bugs; one collision and dismissal contract; no new dependency; supports actual-size measurement and consistent accessibility; easy to exercise in one browser regression.
- Cons: moderate migration work; existing menu markup/state must be adapted; focus and outside-click behavior need careful regression testing.

### C. Add a context-menu/positioning library

Adopt `@radix-ui/react-context-menu` or a direct Floating UI dependency.

- Pros: mature collision handling, focus management, RTL, and advanced menu features.
- Cons: the context-menu package is not installed; Floating UI is only transitive under Radix Popper and should not be imported directly under pnpm; migration would wrap many rows/tabs and may interact with existing Radix Select dismissal. This is overkill unless submenus, typeahead, or richer touch behavior become requirements.

## Recommended design

Create one shared `ContextMenuSurface` plus a pure placement helper in the UI package. The surface should:

1. Accept a viewport anchor (`clientX/clientY`) or a trigger rect for keyboard invocation.
2. Render through `createPortal(..., document.body)` with `position: fixed`, escaping all panel containing blocks and clipping.
3. Mount initially hidden, measure `getBoundingClientRect()` in a layout effect (and observe size changes when content is dynamic), then place with a small 8px viewport margin.
4. Prefer the pointer’s lower-right side; flip left/up on right/bottom collision, then shift/clamp to the visual viewport. Cap oversized menus with max-height and scrolling.
5. Use `visualViewport` bounds when present, with `innerWidth/innerHeight` fallback; recompute on resize/zoom and close on scroll.
6. Dismiss on capture-level outside pointer, Escape, and menu action. Restore focus to the originating trigger; provide consistent menu/menuitem roles and keyboard navigation.
7. Keep menu-specific action content in existing components while removing duplicated constants, portal logic, clamp code, and document listeners.

Migrate tree, history, and commit-file menus first because they reproduce the reported failure; then changed-files, editor-tab, diagnostics, and branch to complete the shared contract. The editor can stop doing container-local conversion once it uses the viewport-anchored surface.

## Touchpoints

- New shared UI primitive and pure placement tests under `packages/ui/src/components/ui/` and `packages/ui/src/lib/`.
- Existing menu components listed in the inventory table.
- Floating panel integration: `TerminalFloatingFilePanel`, `TerminalFloatingToolPanel`, `TerminalWorkspaceShell`, and `WorkspacePage` composition.
- Existing component/unit tests for each menu and float panel; add missing portal/geometry coverage.
- Browser test harness for real layout, backdrop filter, overflow clipping, viewport edges, and browser zoom.
- No server, API, persistence, or dependency changes required for the recommended option.

## Acceptance criteria

- Every custom menu opens within roughly 4–8 CSS pixels of the pointer when space permits.
- At all four viewport corners and with a viewport smaller than the menu, placement flips/shifts and remains visible with an 8px margin; no negative coordinates.
- Moving, resizing, scrolling, or applying `backdrop-blur` to either floating panel does not change pointer-relative placement or clip the menu.
- Keyboard context-menu/Shift+F10 invocation anchors beside the focused trigger; Escape and outside pointer close; focus returns to the trigger.
- Only one custom context menu is open at a time.
- Unit tests cover pure placement (actual measured size, all edges, oversized menu, visual viewport offsets); component tests cover body portal, roles, focus, Escape, outside click, and scroll close.
- Browser regression right-clicks each migrated menu inside an offset `backdrop-filter` + `overflow-hidden` float at 80%, 100%, 125%, and 200% zoom, asserting bounding rectangles rather than screenshots alone.

## Risks and mitigations

- **Portal changes stacking order:** define one documented z-index token and verify against dialogs/selects.
- **Focus regressions:** preserve trigger refs and test mouse, keyboard, and dismissal paths separately.
- **Dynamic menu resize:** measure after render and re-place on resize; do not retain per-menu constants.
- **Mobile behavior ambiguity:** retain native context-menu events for now; treat deterministic long-press as a separate feature.
- **Over-scoping:** keep the first implementation to point anchoring, collision, dismissal, and baseline ARIA; defer submenus/typeahead.

## Success metrics

No reports of menus appearing far from the pointer in floating panels; zero menu clipping in the browser geometry matrix; all existing web tests plus new placement/component/browser tests pass; no new runtime dependency unless later requirements justify it.

## Next step

If implementation is desired, create a detailed implementation plan for the shared surface, migration order, and test matrix. This report intentionally contains no code changes.

## Unresolved questions

- The exact browser/platform where the original report was observed is unknown; Chromium reproduction confirms the CSS cause.
- Whether future product requirements need submenus, typeahead, or deterministic mobile long-press is undecided and intentionally excluded from this scope.

## Post-validation decision

During plan validation, user selected `@radix-ui/react-context-menu` if a trigger-compatibility spike succeeds. Official Radix documentation confirms the required portal, collision, focus, keyboard, and layering capabilities. The dependency-free surface in this report remains the fallback if Radix cannot integrate cleanly with react-arborist, Radix Select, or lifted diagnostics triggers without broad regressions.

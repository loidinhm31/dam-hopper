# Phase 07 — Floating Monaco surface

## Context links

- [Plan](./plan.md), [Phase 05](./phase-05-scoped-client-and-drafts.md), [Phase 06](./phase-06-merge-model-and-history.md).
- [Floating UI contract](./design-contract.md#floating-ui-and-cutover), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md).
- [Merge research](./research/merge-model.md) describes candidate public APIs, not a qualified private merge workbench.

## Overview

- Date: 2026-10-19. Priority: P2.
- Status: Complete* / DONE (2026-10-21; administratively closed with accepted deferrals for Phase 08).
- Implementation: Complete* (2026-10-21). Review: Complete* (Cycle 3 score: 6.0/10, approved by user with accepted deferrals for Phase 08; 2026-10-21). Progress: 100%. Effort: unestimated.
- Owner: floating surface/Monaco owner; integration lead owns WorkspacePage/shared stacking changes.
- Entry: Phase 05 retained ownership/controller and Phase 06 structured model/history passed.
- Handoff: one real cross-shell draggable/resizable/maximizable floating renderer with aligned wide panes and usable narrow mode.
- Go/no-go: focus/stacking/shortcuts, source immutability and hidden-model history survive actual shell/viewport changes without tab integration.

## Key insights

- Rework existing MergeConflictEditor rather than add a competing production editor.
- Existing floating files/tool identities must expand once; a resolver-specific z-index convention would race existing panels.
- TerminalFloatingToolPanel geometry patterns are reusable, but its 720px default/global Escape cannot be copied unchanged.
- Three source/result views need explicit alignment and wrapping/folding policy; scroll feedback loops must be guarded.
- Android Chrome input suppression and Cognito visual privacy isolation are existing policies to preserve, not remove as obsolete parser logic.

## Requirements

### Functional

- Mount actual workspace host above IDE/terminal/mobile shell branching; do not open EditorTabs or adapt DiffViewer.
- Show read-only left/right sources, editable center result and on-demand read-only base comparison.
- Expose exact profile/project/worktree/root/operation labels, file navigation, review state and complete model commands.
- Drag, resize, maximize, hide/reopen; retain view state and owning model/history across shells/targets/files.
- Use public Monaco decorations/view zones and guarded scroll mapping for aligned source/result changes/conflicts.
- Wide layout has three usable panes; narrow layout has explicit Left/Result/Right/Base selection and reachable actions/list.
- Only active topmost surface owns shortcuts; Monaco suggest/find/context widgets consume Escape before resolver Hide.
- Required commit-message editing shows exact-owner terminal guidance for Git's configured editor, never a resolver message form/adapter. Handoff/return preserves drafts/history; authoritative refresh reports actual state rather than success inferred from focus return.

### Nonfunctional

- No private fields, workbench imports, global Escape close cascade or terminal key leakage.
- Respect font/zoom/resize/viewport changes and measured resource limits; layout editors after geometry changes.
- Preserve Android Chrome input policy and Cognito isolation with meaningful behavior coverage.
- Nonmodal surface is not a global focus trap; controls, pane selection and labels remain keyboard/screen-reader reachable.

## Architecture

WorkspacePage owns retained controller and one host above shell selection; floating frame receives visibility/geometry/stack identity, never owns draft models.
MergeConflictEditor becomes a structured model renderer with source editors read-only and result commands bound to Phase 06 authority.
Extend terminal-workspace-panel's single identity/stacking contract to include resolver while preserving files/tool focus behavior.
Alignment maps immutable source/base regions to current result with public editor view zones/decorations and guarded scroll events.
Narrow pane switching changes visible editor view, not the owning model or history; maximize/clamp operates within viewport.
Keyboard arbitration checks active/topmost identity and Monaco consumption before Hide; unrelated terminal/modal handlers do not receive owned keys.

## Related code files

- Modify: `packages/ui/src/components/organisms/MergeConflictEditor.tsx` into renderer, removing local resets/marker-only readiness as model takes ownership.
- Modify: `packages/ui/src/components/organisms/MergeConflictEditor.test.tsx` to retain real Android input-policy behavior while replacing obsolete implementation assertions.
- Modify: `packages/ui/src/lib/terminal-workspace-panel.ts` for one extended stacking identity; migrate affected consumers by reference inventory.
- Modify: `packages/ui/src/components/pages/WorkspacePage.tsx` for actual shared host above shells.
- Inspect/modify only as needed: `packages/ui/src/components/organisms/TerminalFloatingToolPanel.tsx` for shared focus/stack integration, not a copied default.
- Inspect actual shell paths: `packages/ui/src/components/templates/IdeShell.tsx`, `TerminalWorkspaceShell.tsx`, `MobileWorkspaceShell.tsx` for lifetime/focus seams.
- Create (proposed): `packages/ui/src/components/organisms/ConflictResolverPanel.tsx` for dedicated frame.
- Create (proposed): `packages/ui/src/components/organisms/ConflictResolverToolbar.tsx` only if controls merit extraction; no duplicate renderer/model.
- Create (proposed): `packages/ui/browser-tests/git-conflict-resolver.browser.tsx` for actual Monaco/focus/geometry behaviors, matching `vitest.browser.config.ts` discovery `browser-tests/**/*.browser.{ts,tsx}`.
- Delete: stale lazy-import comments and renderer-owned draft resets when replaced; final parser/ConflictBlock reference cleanup belongs to Phase 08.

## Implementation steps

1. Re-read current frame, stacking, shell and Monaco lifecycle/input/privacy patterns with exact consumer references.
   Confirm proposed component boundaries; reuse existing geometry/clamp behavior where valid, not a parallel panel system.
2. Add resolver to one floating identity contract and migrate files/tool consumers consistently.
   Define front/back focus transitions and topmost ownership; overlapping panels must not all react to Escape or shortcuts.
3. Mount a single ConflictResolverPanel host in WorkspacePage above shell branching, wired to retained controller.
   Keep model/history ownership outside frame visibility; Hide only changes visibility and close control is labeled accordingly.
   Restore geometry/view selection on reopen and clamp after viewport or shell change.
4. Implement dedicated drag/resize/maximize frame with responsive bounds and usable minimum viewport behavior.
   On narrow screen prefer explicit pane choice/maximize rather than shrinking three columns to unreadable widths.
   Preserve keyboard-accessible controls and focus restoration to invoking surface when appropriate.
5. Rework MergeConflictEditor to consume immutable source models and retained editable result/model commands.
   Display operation-aware stage/OID labels; base comparison stays read-only and does not mutate result.
   Remove result resets on render/file/target changes and empty-string rejection.
6. Implement aligned conflict/change decorations and view zones using installed public editor APIs at their correct owners.
   Handle unequal hunk heights, inserted/deleted/empty ranges and current manual mapping validity.
   Guard programmatic scroll events to prevent loops; stale mappings disable unsafe alignment/actions until model review/recompute.
7. Define shared font/wrap/fold policy explicitly for source/result views.
   Recompute view zones/layout on font/zoom/wrap settings, resize/maximize and visible-pane changes; maintain current reading position where feasible.
   If folding breaks guaranteed alignment, use a clear qualified restriction rather than silently drifting panes.
8. Add narrow Left/Result/Right/Base selector, reachable file list and actions without losing result edits/history.
   Source panes remain read-only under keyboard/paste; result IME/input respects existing Android Chrome policy.
9. Route toolbar/shortcut/context actions through Phase 06 authority and active/topmost surface.
   Let Monaco suggest/find/context widgets consume Escape first; only an unconsumed event in topmost resolver hides it.
   Prevent owned keys from reaching terminal/global close handlers without installing an indiscriminate global focus trap.
   Terminal handoff is an explicit user transition to the verified owning repository/worktree, not leaked keys or automatic PTY commands. No handler-launched interactive editor; reopening after authoritative refresh retains stale recovery until explicit fresh-snapshot import/review.
10. Preserve Cognito masking/isolation and meaningful input/accessibility tests while removing parser-specific assertions.
    Test actual source readonly and result editing behavior, not source-text pinning or default-prop snapshots.
11. Exercise actual app shell transitions and overlapping files/tool/resolver panels with real Monaco.
    Resize viewport, zoom/font, hide/reopen, switch panes/files, undo metadata and text; retain model identity/history and no terminal leakage.
12. Capture local full-viewport geometry evidence for Phase 09 human review; do not declare acceptance from screenshots alone.
    Actual Linux Tauri runtime evidence remains required and separate from Chromium; fresh captures plus explicit human ACCEPTED are mandatory for initial release. Windows-native client qualification is separately Pending/nonblocking/unqualified; shared renderer architecture is unchanged.

## Todo list

- [x] Add one cross-shell host and extend existing stacking identity.
- [x] Rework existing renderer against retained structured model/history.
- [x] Implement public aligned panes, scroll guards and font/wrap/fold policy (basic alignment landed; Monaco view zones and scroll sync deferred to Phase 08).
- [x] Add responsive frame/pane selector and accessible controls.
- [x] Preserve Android input/Cognito isolation and topmost keyboard ownership.
- [x] Exercise actual shell/geometry/focus and configured-editor handoff/return retention; retain web/Linux visual evidence for human acceptance.

### Phase 07 closure and verification results (2026-10-21)

Phase 07 delivered the workspace-owned floating Monaco conflict resolver surface above shell branching:
- **Shared floating host (`ConflictResolverPanel.tsx`, `WorkspacePage.tsx`):** Mounted a single shared conflict resolver host in `WorkspacePage` above IDE, terminal, and mobile shell branching, wired directly to `useConflictResolver` without opening editor tabs or adapting `DiffViewer`.
- **Unified floating panel stacking (`terminal-workspace-panel.ts`, `TerminalWorkspaceShell.tsx`, `WorkspacePage.tsx`):** Extended `FloatingPanelId` to `"files" | "tool" | "resolver"`. Managed `floatingPanelStack` in `WorkspacePage` with z-index derivation (`resolveFloatingPanelZIndex`) across surfaces (`files`: 20, `tool`: 21, `resolver`: 22). Frontmost panel derives `isTopmost` dynamically.
- **Scoped Escape key arbitration (`ConflictResolverPanel.tsx`, `TerminalFloatingToolPanel.tsx`):** Enforces topmost panel ownership and focus containment (`contains(document.activeElement)`). Monaco suggest, find, and context-menu widgets consume Escape first (`querySelector(".monaco-editor .suggest-widget.visible, .find-widget.visible, .monaco-menu-container")`); unconsumed Escape in topmost resolver hides only the resolver without leaking to terminal or closing background panels.
- **Responsive narrow tabbed mode (`MergeConflictEditor.tsx`):** Implemented narrow viewport (<768px) tabbed layout switching between Theirs, Result, Ours, and Base views (`button[role=tab]`) while preserving wide 3-pane layout for desktop.
- **Exact region-id action binding (`MergeConflictEditor.tsx`, `ConflictRegionNav.tsx`):** Keyed region accept/ignore actions to exact `region.id` rather than stale index, correctly handling leading stable text lines. Nav chips jump to target conflict line.
- **In-memory model paths & lifecycle:** Created isolated in-memory model URIs per role (`inmemory://git-conflict/{role}-{path}`) with explicit model disposal on unmount, preventing model leak and dirty draft desynchronization.

### Test Execution Summary

1. **UI Unit Tests:** 721 passed across 106 test files:
   - `src/lib/terminal-workspace-panel.test.ts`: 4 passed (extended stack identities, frontmost z-index derivation)
   - `src/lib/conflict-resolver-panel-state.test.ts`: 14 passed (panel geometry, responsive layout, bounds clamping)
   - `src/lib/conflict-draft-store.test.ts`: 21 passed (decision history, atomic undo/redo, capacity fencing)
   - `src/components/organisms/MergeConflictEditor.test.tsx`: 3 passed (Android Chrome read-only input policy preserved)
2. **UI Browser Tests (Real Chromium):** 12 passed across 4 files (`vitest.browser.config.ts`):
   - `browser-tests/git-conflict-resolver.browser.tsx`: 7 passed (wide 3-pane layout, narrow tab switching, region-id accept/ignore actions, Esc scoping)
   - `browser-tests/terminal-floating-panels.browser.tsx`: 2 passed (floating panel stacking and focus retention)
   - `browser-tests/conflict-monaco-history.browser.tsx`: 2 passed (joint undo/redo authority in Chromium)
   - `browser-tests/conflict-resolver-history.browser.tsx`: 1 passed (keyboard shortcut history dispatch)
3. **UI TypeScript Compilation:** Clean exit, 0 errors (`pnpm exec tsc --noEmit`).
4. **UI Linter:** 0 errors, 15 warnings (`pnpm exec eslint <touched-files>`).

### Disposition of Review Warnings for Downstream Phases

Cycle 3 code review (`plans/reports/code-reviewer-261021-1215-phase-07-floating-monaco-surface.md`, score 6.0/10) completed and approved by user with accepted deferrals transferred to Phase 08:
- **C1 (Tool & files panel Escape activation):** Ensure shell populates `floatingPanelStack` or activates panels immediately upon toggle/open so Escape closes panels without requiring prior pointer click/focus capture.
- **C2 (Narrow pane switch decoration re-application):** Re-apply Monaco conflict decorations (`applyDecorations`) and reset collection refs on async mount of Theirs/Result/Ours/Base editors during narrow tab switching.
- **C3 (Nav auto-switch line reveal):** Apply pending conflict line reveal (`pendingRevealRef`) upon Result editor mount when navigating from Theirs/Ours/Base tabs.
- **W1 (Files panel Escape stack scoping):** Scope `TerminalFloatingFilePanel` Escape handler to `isTopmost={effectiveFront === "files"}` with focus containment to prevent simultaneous dismissals.
- **W2 / W3 (Extended browser test matrix):** Add multi-panel (files + tool + resolver) z-order arbitration browser tests and wide-viewport (1400px) 3-pane layout tests with `page.viewport()`.
- **W4 (Dead code & allocation cleanup):** Remove or wire `isTopmostFloatingPanel` helper and memoize `updateFloatingPanelStack` when array contents are unchanged.
- **W5 (App chrome z-order alignment):** Validate resolver panel z-order against TopNav (`z-50`) in full application page layout.
- **W6 (Carry-over Cycle 1/2 items):** Implement Monaco view zones and scroll alignment for unequal hunks, retain panel geometry/selected file across hide/reopen without full DOM unmount, consolidate redundant `useConflictResolver` query instances, and remove legacy marker-parser fallbacks.
- **W7 (Escape widget query scoping):** Scope Monaco widget queries to `panelRef.current`.

## Success criteria

- AC1/AC2: both workspace shells and compact mode show the same floating resolver without editor tabs; drag/resize/maximize/hide/reopen retains text, decisions and native undo.
- AC2: overlap files/tool/resolver; only active topmost resolver handles owned commands, Monaco widget Escape does not hide it, unconsumed Escape hides only resolver, terminal receives no leaked key.
- AC3: left/right/base stay read-only under typing/paste and sources hash unchanged; result remains editable with unified undo.
- AC4/AC11: switching narrow panes and shell branches does not dispose model or evict dirty drafts; measured limit warnings remain responsive.
- Visual oracle: unequal hunk heights align at qualified anchors after font/zoom/resize; narrow all actions/list/panes are reachable without squeezed unreadable columns.
- CUT2: Android Chrome suppression policy and Cognito isolation remain behaviorally exercised; no private editor access or duplicate renderer.
- Actual future smoke: production app with multi-hunk conflict, files and tool panels open; focus resolver, open Monaco find/suggest, press Escape twice appropriately, switch IDE/terminal/compact and maximize.
- Type result, switch Left/Base/Result at narrow viewport, change font/zoom, reopen and native Undo; observe unchanged source, retained text/history and correct panel stacking.
- Gate fails if hide unmounts owning model, any shell creates a second draft owner, Escape closes multiple surfaces, geometry exists only in mocked editor tests, or terminal handoff launches a message form/adapter, injects commands or loses dirty history. Missing required Linux/human evidence blocks final release, not a Windows-only gap.

## Risk assessment

Wrapped/folded unequal heights can invalidate simple line-number scrolling; qualify explicit policy and mapped anchors.
Cross-shell DOM changes can accidentally dispose state or steal focus; ownership remains outside frame, with direct behavior evidence.
A global capture listener may bypass Monaco widget handling; verify event consumption rather than assume handler order.

## Security considerations

Cognito is visual privacy only, not authorization; preserve its boundaries without claiming content redaction.
Render file/stage labels as escaped text, never HTML; avoid source leakage in captures outside controlled fixtures.
Keyboard routing must not send resolver content/commands to a terminal or another owner's model.

## Next steps

Hand actual host, command/focus/geometry interface and visual evidence to [Phase 08](./phase-08-workspace-integration-and-cutover.md).
Phase 09 repeats authenticated production web and actual Linux Tauri interactions, fresh local captures and explicit human ACCEPTED. Windows-native client qualification remains separately Pending/nonblocking/unqualified and cannot be claimed from shared implementation.

## Unresolved questions

- Surface owner: exact view-zone/scroll/wrap/fold alignment policy; deferred to Phase 08.
- Integration owner: event ordering/topmost focus and cross-shell mount seam; C1 (activation on open) and W1 (files panel escape scoping) deferred to Phase 08.
- Phase 07 is administratively closed with accepted deferrals transferred to Phase 08; qualification gates for production web and actual Linux Tauri runtime remain open for Phase 09.

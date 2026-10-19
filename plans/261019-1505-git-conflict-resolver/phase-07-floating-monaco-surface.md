# Phase 07 — Floating Monaco surface

## Context links

- [Plan](./plan.md), [Phase 05](./phase-05-scoped-client-and-drafts.md), [Phase 06](./phase-06-merge-model-and-history.md).
- [Floating UI contract](./design-contract.md#floating-ui-and-cutover), [acceptance matrix](./acceptance-matrix.md), [repository evidence](./reports/repository-evidence.md).
- [Merge research](./research/merge-model.md) describes candidate public APIs, not a qualified private merge workbench.

## Overview

- Date: 2026-10-19. Priority: P2.
- Implementation: Pending. Review: Pending. Progress: 0%. Effort: unestimated.
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

- [ ] Add one cross-shell host and extend existing stacking identity.
- [ ] Rework existing renderer against retained structured model/history.
- [ ] Implement public aligned panes, scroll guards and font/wrap/fold policy.
- [ ] Add responsive frame/pane selector and accessible controls.
- [ ] Preserve Android input/Cognito isolation and topmost keyboard ownership.
- [ ] Exercise actual shell/geometry/focus and configured-editor handoff/return retention; retain web/Linux visual evidence for human acceptance.

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

- Surface owner: exact view-zone/scroll/wrap/fold alignment policy; run steps 6–7/11 with unequal hunks and zoom, retain capture/anchor evidence, stop visual completion on drift.
- Integration owner: event ordering/topmost focus and cross-shell mount seam; run actual Escape/widget/terminal scenario, retain observed ownership trace, stop cutover if owned keys leak or models dispose.

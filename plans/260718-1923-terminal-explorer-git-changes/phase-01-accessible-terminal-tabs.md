---
title: "Phase 01: Accessible terminal Files tabs"
status: completed
priority: P2
created: 2026-07-18
---

# Phase 01: Accessible terminal Files tabs

## Context links

- [Plan overview](./plan.md)
- [TerminalFloatingFilePanel](../../packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx)
- [WorkspacePage](../../packages/ui/src/components/pages/WorkspacePage.tsx)
- [ChangedFilesList](../../packages/ui/src/components/organisms/ChangedFilesList.tsx)

## Overview

**Date:** 2026-07-18. **Priority:** P2. **Status:** completed 2026-07-18. Explorer | Changes tabs now share the floating panel's existing left pane while the editor stays intact.

## Key insights

- `FileTree` and `ChangedFilesList` already request `useGitDiff(project, "*")`; mounted simultaneously they share TanStack Query state rather than issue duplicate diff requests.
- `ChangedFilesList` already owns root-aware stage/unstage/discard/commit and invokes the caller for diff-open. Reuse it unchanged.
- The terminal Git popup is deliberately separate and remains the only branch/history/remotes surface.

## Requirements

- Explorer is initially active on every open/mount; switching tabs must not alter persisted panel geometry.
- Use semantic `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, labelled `role="tabpanel"`, and stable IDs.
- Support Tab focus and Left/Right, Home/End tab navigation; preserve Escape close, close-button label, resize control label, and mouse drag behavior.
- Changes gets the complete existing `ChangedFilesList` UI. Selection opens the existing diff editor flow; deleted/conflicted and multi-root entries retain the list's current routing/actions.
- No project: render the existing empty state in either tab; never call a query with an empty project.

## Architecture

`WorkspacePage` supplies two lazy contents to `TerminalFloatingFilePanel`: existing `FileTree` and `ChangedFilesList`. The panel owns only active-tab and keyboard focus state; it renders one left-pane tab panel at a time. The right `EditorTabs` region is unaffected.

## Related code files

- **Modify:** `packages/ui/src/components/organisms/TerminalFloatingFilePanel.tsx` — add `changesContent`, tab state, semantic controls, panel switching.
- **Modify:** `packages/ui/src/components/pages/WorkspacePage.tsx` — pass `ChangedFilesList` with the existing `openDiff` callback and terminal empty state.
- **Modify:** `packages/ui/src/components/organisms/TerminalFloatingFilePanel.test.tsx` — cover default, labels/roles, keyboard switching, Escape.
- **Modify/create if absent:** `packages/ui/src/components/pages/WorkspacePage.test.tsx` — verify terminal wiring and project/no-project behavior.
- **Do not modify:** `ChangedFilesList.tsx`, `FileTree.tsx`, `TerminalFloatingToolPanel.tsx` unless implementation reveals a narrowly required compatibility issue.

## Implementation steps

1. Define a small local tab union and deterministic tab/panel IDs in `TerminalFloatingFilePanel`; initialize/reset to Explorer only when the panel is newly mounted, not on every rerender.
2. Replace the static Explorer header with two semantic tab buttons. Implement roving keyboard selection/focus without stealing focus from file rows, inputs, or the editor.
3. Render only the active content in the left pane so activating Changes requests current data and the hidden tree does not retain unnecessary event subscriptions. Keep width, resize handle, and editor region shared.
4. In `WorkspacePage`, pass the current FileTree as Explorer and a lazy `ChangedFilesList` as Changes. Reuse the existing local-changes `onSelectFile` → `openDiff` behavior; pass the required conflict argument correctly.
5. Preserve Suspense fallbacks and use existing terminal typography/semantic buttons; do not introduce a new panel design system.

## Todo list

- [x] Add tab API and state.
- [x] Wire shared Changes content.
- [x] Implement keyboard/focus semantics.
- [x] Add focused component and Workspace coverage.

## Success criteria

- Explorer opens by default with unchanged Git badges and file behavior.
- Changes shows existing action controls and opens diffs from a selected changed/deleted/conflicted entry.
- Tab semantics pass keyboard and screen-reader smoke checks; Escape still closes.
- Terminal Git popup has no functional or visual regression.

## Risk assessment

- **Focus conflict:** drag header and tabs must be separate hit targets. Mitigate with buttons outside drag-start binding.
- **State loss:** conditional mount resets Changes form state on tab switch. Accept only if existing UX tolerates it; otherwise retain inactive content with `hidden` after confirming it does not duplicate subscriptions. Choose based on component test/manual result.
- **Width pressure:** ChangedFilesList commit controls can compress a narrow panel. Respect current minimum width and overflow behavior; do not add another fixed max size.

## Security considerations

No new authority or data flow. Existing destructive discard confirmation, root routing, and Git API authorization remain in `ChangedFilesList`/server.

## Next steps

Phase 02 remains pending: centralize refresh before claiming FS-event-driven Git freshness across both tabs.

## Completion evidence

- Completed 2026-07-18.
- Validation passed: 595 UI tests, 28 browser tests, TypeScript check, and Prettier check.
- Code review approved at 9/10.

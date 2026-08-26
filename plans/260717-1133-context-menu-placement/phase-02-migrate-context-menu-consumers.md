# Phase 02 — Migrate all context-menu consumers

## Context links

- Parent: [plan.md](./plan.md)
- Foundation: [phase-01](./phase-01-shared-context-menu-surface.md)
- Inventory: [brainstorm report](/mnt/data/ws/sharing/dam-hopper/plans/reports/brainstorm-260717-1133-context-menu-placement.md)

## Overview

- Priority: P1
- Status: Done — 2026-07-17 20:20 +0700
- Effort: 3.5h
- Description: replace seven bespoke placement/portal/dismissal paths with the shared Radix wrapper.
- Review status: Approved — 9.1/10 after ref-forwarding and Select-layer fixes

## Key insights

- Direct failures are tree, history, and commit-file menus inside filtered/overflow-hidden floating panels.
- Changed-files and editor tabs retain duplicate geometry policies even when currently less visible.
- Branch and diagnostics already have partial portal/lifted solutions; migrate them last because their trigger composition is more complex.

## Requirements

- Preserve all action callbacks, disabled states, labels, selection semantics, and destructive-action flows.
- Wrap each target with `ContextMenu.Root` and `ContextMenu.Trigger asChild`; use `ContextMenu.Portal` and shared Content/Item wrappers.
- Remove viewport coordinate state where Radix Trigger can own the native context-menu event; retain controlled state only where a trigger cannot be wrapped directly.
- Remove guessed dimensions, local coordinate subtraction, inline fixed/absolute placement, duplicate document listeners, and custom clamp helpers.
- Preserve existing ContextMenu/Shift+F10 behavior for history and commit details; add focusable trigger adapters only where required.
- Keep native browser-menu suppression scoped to existing branch/select behavior.

## Architecture

Migration order: Tree → Git history → Commit files → Changed files → Editor tabs → Diagnostics → Branch. Each consumer supplies trigger markup and domain items; Radix owns portal, collision, focus, keyboard, and dismissal.

## Related code files

Modify:

- `packages/ui/src/components/organisms/FileTree.tsx`
- `packages/ui/src/components/organisms/TreeContextMenu.tsx`
- `packages/ui/src/components/organisms/GitLogTree.tsx`
- `packages/ui/src/components/organisms/CommitDetailsPanel.tsx`
- `packages/ui/src/components/organisms/ChangedFilesList.tsx`
- `packages/ui/src/components/organisms/EditorTabs.tsx`
- `packages/ui/src/components/organisms/EditorTabContextMenu.tsx`
- `packages/ui/src/components/organisms/TerminalDiagnosticsContextMenu.tsx`
- `packages/ui/src/components/organisms/GitBranchContextMenu.tsx`
- Trigger/composition files as needed: `GitBranchControl.tsx`, `WorkspacePage.tsx`, `WorkspaceGitPanel.tsx`, and terminal trigger components needed for focus identity.

Delete: obsolete per-menu clamp helpers and listeners after action/state tests are migrated.

## Implementation steps

1. Migrate tree, Git history, and commit-file menus; verify placement after moving both floating panels away from `(0,0)`.
2. Migrate Changed Files and editor tabs; remove container-local coordinate conversion while preserving checkbox/tablist keyboard semantics.
3. Migrate diagnostics through a controlled Root or trigger-local Root without broadening the handler graph unnecessarily.
4. Migrate branch last; preserve Radix Select event suppression, current-branch deletion guards, and dismissable-layer ordering.
5. Remove dead menu-size constants, portals, and document listeners; run focused tests after each group.

## Todo list

- [x] Tree menu uses shared Radix wrapper.
- [x] History menu uses shared Radix wrapper.
- [x] Commit-file menu uses shared Radix wrapper.
- [x] Changed-files menu uses shared Radix wrapper.
- [x] Editor-tab menu uses shared Radix wrapper.
- [x] Diagnostics menu uses shared Radix wrapper.
- [x] Branch menu uses shared Radix wrapper.
- [x] Preserve actions, native suppression, and keyboard triggers.

## Success criteria

All seven menus render Radix Content through the body portal; right-click inside moved file/Git floats is pointer-relative and unclipped; no consumer contains viewport clamp constants or custom menu positioning.

## Risk assessment

- React-arborist may not forward refs: use a minimal wrapper element and preserve drag/selection handlers.
- Checkbox rows can consume Space/Enter: do not hijack checkbox keyboard behavior.
- Branch menu inside Radix Select may race unmount/dismissal: migrate last and cover it in browser tests.
- Lifted diagnostics state may lack a trigger ref: use controlled Root and make focus restoration optional for mouse-only paths.

## Security considerations

No new data access. Keep native context-menu suppression scoped to relevant triggers; do not globally disable browser menus.

## Next steps

After each migration group passes, update consumer tests to assert Radix trigger/content wiring before browser validation.

## Unresolved questions

- Any dynamically injected tool content outside the static inventory must consume the shared Radix wrapper rather than add another custom menu.

# Phase 05 — Sidebar project workspace rows (disclosure, worktree bar, file tree, picker)

## Context Links
- Design §3 Flow A, §5 (tab/chevron/file/close/keyboard rows), AC1/AC3/AC4: `../reports/ui-ux-designer-261106-0226-agent-hub-workspace-flow.md`
- Evidence A "Legacy navigator", "File tree & worktree": `./reports/scout-261106-0334-evidence-and-decisions.md`
- P01 Navigator extension props + `canDismissWorkspace` + `OpenWorkspaceRef`: `./phase-01-shared-contracts.md`

## Overview
- Priority: P1 · Status: completed · Effort: 7h
- Presentational Navigator upgrade: each project row = sibling disclosure button / `role="tab"` / `[+]` / `[×]` (zero-terminal only), compact worktree bar, labelled region with `FileTree` that emits fully-qualified float `file:open` payloads; `[+ Open ▾]` inventory picker. Agents section unchanged.

## Parallelization Info
- Group A · Depends on: P01 · Blocks: P06 · Concurrent peers: P02, P03, P04 (disjoint files).

## Key Insights
- Current row: `<div role="presentation">` + `<button role="tab">` + sibling `TraditionalTerminalWorktreeSelect` (`packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx:177-250`); verbose `TraditionalProjectGitSummary` inside the tab (`:32-127`, `:230-237`); props `:254-266`; agent filter persistence `:283-303`.
- `TraditionalTerminalWorktreeSelect` props `{projectName, profileId?, projectRef?, touchOptimized?, className?}` (`TraditionalTerminalWorktreeSelect.tsx:50-56`); selection lives in `useProjectTargetStore` (`packages/ui/src/stores/project-target.ts:407-543`) read via `useProjectTarget(projectRef)` (`packages/ui/src/hooks/use-project-target.ts:11-27`) → `ProjectTargetSnapshot.target: ProjectTargetRef {profileId, project, worktreePath?}` (`api/ownership.ts:15-17`).
- `FileTree` props: `target?`, `onFileOpen?(node: FsArborNode)` (`packages/ui/src/components/organisms/FileTree.tsx:374-385`); folder expansion persisted by `explorerTreeScopeKey(target)` (`packages/ui/src/stores/explorer-tree.ts:10-19`). Do NOT modify FileTree.tsx.
- FilesApp project dispatch shape to mirror (`packages/ui/src/os/apps/FilesApp.tsx:135-152`): `{profileId, projectId, worktreeId, target:{kind:"project",profileId,project,worktreePath}, filePath}`.
- Generation source: `useConnectionSnapshot(profileId)` (`packages/ui/src/api/connections.ts:818-825`).
- Only consumer of the Navigator is `TraditionalTerminalProjectsDisplay` (P06) → legacy row can be replaced; all new props optional so the current Display still compiles until P06.

## Requirements
- R1 Row (`TraditionalTerminalProjectWorkspaceRow`): header siblings in order: disclosure `<button aria-expanded aria-controls={regionId}>` (only when `onToggleDisclosure`), `<button role="tab">` (activity indicator or muted `○` for 0, label, `ProfileBadge`, count) with NO nested interactive elements, `[+]` (`aria-label="New terminal in {project}"`, when `onNewTerminalInGroup`), `[×]` (`aria-label="Close {project} workspace"`, only when `onCloseWorkspace` and `canDismissWorkspace`). Disclosure toggle never calls `onSelectGroup` nor moves focus to xterm.
- R2 Compact worktree bar (active or disclosed rows, git projects): `TraditionalTerminalWorktreeSelect` + 7-char commit chip from existing `useProjectStatus` data; replaces verbose summary.
- R3 Tree (`TraditionalProjectWorkspaceTree`): `<div role="region" aria-label="{projectName} files" id={regionId}>` mounting `FileTree target={projectTarget}`; owner = row's own `projectRef` + selected worktree + `useConnectionSnapshot(profileId)` generation captured at render; `onFileOpen(node)` → `onOpenFile({profileId, projectId, worktreeId, target:{kind:"project",…}, filePath: node.id, mode:"float", generation})`; disconnected owner → explicit disconnected notice, no dispatch. Payload never derived from active group or Hub ctx.
- R4 Picker (`OpenProjectWorkspacePicker`): presentational; props-only inventory (no TanStack Query import); groups items by profile; marks already-open groups; loading/empty states; keyboard accessible (button + listbox/menu); calls `onOpen(ref)`.
- R5 Navigator: header `PROJECTS (n)` with `[+ Open ▾]` (when `picker`) and existing `[+]`; roving tabindex unchanged (ArrowUp/Down/Home/End over tab buttons only); Agents section, filter key `dam-hopper:traditional-terminal-agents-status-filter`, and agent rows unchanged; Projects/Agents scroll containers bounded independently.
- Non-goals: no data fetching beyond existing row hooks; no Display/AgentHub edits (P06).

## Architecture
```
TraditionalTerminalProjectsNavigator (props incl. P01 extension)
 ├─ header: PROJECTS (n) [+ Open ▾ → OpenProjectWorkspacePicker] [+]
 ├─ tablist: TraditionalTerminalProjectWorkspaceRow × n
 │    ├─ [▸/▾] [role=tab …] [+] [×]
 │    ├─ worktree bar (TraditionalTerminalWorktreeSelect + hash chip)
 │    └─ TraditionalProjectWorkspaceTree (disclosed only) → FileTree → onOpenFile(payload)
 └─ AGENTS (unchanged)
```

## Related Code Files
- Modify: `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`, `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`
- Create: `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx`, `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.test.tsx`, `packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.tsx`, `packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.test.tsx`, `packages/ui/src/components/organisms/OpenProjectWorkspacePicker.tsx`, `packages/ui/src/components/organisms/OpenProjectWorkspacePicker.test.tsx`
- Delete: legacy `TraditionalProjectRow`/`TraditionalProjectGitSummary` internals inside the Navigator file (replaced).

## Ownership & Conflict Prevention
- Exclusive in Group A. Not touched: `FileTree.tsx`, `TraditionalTerminalWorktreeSelect.tsx`, `TraditionalTerminalProjectsDisplay.tsx` (P06), browser tests (`terminal-traditional-projects.browser.tsx` expectations on the old git summary are updated by P06 `p06-display-integration`).

## Implementation Steps
1. `p05-workspace-tree`: build component + tests (mock `FileTree` module): payload uses clicked tree's profile/project/selected worktree/generation even when another group is active; worktree change updates payload; disconnected → no dispatch; region labelled; target passed to FileTree equals `useProjectTarget` target (scope key stable → expansion persists, AC3).
2. `p05-open-picker`: component + tests: lists inventory grouped by profile, disables/marks open items, loading/empty, Enter/Escape keyboard, `onOpen` called with `{profileId, project}`.
3. `p05-workspace-row-navigator`: row component + Navigator integration + tests: sibling ARIA (axe-like assertion: no interactive descendant inside `[role=tab]`), disclosure aria-expanded/controls, chevron does not change `activeGroupId`, `[×]` only for zero-terminal, roving tabindex unchanged, `Tab` order reaches chevron → tab → `[+]`/`[×]` → worktree select → tree region, agents filter persistence unchanged.

```evcrate-tasks
[
  {
    "id": "p05-workspace-tree",
    "title": "Per-project file tree region emitting owner-qualified float file:open payloads",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.tsx", "packages/ui/src/components/organisms/TraditionalProjectWorkspaceTree.test.tsx"],
    "constraints": ["Do not modify FileTree.tsx; payload built only from this tree's own projectRef, selected worktree and connection generation, never Hub ctx or the active group.", "No TanStack Query import in this component."],
    "acceptance": ["Clicking a file emits {profileId, projectId, worktreeId, target{kind:project}, filePath, mode:\"float\", generation} for the clicked tree's owner even when another project is active (AC1).", "Disconnected owner emits nothing; tree target equals useProjectTarget target so explorer-tree expansion persists per worktree (AC3, AC4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/TraditionalProjectWorkspaceTree.test.tsx"]
  },
  {
    "id": "p05-open-picker",
    "title": "Presentational open-project workspace picker",
    "blocked_by": ["p01-terminal-claim-key", "p01-terminal-runtime-identity", "p01-hub-terminal-mounts-store", "p01-open-workspaces-union", "p01-file-open-mode-contract", "p01-reveal-window", "p01-terminal-presentation-input"],
    "allowed_files": ["packages/ui/src/components/organisms/OpenProjectWorkspacePicker.tsx", "packages/ui/src/components/organisms/OpenProjectWorkspacePicker.test.tsx"],
    "constraints": ["Inventory via props only (leaf decoupled from TanStack Query).", "Opening a project never spawns a terminal."],
    "acceptance": ["Picker lists inventory grouped by profile, marks already-open workspaces, handles loading/empty, is keyboard operable, and calls onOpen({profileId, project}) (AC4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/OpenProjectWorkspacePicker.test.tsx"]
  },
  {
    "id": "p05-workspace-row-navigator",
    "title": "Workspace rows with sibling ARIA controls and compact worktree bar in Navigator",
    "blocked_by": ["p01-open-workspaces-union", "p05-workspace-tree", "p05-open-picker"],
    "allowed_files": ["packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx", "packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.test.tsx", "packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx", "packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx"],
    "constraints": ["All new Navigator props optional (P01 frozen shape); Agents section and its storage key unchanged.", "role=tab buttons contain no nested interactive controls; [x] only for zero-terminal workspaces."],
    "acceptance": ["Disclosure button, tab, [+] and [x] are siblings; chevron toggles tree without changing the active group; roving tabindex and agent filter persistence unchanged (AC3, AC5).", "Worktree bar uses TraditionalTerminalWorktreeSelect with compact commit chip; zero-terminal rows show muted indicator and count 0 (AC4)."],
    "verification": ["pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/TraditionalTerminalProjectWorkspaceRow.test.tsx src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx src/components/organisms/TraditionalTerminalWorktreeSelect.test.tsx", "pnpm --filter @dam-hopper/ui build"]
  }
]
```

- [x] <!-- evcrate-task:p05-workspace-tree --> Per-project file tree region emitting owner-qualified float file:open payloads
- [x] <!-- evcrate-task:p05-open-picker --> Presentational open-project workspace picker
- [x] <!-- evcrate-task:p05-workspace-row-navigator --> Workspace rows with sibling ARIA controls and compact worktree bar in Navigator

## Success Criteria
- AC1 (owner-qualified float payload), AC3 (sibling ARIA, worktree + tree persistence), AC4 (zero-terminal browse/picker), AC5 (agents section intact).
- **W2 Remediation Verified:** Clean file-tree relocation: Rather than mounting redundant inline trees and disclosure buttons in each project row within `TraditionalTerminalProjectWorkspaceRow`, the file tree is mounted exclusively in the right sidebar of `TraditionalTerminalProjectsDisplay` for the currently selected workspace. This avoids duplicate subscriptions, multiple simultaneous trees, and ensures closing the right sidebar completely hides the tree.

## Risk Assessment
- Sidebar vertical contention with deep trees → independent bounded scroll containers (design §8).
- `useProjectStatus` per row cost unchanged from legacy row.
- Browser suite `terminal-traditional-projects.browser.tsx` may fail on removed verbose git summary until P06 updates it — expected, tracked in P06.

## Security Considerations
- Generation captured from the clicked tree's owner; disconnected → no request. No new storage keys.

## Rollback
- Revert P05; Navigator returns to legacy row. New components unused elsewhere.

## Next Steps
- P06 wires props from Display/AgentHub and forwards `onOpenFile` to `dispatchIntent`.

## Unresolved questions
- None.

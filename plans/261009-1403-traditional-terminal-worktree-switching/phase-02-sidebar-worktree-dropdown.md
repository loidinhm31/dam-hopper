# Phase 02 — Sidebar worktree dropdown

## Context links

- [Parent plan](./plan.md); [Phase 01](./phase-01-scoped-target-routing.md).
- [Current worktree guide](../../docs/worktree-operation.md).
- Shared Select: `packages/ui/src/components/ui/Select.tsx`.

## Overview

Date: 2026-10-09. Priority: P2. Estimate: 3h. Implementation: complete. Review: complete.
Add compact, accessible worktree switching to existing Traditional project rows, desktop and compact.

## Key Insights

- Current row is a single `button role=tab` inside a vertical tablist. A Select trigger cannot be nested inside it.
- Worktree discovery currently lives inside optional `TraditionalProjectGitSummary`; preference-off must not disable switching.
- Summary matches branch/commit heuristically. Selected worktree must instead match normalized exact path; multiple detached worktrees can share a commit.
- `useWorktrees` already shares owner/generation query keys and supports visible-only 10-second polling.
- Select portal uses z-index 80; compact mode uses Dialog. Browser proof required for clipping/focus containment.

## Requirements

- Each existing configured-project row has a compact dropdown even when commit metadata is disabled or absent. No expansion of the project inventory beyond existing terminal groups.
- Root first; exclude duplicate main worktree. Branch plus short distinguishing path in options, full path accessible. Detached HEAD and Locked labels; locking does not prevent selecting an otherwise valid worktree.
- Disable bare/unavailable/prunable paths. No create/remove actions.
- Loading/error/no-secondary-worktrees/current-target-missing/disconnected states explicit. Non-Git projects remain root-only with an informative unavailable state, not a fabricated discovery result.
- Control updates only the represented project's target. No automatic terminal launch or project activation.
- Keyboard tab navigation, dropdown arrows, Escape, focus restoration, touch targets, and sidebar resizing remain usable.

## Architecture

Keep project tab and selector as sibling controls within a project-row wrapper. Preserve `tablist`, `tab`, roving navigation and panel relationships. Use presentation wrappers as appropriate; controls must be independently discoverable/focusable and dropdown keyboard events must not reach project-tab handlers.

Create a narrowly scoped `TraditionalTerminalWorktreeSelect` with one owning project ref and controlled visibility. Reuse shared Select and `useWorktrees`, canonical target store/path normalization/status labels. Component owns discovery/selection display; no terminal lifecycle logic. Share query cache with optional metadata instead of creating another transport call.

Fetch/refetch on mount and dropdown open using existing query APIs. Poll only while dropdown is open, not all sidebar rows continuously. On successful fresh discovery, reconcile known missing/recovered targets using existing target-loss semantics, preserving owner and editor-bound targets; never infer disappearance from errors, background stale data, or retired generation. A restored path does not auto-select itself. Announce any existing root fallback explicitly.

## Related code files

Created:
- `packages/ui/src/components/organisms/TraditionalTerminalWorktreeSelect.tsx`: bounded compact worktree selector component.
- `packages/ui/src/components/organisms/TraditionalTerminalWorktreeSelect.test.tsx`: test suite covering combobox trigger, on-open refetch, path disambiguation, event stop-propagation, and profile-scoped target selection.
- `packages/ui/src/hooks/use-worktree-target-reconciliation.ts`: shared target loss/recovery hook extracted and used by both Traditional navigation and the Project panel.
- `packages/ui/src/hooks/use-worktree-target-reconciliation.test.tsx`: test suite verifying target availability, recovery across `dataUpdatedAt`, live fallback announcements, and profile isolation.

Modified:
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`: sibling row controls in presentation wrapper, exact-target git summary, combobox integration.
- `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.test.tsx`: test cases asserting worktree selector rendering on configured projects, omission on Free terminals, and click isolation from `onSelectGroup`.
- `packages/ui/src/components/organisms/ProjectWorktreesSection.tsx`: migrated to shared `useWorktreeTargetReconciliation` hook, eliminating duplicated loss/recovery logic.
- `docs/worktree-operation.md`: comprehensive documentation of inline sidebar worktree dropdown, path disambiguation, visible-only polling, keyboard navigation, touch targets, and troubleshooting.

Reused:
- `packages/ui/src/components/ui/Select.tsx`: shared Radix Select primitive without introducing a second dropdown primitive.
- `packages/ui/src/api/queries.ts`: `useWorktrees` query with generation/owner qualification and `pollWhileVisible`.
- `packages/ui/src/stores/project-target.ts`: canonical target store, normalized path comparison, status labels.
## Implementation Steps

1. Refactor row markup without changing group identity, terminal counts, activity indicators, tab IDs, layout storage, or project selection.
2. Add a controlled Select beside/below project tab. Use a nonempty root sentinel only within presentation; write `null` for Project root and exact discovered path for worktrees.
3. Subscribe to the exact project scope. Resolve selected worktree by normalized path, not branch or commit equality. Display branch/short path; preserve full-path accessible descriptions.
4. Bind discovery to configured root plus owning profile. Refresh on opening and visible-only polling; retain existing generation-qualified query keys.
5. Reject disabled or stale choices at selection time using current successful discovery; ignore writes from replaced owner generations. Discovery failure keeps current choice and provides a refresh/reopen path, not root fallback.
6. Share Project-panel loss/recovery semantics from Phase 01, with announced fallback only on authoritative target loss. Ensure new operations never retry a rejected target against a different one.
7. Point optional branch/commit status at the selected target. If selected data unavailable, show an honest status or omit metadata; don't substitute another worktree's summary. Terminal count/activity still summarize all project's terminals.
8. In compact Projects sheet, opening/choosing worktree does not invoke handleSelectGroup or dismiss the sheet; Escape first closes dropdown and returns focus to its trigger.

## Todo list

- [x] Separate project tabs and selector controls.
- [x] Root/secondary worktree labels and disabled states.
- [x] Preference-independent selection and owner-qualified discovery.
- [x] Fresh-open refresh, bounded polling, explicit errors/loss.
- [x] Exact-target optional metadata.
- [x] Desktop/compact keyboard, focus, portal and touch behavior.

## Success Criteria

- Each existing project row switches worktree in one dropdown interaction, without entering Project panel.
- Same-commit detached worktrees remain distinguishable by path.
- Commit status off still allows switching; Free terminals do not expose a selector.
- Choosing a worktree does not alter active terminal, project tab, splits or current processes.
- Long paths stay usable at navigator min/max width; compact dialog dropdown remains visible and keyboard accessible.
- External worktree addition/removal becomes visible on fresh reopen; disconnected/error refresh does not erase a valid selection.


## Delivered Architecture & Implementation Details

- **Sibling Markup Structure**: Row markup wraps `<button role="tab">` and `<TraditionalTerminalWorktreeSelect>` inside `<div role="presentation">`, preventing invalid nested interactive elements and preserving ARIA 1.2 `tablist` -> `tab` vertical roving keyboard navigation (Arrow Up/Down, Home, End).
- **Event & Focus Containment**: Event propagation (`onClick`, `onKeyDown`) is explicitly stopped at the select container and trigger, ensuring dropdown interactions never trigger unintentional project tab selection (`onSelectGroup`) or terminal launches. Pressing `Escape` closes the dropdown and returns focus to the combobox trigger.
- **Path Disambiguation (`distinguishWorktreePath`)**: When worktrees share identical folder basenames (e.g., `/client-1/feature` and `/client-2/feature`), parent folder prefixes are automatically added (`client-1/feature`, `client-2/feature`) so options remain distinguishable at a glance.
- **On-Demand Discovery & Bounded Polling**: Opening the combobox triggers an immediate `refetch()`. Polling is strictly bounded to the open state (`pollWhileVisible: isOpen`), capturing external Git worktree creation or removal without background polling overhead across closed sidebar rows.
- **Shared Target Reconciliation (`useWorktreeTargetReconciliation`)**: Deduplicated 156 lines between `ProjectWorktreesSection` and `TraditionalTerminalWorktreeSelect`. Tracks missing targets across discovery generations, announces unavailable fallbacks via `aria-live="polite"`, and fails closed without wiping selections on transient query errors. Restored paths are cleanly recovered without unprompted selection shifts.
- **Responsive & Touch Accessibility**: `touchOptimized` mode applies `min-h-11` (44px) touch target heights on mobile/touch viewports. Radix Select portal renders at `z-[80]`, reliably floating above compact sheet dialogs (`z-50`).
- **Metadata Decoupling**: Selector operates independently of Git commit summary settings (`terminalCommitStatusEnabled`). When commit metadata is enabled, it resolves commit info for the selected worktree instead of assuming root.

## Verification & Test Results

- **Targeted Unit Tests**: 38/38 passing tests across 4 suites:
  - `use-worktree-target-reconciliation.test.tsx`: 8/8 passed.
  - `TraditionalTerminalWorktreeSelect.test.tsx`: 8/8 passed.
  - `TraditionalTerminalProjectsNavigator.test.tsx`: 13/13 passed.
  - `ProjectWorktreesSection.test.tsx`: 9/9 passed.
- **UI Regression Suite**: 329 test files, 2,725/2,725 tests passed (0 failures).
- **TypeScript Typecheck**: Clean compilation via `tsc -p tsconfig.json` and `tsc -p tsconfig.e2e.json` (0 errors).
- **Linting**: 0 ESLint errors repo-wide; 0 warnings across Phase 02 files.
- **Documentation Validation**: `node .omp/evcrate/scripts/validate-docs.cjs docs/` passed with 0 link errors.
## Risk Assessment

Nested controls break HTML/focus semantics; enforce sibling structure. Radix Select inside Dialog can expose portal focus bugs; prove actual surface rather than assume. Do not modify the React 19 compose-refs patch.

## Security Considerations

Only registered discovered paths selectable. Profile/generation fence every asynchronous state publication. No path entry, shell injection, checkout or new backend trust boundary.

## Next steps

Phase 03 exercises UI interactions and real PTY cwd/identity.

## Unresolved questions

None.

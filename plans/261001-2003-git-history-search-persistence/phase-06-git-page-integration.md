# Phase 06 — standalone Git page integration

## Context links

- [Plan](./plan.md); [contract §§1,3–4](./design-contract.md); [shared view](./phase-04-shared-history-view.md).
- [Git page source](../../packages/ui/src/components/pages/GitPage.tsx).
- Dependency: Phase 03 persisted selected set and frozen Phase 04 interface; can run beside Phase 05.

## Overview

- Date: 2026-10-01. Priority: P2. Implementation: pending. Review: pending.
- Restore Git page selections and give its single-project history branch/search/paging parity without redesigning bulk operations.

## Key Insights

- Current local selected Set is seeded once from Workspace after available project discovery. Clear/multi-select also clears canonical Workspace selection; change that coupling, not persisted Workspace storage.
- Empty selection means all projects for bulk operations; only exactly one selected project shows history.
- History currently calls `useGitLog(target,200,0)` with no branch/ref/root. Single-project local-changes sidebar and bulk push/publication remain independent features.

## Requirements

- Persist exactly selected qualified checkbox keys across remount/reload; preserve `null` uninitialized versus [] explicit-all semantics.
- Single valid project updates Workspace focus; multi-select/Clear leave Workspace focus intact.
- Nonempty unavailable selection remains explicit unavailable, never undefined/all. Show stale selected identities with removal controls; disable bulk operations while selected identities unavailable rather than silently widening or partially operating.
- Single-project history consumes same root/branch/search/paging controller as Workspace and same rewrite restrictions.
- No cross-project history for empty/multi-selection; preserve existing bulk result summaries and credential/lease flows.

## Architecture

`persisted selected key array → available project map + unavailable selected keys → explicit bulk target state`.

When one selected project is currently usable: `useProjectTarget(ref) → available target snapshot → shared history controller → branch/root/search controls + commit rows/details`.

Do not pass unresolved keys to fallback `parseProjectKey` as usable projects. Parsing is for displaying/removing saved identity, not authority to dispatch. Keep stable hook order with disabled history scope when zero/many/unavailable selected.

## Related code files

Modify:

- `packages/ui/src/components/pages/GitPage.tsx`: persisted selection integration, explicit unavailable UI/bulk guard, shared history view, root/branch/search/paging controls, target-scoped details/actions.
- `packages/ui/src/components/pages/GitPage.test.tsx`: meaningful persistence/routing/empty-vs-unavailable and branch action regressions; update query mocks to full signatures.
- `BulkGitOperations` is currently defined in `GitPage.tsx`; use same file ownership for safe disable/selection input changes. Do not extract the entire Git page as unrelated work.

Read/reuse:

- `use-aggregated-projects.ts`, `use-project-target.ts`, `workspace.ts`, new `git-history.ts`, shared controller/toolbar.
- Existing local-changes sidebar, editor openDiff, history/lease dialogs stay current components.

## Implementation Steps

1. Read current project selection derivation, hasInitializedRef effect, BulkGitOperations input/default behavior and shared contracts. Use hydrated store fields rather than syncing two independent Sets through effects.
2. Derive UI checked Set from persisted array for efficient lookup. `null` seed after Git store + Workspace store hydrate and only if `selectionRecoveryRequired` false: use canonical qualified Workspace project if present (retain unavailable seed as explicit key), otherwise [] once Workspace hydration completes. Corrupt saved selection shows recovery prompt and disabled bulk until explicit valid pick/Clear. Never wait forever for allProjects nonempty or reseed explicit [].
3. Persist checkbox updates through store action; exactly-one valid selected project calls Workspace setSelectedProject. Multi/Clear do not call setSelectedProject(null). Clear explicitly sets [] and resets only Git history/results, not Workspace focus.
4. Partition selected keys into currently available and unavailable. Display selected unavailable keys using parsed qualified identity and profile label where known; provide explicit deselect action. Offline selected project remains saved and reconnect can recover it.
5. Bulk empty [] continues all-current-available-projects behavior. Nonempty selection with any unavailable target disables fetch/pull/push/publication and explains which identity unavailable. Never pass undefined or an empty available subset that defaults to all. Existing generation/SSH guards still apply to available operations.
6. Enable history only for exactly one available selected project and available worktree snapshot. Pass full qualified target into shared controller. No requests during hydration/multi/empty/unavailable state; show distinct state message without treating offline as no commits.
7. Add VCS-root and history-view branch controls with clear distinction from checked-out badge; existing bulk checkout behavior remains independent. Read-only selected branch/root restored from shared store and reflects Workspace changes for same target.
8. Replace fixed first-page `useGitLog` and local selectedCommit with shared history view; add toolbar, matching ranges, Previous/Next/Refresh, search empty/error state, filtered-list presentation.
9. Preserve local-changes sidebar target scope. When viewing nested VCS root, history/details/diff/action root uses controller root; sidebar remains existing project-target local-changes behavior and is labeled independently, not silently retargeted. Use existing root-relative path helper only if appropriate; if sharing is needed, coordinator creates one small helper owned centrally, no cross-page import of Workspace component internals.
10. Pass root to useGitHistoryActions/CommitDetailsPanel and all applicable history dialogs. Apply same active-view restriction for reset/drop/edit/undo as Workspace; safe actions explain checked-out destination. Scope changes close pending dialogs and clear stale selected details.
11. Reset bulk results on actual selected-set change as current toggles do; owner/project/worktree changes must not leave result summaries mislabeled as current operation. Do not persist bulk result payloads.
12. Extend existing DOM behavior tests: first-use seed; explicit [] reload with Workspace focus retained; multi-select reload; offline unavailable key never creates bulk-all; same-name profiles route correctly; current/pinned branch view affects enabled actions but never checkout. Test observed behavior/targets, not replicated key strings or cosmetic badges.
13. Report exact changed selection/bulk/history behavior and tests; no worker checks mid-flight. No edits to shared controller/store after freeze without coordinator assignment.

## Todo list

- [ ] Persist selected project checkbox set with null/[] distinction.
- [ ] Decouple multi/Clear from Workspace focus.
- [ ] Keep unavailable selection visible and bulk fail-closed.
- [ ] Shared branch/root/search/paging and target-scoped details/actions.
- [ ] Preserve local changes and bulk credential/publication behavior.
- [ ] Add consumer-visible selection/owner/action regressions.

## Success Criteria

- Single/multi/explicit-all selections restore after page remount and reload; Workspace selected project remains unchanged after multi/Clear.
- Exactly-one usable selection shows restored branch and searchable paged history. Zero/many selections remain bulk mode with no history requests.
- Offline/removal cannot turn selected single project into bulk-all. User can explicitly deselect unavailable identities.
- Both Git surfaces use same branch/root preference for identical target; different profiles/worktrees/roots remain isolated.
- History selection/restoration never invokes checkout; rewrite callbacks disabled on nonactive view; existing bulk operations still work for intended targets.

## Risk Assessment

- Most severe regression: selected unavailable subset collapses to undefined/all. Derive mode from persisted intent before availability filtering and guard operations.
- Shared Workspace focus and independent Git bulk set can differ intentionally: document first-use seeding versus initialized-set restore; do not create bidirectional sync loops.
- Child-root history can conflict with local-changes sidebar: label scope explicitly; history file paths include selected root, mutations never use sidebar's implicit root.

## Security Considerations

Do not dispatch to unknown/removed profile from parsed storage key. Full target/profile and root preserved in reads, details and actions; stale generation response ignored. Bulk subset never silently broadened.

## Next steps

Coordinator integrates Phase 05 + 06 and runs Phase 07 real scenarios. Unresolved questions: none.

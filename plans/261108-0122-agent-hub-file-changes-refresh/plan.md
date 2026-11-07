---
title: "Agent Hub file changes refresh button"
description: "Add an accessible, target-scoped refresh button to Agent Hub's file changes sidebar header."
status: completed
priority: P2
effort: 2h
branch: feat/ai-os-redesign
tags: [feature, frontend, agent-hub, testing]
created: 2026-11-08
---

# Agent Hub file changes refresh

## Outcome and scope
- Refresh the selected project's changed-file information from the existing right sidebar.
- Product changes only in `packages/ui`: modify `TraditionalTerminalProjectsDisplay.tsx`; create its colocated `.test.tsx`.
- Keep `TraditionalProjectFileChanges`, its `useGitDiff(targetRef, "*")`, API contracts, terminal lifecycle, and sidebar visibility unchanged.
- No new dependencies, polling, global state, ref forwarding, backend work, or broad component refactor.

## Selected design
- Normalize the selected group to the same target as the changed-file child; retain profile/project/worktree identity.
- Use `useQueryClient()` and `invalidateQueries({ queryKey: gitQueryKey("git-diff", targetRef) })`.
- Prefix matching intentionally includes the child's aggregate `"*"` query; do not use `exact: true` or literal cache-key arrays.
- `isRefreshing = manualRefreshPending || isFetching`, with target-filtered `useIsFetching`; release manual state in `finally`.
- Add `RefreshCw` beside “file changes”; disable and spin during refresh.
- Require `type="button"`, `aria-label="Refresh file changes"`, `title="Refresh file changes"`; icon decorative.
- Keep network errors in the child's existing query error presentation, not a new notification/fallback.

## Phase
| Phase | Status | Effort | Detail |
| --- | --- | --- | --- |
| 01 — Button, unit coverage, verification | DONE (2026-11-08 02:16:51 +07:00) | 2h | [phase-01-refresh-button.md](./phase-01-refresh-button.md) |

## Evidence and dependencies
- [Scout report](../reports/scout-261108-0123-agent-hub-file-changes-refresh.md); source is authoritative for actual key structure.
- Header: `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:775–786`.
- Target parity: `TraditionalProjectFileChanges.tsx:62–76`; keys/hook: `packages/ui/src/api/queries.ts:166–188,1354–1381`.
- React 19, TanStack Query v5, lucide-react and Vitest/jsdom already installed; reuse current QueryClient provider.
- Follow `docs/code-standards.md` owner-qualified state rules and `docs/system-architecture.md` ownership model.
- Preferred architecture-gate filenames absent; existing system architecture supplies relevant invariants. No new service/schema/lifecycle boundary.
- Coordinator owns related-plan conflict checks, independent review disposition, final validation, and implementation authorization.

## Acceptance and verification
- Visible sidebar contains one correctly labeled refresh button in the file changes header.
- One click invalidates only the normalized selected target's diff-query prefix; mounted child refetches.
- Manual pending and matching background fetching both disable/spin; settlement restores idle behavior.
- New component tests cover rendering, click/invalidation, normalized target isolation, fetching/manual state, and existing sidebar visibility gates.
- Implementer/main agent runs `pnpm --filter @dam-hopper/ui test` and `pnpm --filter @dam-hopper/ui build`; record actual failures, not assumed passes.

## Implementation & Signoff Status
- **Overall Status:** Completed (administratively completed per user approval; technical acceptance incomplete per Cycle 3 review carryovers).
- **Phase 01:** DONE (2026-11-08 02:16:51 +07:00)
- **Delivered Changes:**
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`: Added accessible `RefreshCw` button in file changes sidebar header with target normalization, diff query prefix invalidation, and `useIsFetching` background fetch indicator.
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.test.tsx`: Colocated unit tests for button rendering, click invalidation, target normalization, isolation, busy states, error recovery, and sidebar visibility gates.
- **Verification & Review Evidence:**
  - UI build: `pnpm --filter @dam-hopper/ui build` clean pass (0 errors).
  - Code review: Score 8/10 (Cycle 3, `plans/reports/code-review-261108-0157-agent-hub-file-changes-refresh-cycle-3.md`), 0 Critical issues. Approved by user.
  - Test evidence & caveats: Initial QA test execution reported intermittent failure (1/11 failed) on background diff fetch spin assertion due to React act environment timing. Subsequent handoff claimed 15/15 passing across 10 runs, but was not independently rerun by reviewer. Full UI test suite and manual UI smoke testing in Agent Hub remain open.
- **Open Carryovers & Warnings:**
  - Cycle 3 W1: Normalization test does not test conflicting reference/display precedence or structural worktree fixtures.
  - Cycle 3 W2: Isolation coverage does not test same-project/other-profile or root/other-worktree controls, or alternate-only pending fetch state.
  - Full UI suite verification (`pnpm --filter @dam-hopper/ui test`) and manual Agent Hub refresh/sidebar smoke check.

## Unresolved questions
None requiring design decisions. Open technical carryovers: Cycle 3 review warnings W1 & W2, full UI test suite execution, and manual Agent Hub sidebar smoke verification.

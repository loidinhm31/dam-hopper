# Phase 04 Shared History View — Cycle 2 Test Report

## Test results overview

| Command | Result | Duration / details |
|---|---|---|
| `pnpm --filter @dam-hopper/ui test src/hooks/use-git-history-view.test.tsx` | PASS | 1 file, 8 tests; Vitest 0.868s |
| `pnpm --filter @dam-hopper/ui test src/components/organisms/GitBranchControl.test.tsx` | PASS | 1 file, 14 tests; Vitest 1.33s |
| `pnpm --filter @dam-hopper/ui test src/components/organisms/GitLogTree.test.tsx` | PASS | 1 file, 8 tests; Vitest 0.256s |
| `pnpm --filter @dam-hopper/ui test src/stores/git-history.test.ts` | PASS | 1 file, 26 tests; Vitest 0.461s |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/consumer-context-menu.browser.tsx` | PASS | 1 file, 10 tests; Vitest 11.88s (test body 10.01s) |
| `pnpm --filter @dam-hopper/ui build` | PASS | TypeScript build; 8.57s wall time |
| `pnpm --filter @dam-hopper/web exec tsc --noEmit` | PASS | No diagnostics; 9.63s wall time |

Five test files passed: **66 tests passed, 0 failed, 0 skipped**. No warnings or errors were emitted by the successful build/typecheck commands. The full UI suite was not part of this Cycle 2 assignment and was not run.

## Requested-fix verification

| Fix | Verification |
|---|---|
| Synchronous scope state | Present in `packages/ui/src/hooks/use-git-history-view.ts:281-293`: the render-time scope-key adjustment clears the pending debounce timer and resets draft/applied query, page, and selected commit. The hook suite passed. Its current scope-switch test remounts the hook, however, so it does not directly assert same-mounted render-transition timing. |
| Generation fence in `effectiveScopeKey` | Present at `use-git-history-view.ts:261-279`: resolved owner generation is included in the effective key. Refresh captures that key and checks it against `currentScopeRef` before committing result/error/loading state (`:484-555`). Hook suite passed; no dedicated reconnect-generation/stale-refresh assertion was found in its eight tests. |
| Refresh try/catch | Present at `use-git-history-view.ts:495-555`; query invalidation/fetch rejection is caught and a notice is set only for the still-current scope. The hook suite passed; rejected-refresh behavior is not directly asserted by its current tests. |
| Root fetching check | Present in both effective-root derivation and missing-root reconciliation (`use-git-history-view.ts:159-188`): stale cached roots are not treated as authoritative while `isRootsFetching` is true. Hook suite passed; a root-background-refetch regression is not directly asserted by its current tests. |
| GitLogTree row-markup deduplication | `packages/ui/src/components/organisms/GitLogTree.tsx:249-263,299-455` builds graph/list row data and renders both through one row/context-menu template; the graph cell is conditional. `GitLogTree.test.tsx` passed all 8 tests, including graph SVG presence and list-mode graph omission. The internal markup consolidation itself is source-inspected, not a user-visible assertion. |

## Coverage and performance

Numeric line, branch, and function coverage was not collected; these requested commands did not enable coverage. Unit Vitest durations total approximately 2.92s; the browser suite completed in 11.88s. Build and web typecheck wall times were 8.57s and 9.63s respectively.

## Critical issues and recommendations

No blocking failures. The requested checks are green. To strengthen future regression protection, add focused tests for a same-mounted scope transition, owner-generation change during an in-flight refresh, refresh rejection handling, and root reconciliation during background fetching. Existing targeted tests establish the basic controller and rendering behavior but do not individually exercise those race/error branches.

## Unresolved questions

None.

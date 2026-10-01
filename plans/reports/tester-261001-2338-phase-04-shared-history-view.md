# Phase 04 Shared History View — Test Report

## Test results overview

| Suite / command | Result | Runtime / details |
|---|---:|---|
| `pnpm --filter @dam-hopper/ui test src/hooks/use-git-history-view.test.tsx` | PASS — 1 file, 8 tests | 0.83s Vitest duration |
| `pnpm --filter @dam-hopper/ui test src/components/organisms/GitBranchControl.test.tsx` | PASS — 1 file, 14 tests | 1.42s |
| `pnpm --filter @dam-hopper/ui test src/components/organisms/GitLogTree.test.tsx` | PASS — 1 file, 8 tests | 0.29s |
| `pnpm --filter @dam-hopper/ui test src/stores/git-history.test.ts` | PASS — 1 file, 26 tests | 0.53s |
| `pnpm --filter @dam-hopper/ui test:browser browser-tests/consumer-context-menu.browser.tsx` | PASS — 1 file, 10 tests | 11.74s; browser test body 10.02s |
| `pnpm --filter @dam-hopper/ui build` | PASS | TypeScript build, 8.47s wall time |
| `pnpm --filter @dam-hopper/web exec tsc --noEmit` | PASS | No diagnostics, 8.33s wall time |
| `pnpm --filter @dam-hopper/ui test` | PASS — 287 files, 2,126 tests | 17.23s Vitest duration |

No failed or skipped tests were reported by the passing runs. The full UI suite emitted two JSDOM `Error: Not implemented: navigation (except hash changes)` messages from hyperlink navigation; it nevertheless exited successfully with all 2,126 tests passing. These messages are non-blocking test-output noise, not failing assertions.

## Phase 04 contract coverage

- **Canonical refs:** Store tests verify distinct `refs/heads/origin/main` vs `refs/remotes/origin/main`, preserve canonical prefixes without double-prefixing, reject malformed refs, and resolve follow-active and pinned local/remote refs. Hook tests assert `refs/heads/main` and pinned-ref behavior. Branch-control tests verify local and remote selection emits canonical refs in view mode, does not check out branches, and deleting the viewed branch does not synthesize a fallback selection.
- **`presentation="list"`:** `GitLogTree` tests verify list mode omits graph SVG/circle elements and graph mode still renders them.
- **Debouncing:** Hook tests verify search text updates immediately but does not apply before 300 ms; after the debounce the applied query/filter state updates. Clearing search clears both draft and applied state atomically. Applying a query resets page and selected commit.
- **Scope reset:** Hook test switches to another project and asserts search text, applied query, selected commit, and page reset. Store tests also cover normalized root IDs, scoped key round-tripping, and per-scope branch preferences.
- **Reconciliation:** Hook tests cover an undiscovered pinned branch remaining in resolving/loading state, then a missing pinned branch after completed discovery producing a notice and reverting to follow-active. Store tests cover not-found pinned refs and resolution of canonical refs.
- **Browser regression:** All 10 consumer-context-menu browser tests passed. They cover Explorer/editor-tab context-menu interactions, pointer/touch cancellation, virtual rows, file actions, and GitBranchControl branch-menu behavior including no checkout, checked-out-branch delete restrictions, and Escape focus restoration. The specified browser suite is not a full browser exercise of every history-view contract; the detailed shared-history contracts above are covered by targeted unit tests.

## Coverage metrics

Numeric line, branch, and function coverage was not collected. A scoped Vitest coverage run was attempted, but Vitest stopped before test execution because the local workspace lacks optional dependency `@vitest/coverage-v8` (`MISSING DEPENDENCY`). No coverage percentages can be reported from this environment. The executed tests provide the contract-level behavioral coverage listed above.

## Build status and issues

- UI TypeScript build: passed.
- Web TypeScript check: passed with no output.
- Blocking test/build issues: none.
- Non-blocking issue: two JSDOM navigation-not-implemented messages during the broad UI suite.
- Coverage tooling limitation: install/provision `@vitest/coverage-v8` if numeric coverage is required in this environment.

## Recommendations / next steps

1. No blocking follow-up for Phase 04 based on the executed suites.
2. Provision the missing Vitest V8 coverage provider before requesting line/branch/function percentages.
3. If the JSDOM navigation messages obscure future test failures, identify the triggering hyperlink test and use a navigation-compatible browser test or prevent unintended JSDOM navigation.

## Unresolved questions

None.

# Frontend validation report

## Test results overview

**Integration-owner update:** Final corrected-source checks passed: UI TypeScript, 2,245 unit tests across 297 files, 9 Chromium component tests across 3 files, lint (0 errors/159 warnings), and production web build. The failures below are retained historical independent observations, superseded by the final passing browser run. `GitPage.squash.test.tsx` was renamed to `GitPageSquash.test.tsx`. See [integrated qualification](./qualification.md) for actual Axum/Vite/Chromium smoke, final review fixes and broad-gate limits.

- UI TypeScript build: initial attempt failed (exit 2); post-fix rerun **passed** (9.29s).
- Focused UI behavior tests: initial attempt had 1 failure; after parent correction, final run **passed** — 145 passed / 145 total, 0 failed, 0 skipped (4.62s).
- Focused Chromium component suites: **latest rerun failed** — 9 run, 8 passed, 1 failed, 0 skipped (24.51s). Two previous attempts had the same single test fail at later assertions; parent added fixture readiness waits and reran.
- Production web asset build: **not run**; stopped at actionable browser test failure.
- Coverage: not generated; no coverage percentages available.

## Initial UI build failure and post-fix rerun
Initial command:
```sh
pnpm --filter @dam-hopper/ui build
```

Exact initial compiler output:
```text
> @dam-hopper/ui@0.9.2 build /home/loidinh/WS/dam-hopper/packages/ui
> tsc -p tsconfig.json

src/advisor/views/EvaluationDetail.tsx(60,38): error TS2304: Cannot find name 'CandidateEvaluationSummary'.
src/advisor/views/EvaluationDetail.tsx(65,42): error TS2304: Cannot find name 'CandidateEvaluationSummary'.
src/test-fixtures/git-squash.ts(30,18): error TS2550: Property 'withResolvers' does not exist on type 'PromiseConstructor'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2024' or later.
/home/loidinh/WS/dam-hopper/packages/ui:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @dam-hopper/ui@0.9.2 build: `tsc -p tsconfig.json`
Exit status 2
```

After the parent reported fixes to the missing type import and fixture resolver, the same build command was rerun and passed. Exact output:
```text
> @dam-hopper/ui@0.9.2 build /home/loidinh/WS/dam-hopper/packages/ui
> tsc -p tsconfig.json
```
Exit status 0; duration 9.29s.

## Focused UI behavior tests
Command:
```sh
pnpm --filter @dam-hopper/ui test src/lib/git-squash-selection.test.ts src/hooks/use-git-squash.test.tsx src/hooks/use-git-history-view.test.tsx src/hooks/use-leased-git-push.test.tsx src/components/organisms/GitLogTree.test.tsx src/components/organisms/GitHistoryActions.test.ts src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx src/components/pages/GitPage.squash.test.tsx src/api/queries.test.ts src/api/ws-transport.test.ts
```

Initial run (before the parent corrected the URL matcher): exit 1; 11 test files (10 passed, 1 failed), 145 tests (144 passed, 1 failed), duration 4.73s. The diagnostic is preserved below; this failure was subsequently fixed.

Exact failure output:
```text
❯ src/hooks/use-git-squash.test.tsx (20 tests | 1 failed) 3412ms
     × retains draft on typed stale HTTP rejection without making that frozen snapshot retryable 6ms

 FAIL  src/hooks/use-git-squash.test.tsx > shared squash controller and actual controls > retains draft on typed stale HTTP rejection without making that frozen snapshot retryable
TypeError: Cannot read properties of null (reading 'click')
 ❯ src/hooks/use-git-squash.test.tsx:105:9
    103|         .querySelector<HTMLInputElement>(
    104|           `input[aria-label^="Select ${hash.slice(0, 7)}:"]`,
    105|         )!
       |         ^
    106|         .click();
    107|   });
 ❯ process.env.NODE_ENV.exports.act ../../node_modules/.pnpm/react@19.2.4/node_modules/react/cjs/react.development.js:814:22
 ❯ select src/hooks/use-git-squash.test.tsx:100:9
 ❯ open src/hooks/use-git-squash.test.tsx:110:9
 ❯ src/hooks/use-git-squash.test.tsx:562:11

 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 144 passed (145)
   Start at  13:52:32
   Duration  4.73s (transform 4.40s, setup 0ms, import 7.26s, tests 5.13s, environment 3.32s)

/home/loidinh/WS/dam-hopper/packages/ui:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @dam-hopper/ui@0.9.2 test: `vitest run src/lib/git-squash-selection.test.ts src/hooks/use-git-squash.test.tsx src/hooks/use-git-history-view.test.tsx src/hooks/use-leased-git-push.test.tsx src/components/organisms/GitLogTree.test.tsx src/components/organisms/GitHistoryActions.test.ts src/components/organisms/WorkspaceGitPanel.test.ts src/components/pages/GitPage.test.tsx src/components/pages/GitPage.squash.test.tsx src/api/queries.test.ts src/api/ws-transport.test.ts`
Exit status 1
```

After parent corrected the fixture URL matcher, the exact focused unit command above was rerun:
```text
Test Files  11 passed (11)
     Tests  145 passed (145)
  Start at  14:03:08
  Duration  4.62s (transform 4.52s, setup 0ms, import 7.73s, tests 5.10s, environment 2.56s)
```
Exit status 0; wall time 5.21s.

## Focused Chromium component suites
Command:
```sh
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-squash-dialog.browser.tsx browser-tests/git-history-dialog.browser.tsx browser-tests/project-worktree-target.browser.tsx
```

Result: exit 1; 3 test files (2 passed, 1 failed), 9 tests (8 passed, 1 failed), duration 25.23s. Chromium launched and ran tests (no executable/environment blocker).

Exact failure:
```text
❯ |chromium| browser-tests/git-squash-dialog.browser.tsx (6 tests | 1 failed) 17697ms
     × preserves row keyboard/context details independently of checkboxes in list 15164ms

 FAIL  |chromium| browser-tests/git-squash-dialog.browser.tsx > real squash controller modal input handoff > preserves row keyboard/context details independently of checkboxes in list
VitestBrowserElementError: Cannot find element with locator: getByRole('menu')
...
 ❯ browser-tests/git-squash-dialog.browser.tsx:294:51
    292|         { button: "right" },
    293|       );
    294|       await expect.element(page.getByRole("menu")).toBeVisible();
       |                                                   ^
    295|       expect(container.querySelector('[title="Cũ"]')).not.toBeNull();
    296|       await userEvent.keyboard("{Escape}");

Matcher timed out:
Error: Matcher did not succeed in time.

Failure screenshot:
browser-tests/__screenshots__/git-squash-dialog.browser.tsx/real-squash-controller-modal-input-handoff-preserves-row-keyboard-context-details-independently-of-checkboxes-in-list-1.png

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 8 passed (9)
   Start at  14:03:22
   Duration  25.23s (transform 0ms, setup 0ms, import 4.49s, tests 19.18s, environment 0ms)
Exit status 1
```
The browser run emitted repeated React warnings that updates in this case were not wrapped in `act(...)`.

### Chromium rerun after targeting visible row subject
Parent changed the test to right-click the visible subject text rather than the row midpoint. The same command above was rerun:
```sh
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-squash-dialog.browser.tsx browser-tests/git-history-dialog.browser.tsx browser-tests/project-worktree-target.browser.tsx
```

Result: exit 1; 3 files (2 passed, 1 failed), 9 tests (8 passed, 1 failed), 10.14s.

Exact latest failure:
```text
❯ |chromium| browser-tests/git-squash-dialog.browser.tsx (6 tests | 1 failed) 3040ms
     × preserves row keyboard/context details independently of checkboxes in list 559ms

FAIL  |chromium| browser-tests/git-squash-dialog.browser.tsx > real squash controller modal input handoff > preserves row keyboard/context details independently of checkboxes in list
VitestBrowserElementError: Cannot find element with locator: getByRole('row', { name: /Select bbbbbbb:/ })
...
 ❯ browser-tests/git-squash-dialog.browser.tsx:281:39
    279|       }
    280|       const newestRow = page.getByRole("row", { name: /Select bbbbbbb:… 
    281|       await act(async () => (newestRow.element() as HTMLElement).focus…
       |                                       ^
    282|       await userEvent.keyboard("{Enter}");
    283|       expect(container.querySelector('[title="Mới"]')).not.toBeNull();

Failure screenshot:
browser-tests/__screenshots__/git-squash-dialog.browser.tsx/real-squash-controller-modal-input-handoff-preserves-row-keyboard-context-details-independently-of-checkboxes-in-list-1.png

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 8 passed (9)
   Start at  14:08:43
   Duration  10.14s (transform 0ms, setup 0ms, import 4.03s, tests 4.68s, environment 0ms)
Exit status 1
```
The rerun still emitted repeated React warnings about updates not being wrapped in `act(...)`. It failed earlier at the accessible row lookup, before reaching the subsequent right-click assertion; the prior run's right-click failure is not confirmed fixed.

### Chromium rerun after adding fixture readiness waits
Parent added a wait for the filtered-row count and for the newest row to become visible. The same command above was rerun:
```sh
pnpm --filter @dam-hopper/ui test:browser browser-tests/git-squash-dialog.browser.tsx browser-tests/git-history-dialog.browser.tsx browser-tests/project-worktree-target.browser.tsx
```

Result: exit 1; 3 files (2 passed, 1 failed), 9 tests (8 passed, 1 failed), duration 24.51s.

Exact latest failure:
```text
❯ |chromium| browser-tests/git-squash-dialog.browser.tsx (6 tests | 1 failed) 17687ms
     × preserves row keyboard/context details independently of checkboxes in list 15204ms

FAIL  |chromium| browser-tests/git-squash-dialog.browser.tsx > real squash controller modal input handoff > preserves row keyboard/context details independently of checkboxes in list
VitestBrowserElementError: Cannot find element with locator: getByText('1–3 commits (filtered)', { exact: true })
...
 ❯ browser-tests/git-squash-dialog.browser.tsx:276:88
    274|           "shared search",
    275|         );
    276|         await expect.element(page.getByText("1–3 commits (filtered)", …
       |                                                                                        ^
    277|         await expect
    278|           .poll(() => container.querySelectorAll("tbody svg").length)

Caused by: Error: Matcher did not succeed in time.
 ❯ browser-tests/git-squash-dialog.browser.tsx:276:8

Failure screenshot:
browser-tests/__screenshots__/git-squash-dialog.browser.tsx/real-squash-controller-modal-input-handoff-preserves-row-keyboard-context-details-independently-of-checkboxes-in-list-1.png

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 8 passed (9)
   Start at  14:11:06
   Duration  24.51s (transform 0ms, setup 0ms, import 3.92s, tests 19.34s, environment 0ms)
Exit status 1
```
Repeated React `act(...)` warnings remained. The test failed waiting for the filtered-row count, before row/keyboard/context-menu assertions.

## Remaining unrun command
Production web asset build, with the server URL override unset:
```sh
env -u VITE_DAM_HOPPER_SERVER_URL pnpm build
```
Stopped at the latest actionable Chromium test failure; asset build was not run.

## Browser, performance, and build notes
- Chromium executable/environment: available for all runs; Vitest executed the Chromium project. No browser launch blocker.
- Chromium suites are component behavior coverage only, not full-stack validation.
- UI TypeScript build: 9.29s on successful rerun. Final focused UI run: 4.62s. Chromium runs: 25.23s, 10.14s, and 24.51s. Web asset build warnings/status: unavailable; asset build not run.
- Coverage not generated. No full-stack or application smoke claim.
- No source edits made during validation; parent made the reported fixes.

## Critical issue and next steps
The latest Chromium rerun timed out waiting for exact text `1–3 commits (filtered)` at `git-squash-dialog.browser.tsx:276`; the fixture did not reach its filtered-row readiness condition. Earlier runs of the same test failed at later row/menu assertions, so none of those behaviors is yet qualified. Investigate the fixture/search readiness and rerun the focused Chromium suites. Then run `env -u VITE_DAM_HOPPER_SERVER_URL pnpm build`.

## Unresolved questions
- Why does the browser fixture not expose the expected filtered commit-count status after the shared search?


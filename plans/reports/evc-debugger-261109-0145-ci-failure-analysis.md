# PR #84 — CI failure analysis

## Executive summary

PR: [#84 — feat(android): implement responsive agent hub first page and live workspace integration](https://github.com/loidinhm31/dam-hopper/pull/84).

**Blocking run:** [PR Quality Gate #42509156716, attempt 1](https://github.com/loidinhm31/dam-hopper/actions/runs/42509156716). Two failed checks; one independent failing job:

1. **Chromium browser regressions**: three assertions fail in two browser-test files.
2. **Quality Gate**: intentional downstream failure because `BROWSER_TESTS=failure`; not a separate application defect.

**Findings / repair priority:**

| Priority | Failure | Root cause / confidence | Proposed repair |
| --- | --- | --- | --- |
| P1 | Image preview request-body assertion | Confirmed stale test expects client discriminator `kind`; production serializer correctly emits canonical wire discriminator `type`. | Change one expected field in `explorer-image-preview.browser.tsx:135`; preserve production serializer. |
| P1 | Renamed profile project-tab locator | Confirmed stale test assumes profile name remains inside each project tab. Current UI renders profile identity in a separate section header. Rename propagation and focused-row preservation already pass earlier assertions. | Assert the renamed profile-section button, then assert the alpha tab inside its controlled group. |
| P1 | Compact filter geometry at 320px | Confirmed horizontal containment failure: right edge `326.8125px` exceeds the allowed `324px`. Static sizing chain indicates intrinsic grid/flex minimum-width propagation; exact ancestor contribution remains [INFERENCE], not measured in a live diagnostic session. | Constrain the sheet grid track and navigator to shrink; allow compact project metadata to wrap rather than forcing a single nonshrinking row. Keep existing geometry/touch thresholds. |

Impact: PR merge gate blocked. Two failures are test-contract drift; the third detects an actual measured compact-layout containment violation. Logs do not establish a backend, dependency-install, browser-launch, or Android build failure. No implementation changed during this investigation.

## Scope and provenance

- PR created: `2026-11-08T18:16:20Z`.
- Run created: `2026-11-08T18:16:24Z`; event `pull_request`; attempt `1`; conclusion `failure`.
- PR head and local `git rev-parse HEAD`: `7640442d9d8314376380f04de92bb9f7378d0225`.
- CI checks out synthetic merge `760310f505ffa43cf7447affa4d6c181099fd8f9`, merging that head into base `1050844db9b8db55d2493cae30b5206277231f93`. Checkout log explicitly names `refs/remotes/pull/84/merge`.
- Browser runner: Ubuntu 22.04.5, image `20261101.347.1`, Node `24.22.2`, pnpm `10.34.9`, Vitest `4.1.5`, Playwright Chromium provider.
- Browser files execute serially (`packages/ui/vitest.browser.config.ts:411–426`). No parallel browser-file execution explains these failures.

Branch history also returns runs `42354016018` (success, November 7) and `42331116964` (failure, November 7). These **predate PR #84 creation**. The older failed run's checkout log explicitly says `refs/remotes/pull/83/merge` and merge `98adbe99b5e76ffada6ceef8b967aa96dafd4183`; its title is the preceding OS redesign PR. GitHub's current run API associates the reused branch with #84, so that field alone is insufficient historical provenance. Those previous-PR failures are not current #84 check failures. This report diagnoses every failed job in #84's current check rollup, not obsolete failures from the earlier branch PR.

## Exact failed jobs and steps

| Job | Job ID | Failed step | Timing (UTC) | Command / exit |
| --- | --- | --- | --- | --- |
| [Chromium browser regressions](https://github.com/loidinhm31/dam-hopper/actions/runs/42509156716/job/128818230735) | `128818230735` | Step 7, **Run all UI browser tests** | Step command logged `18:17:13`; failure `18:19:54`; job `18:16:27–18:19:57` | `pnpm --filter @dam-hopper/ui test:browser`; exit 1 |
| [Quality Gate](https://github.com/loidinhm31/dam-hopper/actions/runs/42509156716/job/128822906311) | `128822906311` | Step 2, **Require every quality job** | Step `18:34:43–18:34:44`; job `18:34:42–18:34:46` | Required-results shell loop; exit 1 |

Browser checkout, dependency installation and Chromium installation all succeeded. Result summary:

```text
Test Files  2 failed | 62 passed | 2 skipped (66)
Tests       3 failed | 355 passed | 4 skipped (362)
Duration    160.63s
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ... test:browser:
  `vitest run --config vitest.browser.config.ts`
Exit status 1
Process completed with exit code 1.
```

The other ten checks passed: static lint/typecheck/frontend builds; JS shared, browser-bridge, UI and create-admin; Rust Linux and Windows; release contract Linux and Windows; Application E2E journeys. Existing skipped tests are retained in the summary; not claimed as exercised.

## Failure 1 — image-preview wire assertion uses wrong discriminator

### Exact log excerpt and stack location

At `2026-11-08T18:19:54.5559753Z`:

```text
FAIL chromium browser-tests/explorer-image-preview.browser.tsx
  > Explorer image preview in Chromium
  > renders a real raster fixture through the opaque native image source
AssertionError: expected { …(3) } to deeply equal { …(3) }

  {
    "mediaClientId": "9b0aca24-8b7f-49f2-9c90-039375e7ceca",
    "path": "images/fixture.png",
    "target": {
-     "kind": "project",
      "project": "demo",
+     "type": "project",
    },
  }

❯ browser-tests/explorer-image-preview.browser.tsx:134:6
135| target: { kind: "project", project: "demo" },
```

### Evidence chain

1. `packages/ui/browser-tests/explorer-image-preview.browser.tsx:109–138` renders a real raster fixture, waits for native dimensions `1 × 1`, visibility and `Ready to view`, then checks the intercepted POST body. The failure occurs at the final wire assertion, **after successful rendering/readiness checks**.
2. `packages/ui/src/components/organisms/ImagePreview.tsx:131–142` creates a client-side `FsTargetRef` with `kind: "project"` and calls `issueImageTicket`.
3. `packages/ui/src/api/image-tickets.ts:85–92,220–231` explicitly projects client refs through `toServerFsTarget` before JSON serialization.
4. `packages/ui/src/api/ownership.ts:44–55` distinguishes client `FsTargetRef.kind` from server `ServerFsTarget.type`; `:241–261` returns `{ type: "project", project }` for this request.
5. `server/src/api/fs_image.rs:32–44` consumes `FilesystemTargetRef`; `server/src/workspace_target.rs:44–76` declares canonical serialization tag `type` and accepts either `type` or legacy `kind` when deserializing. Thus **the server is not rejecting `type`**.

**Root cause:** assertion confuses internal client-reference representation with network DTO representation. Production output matches canonical TypeScript and Rust contracts. Browser fixture middleware (`vitest.browser.config.ts:287–330`) serves successful image tickets but does not validate the target discriminator, so rendering can succeed before this stale strict assertion fails.

### Exact recommended change

In `packages/ui/browser-tests/explorer-image-preview.browser.tsx:135`:

```diff
- target: { kind: "project", project: "demo" },
+ target: { type: "project", project: "demo" },
```

Keep the strict request-body assertion, path, media-client ID and credential assertions. Do not change `toServerFsTarget`, revert the canonical wire format, or add a new compatibility shim.

## Failure 2 — rename test searches the wrong accessible element

### Exact log excerpt and stack

At `2026-11-08T18:19:54.5631964Z`:

```text
FAIL chromium browser-tests/terminal-traditional-projects.browser.tsx
  > Traditional terminal projects in Chromium
  > reactively updates registered profile labels without replacing focused rows
VitestBrowserElementError: Cannot find element with locator:
  getByRole('tab', { name: /alpha.*Renamed server A/ })

❯ browser-tests/terminal-traditional-projects.browser.tsx:1713:7
1711| await expect
1712|   .element(page.getByRole("tab", { name: /alpha.*Renamed server A/ }))
1713|   .toBeVisible();

Caused by: Error: Matcher did not succeed in time.
❯ browser-tests/terminal-traditional-projects.browser.tsx:1711:4
```

Vitest reports this test at `15067ms`. DOM excerpt is abbreviated (`<div … />`); it does not provide a complete accessibility tree.

### Evidence chain

1. Test at `:1698–1713` renames the registered profile with `saveProfiles`.
2. Assertions at `:1709–1710` already succeed: retained agent row's `aria-label` contains `Renamed server A`, and `document.activeElement` remains the original row. Failure is **not** at rename publication or focus preservation.
3. `TraditionalTerminalProjectsDisplay.tsx:185–194,214–227` subscribes to profile-change versions and rebuilds group/profile presentation. Adding another subscription would address the wrong problem. This use matches [React's external-store subscription contract](https://react.dev/reference/react/useSyncExternalStore).
4. `TraditionalTerminalProjectsNavigator.tsx:103–122,218–248` groups projects into profile sections. Profile name belongs to a separate disclosure button, `aria-label="Server profile: ${section.profileName}"`, with `aria-controls={sectionId}`.
5. `TraditionalTerminalProjectWorkspaceRow.tsx:166–218` renders each `role="tab"` from project label and terminal count; no profile name or profile badge remains inside that tab.
6. Existing component test `TraditionalTerminalProjectsNavigator.test.tsx:446–474` already asserts profile context on `Server profile: Development`, separately from project tabs. The browser assertion did not migrate to that convention.

**Root cause:** obsolete accessible-name expectation after profile-section UI refactoring. No amount of waiting makes an alpha project tab acquire the separate profile-header name.

### Exact recommended change

In `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx:1711–1713`, replace the compound tab-name lookup with:

1. Assert visible `page.getByRole("button", { name: "Server profile: Renamed server A", exact: true })`.
2. Read that header's `aria-controls`, locate the corresponding profile `role="group"`, and assert the alpha `role="tab"` inside it is visible.
3. Keep the original retained-row label and `document.activeElement` assertions at `:1709–1710` unchanged. Optionally assert the old `Server profile: Server A` header is absent to make rename coverage explicit.

Do not reinsert redundant per-project profile badges solely to satisfy an obsolete locator; do not weaken the test to a page-wide text search or increase its timeout.

## Failure 3 — compact sheet filter exceeds 320px viewport

### Exact log excerpt and stack

At `2026-11-08T18:19:54.5906602Z`:

```text
FAIL chromium browser-tests/terminal-traditional-projects.browser.tsx
  > Traditional terminal projects in Chromium
  > verifies compact filter touch target sizing (>=48px) and layout geometry at 320px
AssertionError: expected 326.8125 to be less than or equal to 324
❯ browser-tests/terminal-traditional-projects.browser.tsx:2000:32

1998| expect(triggerRect.height).toBeGreaterThanOrEqual(48);
1999| expect(triggerRect.width).toBeGreaterThanOrEqual(48);
2000| expect(triggerRect.right).toBeLessThanOrEqual(width + 4);
```

The 375px and 390px variants pass. Height/width touch-target assertions precede the failed right-edge assertion and did not fail. This is **horizontal containment**, not failure to achieve 48px height. Overflow is `6.8125px` beyond the viewport, `2.8125px` beyond the existing tolerance.

### Layout trace and confidence

- Test `:1979–2000` sets viewport/container width to 320, enables compact presentation, opens the Projects + Agents dialog, then measures the filter.
- `TraditionalTerminalProjectsDisplay.tsx:689–731` hosts the navigator as a direct child of `DialogContent`.
- `components/ui/Dialog.tsx:43–46` supplies `display:grid` without an explicitly shrinkable column. The compact override sets full width but does not define `grid-template-columns:minmax(0,1fr)`.
- `TraditionalTerminalProjectsNavigator.tsx:169–175` supplies a fixed-width desktop/flex container and switches to `w-full` for touch mode, but has no `min-w-0` on the grid-item navigator. `min-h-0` only addresses the vertical axis.
- `TraditionalTerminalProjectWorkspaceRow.tsx:256–312` changes compact Git metadata to one nonwrapping flex row. Branch and commit chips are `shrink-0`; worktree controls and indentation add to its intrinsic width. This is a concrete source of minimum-content pressure on the containing grid.
- The filter wrapper and trigger (`traditional-terminal-agent-filter.tsx:385,408–415`) already use `w-full`; the button even has `min-w-0`. A child at 100% width does not repair an oversized containing track.

**Confirmed root component:** compact Projects + Agents sheet/navigator width containment. **Most likely underlying CSS mechanism [INFERENCE]:** implicit grid minimum-content track plus the navigator's automatic minimum width propagates nonwrapping compact project metadata width to the otherwise full-width filter. Logs provide the final filter rectangle, not ancestor computed widths, so the exact contribution of each ancestor cannot honestly be labeled runtime-proven. Dialog entrance transforms are another measurement confounder; the current visibility wait does not explicitly await CSS animation completion. No evidence supports calling this merely CI slowness or changing the tolerance.

### Exact recommended repair sequence

1. In `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx:698`, add `min-w-0 grid-cols-[minmax(0,1fr)]` to the compact dialog's class list. Keep full-width placement and safe-area behavior.
2. In `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx:173–175`, add `min-w-0` to the root navigator; for touch presentation constrain it with `max-w-full` in addition to existing `w-full border-r-0`. Keep desktop resize behavior unchanged.
3. In `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx:259–261`, change compact metadata layout from `flex items-center ...` to `flex min-w-0 flex-wrap items-center ...`; allow the worktree selector to take a separate full-width row at compact width if needed. Preserve all branch/commit information and controls rather than hiding them or clipping overflow.
4. Keep `terminal-traditional-projects.browser.tsx:1998–2011` touch sizes and horizontal thresholds. For reliable diagnostics, await the dialog's own running animations with `getAnimations()`/`finished`, then collect dialog, navigator and filter rectangles plus computed `min-width`, grid columns and transform in any failure message. This distinguishes persistent overflow from an entrance-frame sample without arbitrary sleeps or threshold relaxation.
5. Main agent should qualify 320/375/390px cases after repair, including all eight dropdown options; the 320px test currently stops before those option measurements. Do not claim dropdown containment from the failing run.

## Downstream Quality Gate — correct failure propagation

Exact log at `2026-11-08T18:34:43.9990732Z` onward:

```text
STATIC_BUILD: success
JS_TESTS: success
BROWSER_TESTS: failure
APPLICATION_E2E: success
SERVER_LINUX: success
SERVER_WINDOWS: success
RELEASE_LINUX: success
RELEASE_WINDOWS: success
A required quality job finished with: failure
Process completed with exit code 1.
```

`.github/workflows/pr-quality-gate.yml:250–289` uses `if: always()`, requires all eight job groups, and exits on any result other than `success`. Browser result is the only nonsuccess input. **No workflow bypass/fix needed.** A rerun of only the aggregator against the same failed dependencies cannot repair the underlying result; do not add `continue-on-error` or remove the browser dependency.

## Action plan and validation handoff

Implementation scope, in order:

1. Correct image wire DTO expectation in `packages/ui/browser-tests/explorer-image-preview.browser.tsx`.
2. Migrate profile-rename browser assertion to profile-header/group semantics in `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`.
3. Repair compact sheet/navigator intrinsic sizing in the three components listed above; retain meaningful geometry coverage and collect stable geometry diagnostics.
4. Record the actual fix and evidence in existing project changelog when implementation lands. This investigation itself changes only this report.
5. Main agent runs focused browser files first, then full required browser job and normal PR quality workflow:

```bash
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/explorer-image-preview.browser.tsx browser-tests/terminal-traditional-projects.browser.tsx
pnpm --filter @dam-hopper/ui test:browser
```

Expected acceptance after repair: image target is exactly `{ type: "project", project: "demo" }`; renamed header and its alpha tab visible while original agent-row focus remains; all compact trigger/options retain >=48px targets and fit the tested widths; fresh Chromium and aggregate Quality Gate succeed. These are **proposed checks, not executed outcomes**.

Risk: low for assertion migrations; moderate for responsive CSS because the navigator also serves desktop resizing and Hub workspace metadata. Test compact and wide presentations. No auth/media-session weakening, server migration, dependency update or Android change is indicated by this run.

## Investigation evidence / limitations

Executed read-only evidence collection:

- `gh pr view 84 --repo loidinhm31/dam-hopper --json ...`
- `gh pr checks 84 --repo loidinhm31/dam-hopper`
- `gh run list --repo loidinhm31/dam-hopper --branch feat/ai-os-redesign --event pull_request --limit 15 --json ...`
- `gh run view 42509156716 --repo loidinhm31/dam-hopper --json ...`
- `gh run view 42509156716 --repo loidinhm31/dam-hopper --log-failed`
- `gh run view 42509156716 --repo loidinhm31/dam-hopper --job 128818230735 --log`
- `gh api repos/loidinhm31/dam-hopper/actions/runs/...` for run provenance.
- `gh run view 42331116964 --repo loidinhm31/dam-hopper --log-failed` to distinguish the previous PR checkout from current checks.
- Local source/config/test inspection; local head identification; targeted source history. Fresh scoped remote Repomix context generated, read, then removed as temporary research material; current recent `docs/codebase-summary.md` used for architecture context.
- Debugging and problem-solving skill instructions read. Documentation-seeker lookup returned no Context7 document; primary React documentation consulted directly instead.

No tests, builds, linters, formatters, CI reruns, source fixes, database operations or deployment changes executed. React `act(...)` warnings and Node-action deprecation notices appear in logs, but the runner names exactly the three assertion failures above; those notices are not demonstrated causes. The backend and application E2E success statuses are GitHub evidence, not fresh local qualification.

## Unresolved questions

- Which compact ancestor accounts for the exact `326.8125px` right edge after entrance animations settle? CI lacks ancestor computed geometry. Intrinsic grid/flex minimum sizing is source-supported; main agent should capture stable ancestor rectangles while qualifying the proposed CSS repair. No blocker remains to correct the two confirmed stale assertions.

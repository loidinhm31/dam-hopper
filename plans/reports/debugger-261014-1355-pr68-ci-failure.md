# PR #68 CI failure diagnosis

## Executive summary

PR: https://github.com/loidinhm31/dam-hopper/pull/68
Run: https://github.com/loidinhm31/dam-hopper/actions/runs/38522920738
Commit: `bc451c4eb52d603a0188143ee794ba4595c2c788` (run head SHA, current PR head, and local HEAD match).

**Root cause: three existing test mocks violate the new settings-store selector contract.** PR #68 changes `FileTree` from destructuring `useSettingsStore()` to separate selector calls. The failing suites still implement the hook as `() => ({ ... })`, ignoring the selector. They therefore supply objects where `FileTree` expects booleans, strings, numbers, and functions.

**Recommended fix (proposed, not executed):** update those three mocks to apply selectors and supply the normal numeric font-size default. Preserve production selectors and existing assertions. Do not suppress warnings, skip tests, add waits, or mask object-valued settings in the typography helper.

No application code changed. No local tests/builds rerun. Findings grounded in retrieved CI logs, PR patch, and source at the failed commit; green CI after the proposed correction remains unverified.

## Failing jobs and steps

Commands exercised:

```sh
gh pr checks 68
gh run view 38522920738 --log-failed
gh run view 38522920738 --json headSha,headBranch,event,createdAt,updatedAt,conclusion,jobs,url
gh pr view 68 --json headRefOid,headRefName,baseRefName,files,url
gh api repos/loidinhm31/dam-hopper/pulls/68/files --paginate
```

| Check | Failed step | Result |
| --- | --- | --- |
| [JS tests - ui](https://github.com/loidinhm31/dam-hopper/actions/runs/38522920738/job/115716527686) | `Run ui tests` (`vitest run` in UI package) | 4 failed, 2,916 passed; 1 failed file, 326 passed files; exit 1 |
| [Chromium browser regressions](https://github.com/loidinhm31/dam-hopper/actions/runs/38522920738/job/115716527277) | `Run all UI browser tests` (`pnpm --filter @dam-hopper/ui test:browser`) | 9 failed, 301 passed, 4 skipped; 2 failed files, 52 passed, 2 skipped; exit 1 |
| [Quality Gate](https://github.com/loidinhm31/dam-hopper/actions/runs/38522920738/job/115722205225) | `Require every quality job` | Dependent failure: `JS_TESTS: failure`, `BROWSER_TESTS: failure` |

Other 11 checks passed, including lint/typecheck/frontend builds, application E2E, native/server jobs, and release contracts. This is not a compilation or dependency-installation failure.

Timeline (UTC): run created 06:33:35; UI failure summary 06:35:18; browser failure summary 06:36:10; aggregate gate failed 06:51:41.

## Exact assertion failures

Paths below relative to `packages/ui/`.

### Unit: `src/components/organisms/ContextMenuConsumers.test.tsx`

| Test | Assertion location | Error |
| --- | --- | --- |
| creates a file at project root from the Explorer toolbar | `388:23` | `AssertionError: expected null not to be null` (`#name` input missing) |
| renames once through the focus-safe dialog | `419:23` | `AssertionError: expected null not to be null` (`#rename-item-name` input missing) |
| closes the rename dialog and reports a rejected filesystem request | `454:23` | `AssertionError: expected null not to be null` (`#rename-item-name` input missing) |
| deletes the selected entries once and ignores selected descendants | `514:45` | `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times` (`deleteEntry`) |

Representative CI trace:

```text
FAIL src/components/organisms/ContextMenuConsumers.test.tsx
  > migrated context-menu consumers
  > creates a file at project root from the Explorer toolbar
AssertionError: expected null not to be null
❯ src/components/organisms/ContextMenuConsumers.test.tsx:388:23
387| const input = document.querySelector<HTMLInputElement>("#name");
388| expect(input).not.toBeNull();

ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @dam-hopper/ui@0.13.1 test: `vitest run`
Exit status 1
```

### Browser: `browser-tests/consumer-context-menu.browser.tsx`

All five errors: `AssertionError: expected null not to be null`.

| Test | Location | Missing element |
| --- | --- | --- |
| opens one touch-held Explorer menu, deduplicates native fallback, and targets the held row | `388:21` | `main.ts` row |
| keeps the production virtual rows mounted and targets the originating file | `653:21` | `main.ts` row |
| creates a file at the project root from the Explorer toolbar | `724:22` | `#name` input |
| keeps rename usable after the context menu closes and submits once | `750:21` | `main.ts` row |
| renders Preview action on right-click for HTML files and invokes onFileOpen | `899:25` | `index.html` row |

Earlier stderr from this suite:

```text
2026-10-14T06:35:16.0340343Z
`NaN` is an invalid value for the `height` css style property.
```

### Browser: `browser-tests/file-tree-language-navigation.browser.tsx`

| Test | Location | Error |
| --- | --- | --- |
| renders a navigation-only hierarchy and opens exact scan metadata | `158:23` | `expected null not to be null` (first tree item) |
| shows manual scan, stale, truncated, error, and rescan states | `200:34` | Expected `Scan project to show Rust files`; received `Explorer.*demoFilter Explorer by languageAllRustJS/TSJava` |
| keeps no-result scans usable and remounts after a same-generation rescan | `232:30` | `expected null not to be null` (first tree item) |
| resets filtered reveal to All before committing the live tree | `261:33` | Expected spy call with `[{ explorerLanguageFilter: 'all' }]`; number of calls `0` |

### Quality Gate

```text
STATIC_BUILD: success
JS_TESTS: failure
BROWSER_TESTS: failure
APPLICATION_E2E: success
...
A required quality job finished with: failure
Process completed with exit code 1.
```

Gate code in `.github/workflows/pr-quality-gate.yml:351-383` intentionally rejects any non-success dependency. No separate gate fix needed.

## Technical cause chain

PR patch changes `FileTree` near lines 343-352 from:

```ts
const {
  explorerShowHidden: showHidden,
  explorerLanguageFilter: configuredLanguageFilter,
  saveDebounced,
} = useSettingsStore();
```

to:

```ts
const showHidden = useSettingsStore((s) => s.explorerShowHidden);
const configuredLanguageFilter = useSettingsStore((s) => s.explorerLanguageFilter);
const systemFontSize = useSettingsStore((s) => s.systemFontSize);
const saveDebounced = useSettingsStore((s) => s.saveDebounced);
```

Incompatible mocks remain at:

- `ContextMenuConsumers.test.tsx:145-150`.
- `consumer-context-menu.browser.tsx:140-145`.
- `file-tree-language-navigation.browser.tsx:89-95`.

Each ignores the selector argument and creates a new state object on every call.

Consequences:

1. **Dialogs reset every render.** `showHidden` is a fresh object, not a boolean. The effect at `FileTree.tsx:460-468` depends on it and invokes `clearTreeSelection()` on every rerender. That callback at lines 439-458 clears new-item, rename, and delete state. Opening a dialog triggers a rerender, immediately clearing it. Explains missing create/rename inputs and zero delete calls, including unit tests where Arborist itself is mocked.
2. **Invalid virtualization dimensions.** `systemFontSize` is an object, not a number. In `workbench-typography.ts:19-23`, the object is truthy so `systemFontSize || 14` does not fall back; numeric clamping coerces it to `NaN`. The computed row height becomes `NaN` and is passed to Arborist at `FileTree.tsx:1116`. CI logs explicitly show the invalid height warning; this invalid geometry explains missing consumer virtual rows.
3. **Wrong language mode.** `configuredLanguageFilter` is an object, so `isExplorerLanguageFilter()` rejects it and `FileTree.tsx:353-358` falls back to `"all"`. The language tests intend `"rust"` and have empty live nodes; switching to live mode itself explains absent language rows, missing scan prompt, and absence of the expected Rust-to-All settings update. Do not attribute all language failures solely to row-height `NaN`.
4. **Action contract also broken.** `saveDebounced` becomes an object instead of a function. Correcting numeric font size alone is insufficient; all selected values must be returned correctly.

Production Zustand store defines numeric `systemFontSize: 14` at `packages/ui/src/stores/settings.ts:319`. Existing selector-aware mock convention: `PaneContainer.test.tsx:21-24` applies an optional selector and otherwise returns the full state. Reuse this convention.

## Exact recommended correction

Update all three test mocks, not production `FileTree`.

For the two ordinary context-menu suites, use stable hoisted mock state with:

```ts
const settingsState = vi.hoisted(() => ({
  explorerShowHidden: true,
  explorerLanguageFilter: "all",
  systemFontSize: 14,
  saveDebounced: vi.fn(),
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof settingsState) => unknown) =>
    selector ? selector(settingsState) : settingsState,
}));
```

For the language-navigation suite, retain its dynamically changing filter and settings spy:

```ts
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: {
    explorerShowHidden: boolean;
    explorerLanguageFilter: typeof harness.filter;
    systemFontSize: number;
    saveDebounced: typeof harness.saveSettings;
  }) => unknown) => {
    const state = {
      explorerShowHidden: false,
      explorerLanguageFilter: harness.filter,
      systemFontSize: 14,
      saveDebounced: harness.saveSettings,
    };
    return selector ? selector(state) : state;
  },
}));
```

Read `harness.filter` each invocation; do not capture its initial value before `beforeEach` or rerenders. Selected primitive values and action references remain stable even when a local state wrapper is constructed anew.

## Validation required after correction

Suggested commands; **not executed during this investigation**:

```sh
pnpm --filter @dam-hopper/ui exec vitest run src/components/organisms/ContextMenuConsumers.test.tsx
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts browser-tests/consumer-context-menu.browser.tsx browser-tests/file-tree-language-navigation.browser.tsx
pnpm --filter @dam-hopper/ui test
pnpm --filter @dam-hopper/ui test:browser
```

Then rerun failed PR jobs and confirm aggregate Quality Gate succeeds. Retain all assertions; expected acceptance is zero failures in the three suites and both complete UI jobs.

## Non-causal log noise

Logs include React `act(...)` warnings and `No QueryClient set, use QueryClientProvider to set one` from `server-settings-mfa-mobile.browser.tsx`, caught by its error boundary. That suite passed all 4 tests. The new `selection-contrast-and-typography.browser.tsx` suite passed all 7 tests. These messages are not the failing assertions identified above; do not mistake them for the root cause of the failed checks.

## Unresolved questions

None for diagnosis. Proposed correction has not been applied or executed; post-fix CI outcome remains unverified.

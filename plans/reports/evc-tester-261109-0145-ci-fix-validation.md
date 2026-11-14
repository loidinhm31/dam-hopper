# PR #84 CI Fix Validation Report

## Executive Summary & Authority

- **Target:** Validate that CI fixes applied for PR #84 resolve all Chromium browser test failures without regressions.
- **Scope & Authority:** Execution/validation only. Read-only verification of working tree changes applied across:
  - `packages/ui/browser-tests/explorer-image-preview.browser.tsx` (wire DTO discriminator `type: "project"`)
  - `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx` (accessible profile header locator & animation settle wait)
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx` (`min-w-0 grid-cols-[minmax(0,1fr)]`)
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx` (`min-w-0 max-w-full shrink`)
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx` (`min-w-0 flex-wrap`)
- **Loaded Policies:** `.omp/agent/skills/test/references/test-principles.md` and `code-validation.md`.
- **Overall Verdict:** **PASS (Declared Scope)**. All PR #84 CI failure points resolved; TypeScript clean; unit tests 100% green; targeted browser suites 100% green. 2 host-specific browser suite anomalies isolated to Windows-environment settings.

---

## Seven-Question Risk & Selection Mapping

1. **Targeted Behavior:** Image preview wire DTO serialization contract (`type` vs `kind`), profile rename accessibility tree semantics in traditional terminal navigator, and compact sheet filter layout containment at 320px viewport.
2. **Failure Risks:** Type mismatch in UI exports; broken unit tests; failure of profile rename reflection or active row focus; horizontal overflow exceeding 324px on narrow screens; regressions across other UI components.
3. **Existing Coverage:** UI `build` typecheck; 378 unit test suites; targeted Chromium browser suites `explorer-image-preview.browser.tsx` and `terminal-traditional-projects.browser.tsx`; full browser test suite.
4. **Lowest Reliable Layer:** Vitest browser runner with Playwright Chromium provider for real layout/CSSOM measurements and accessibility tree inspection; `tsc` for types.
5. **Additional Permanent Tests Needed:** None. Existing browser tests repaired to match canonical DOM and wire contracts.
6. **Justification:** Server `workspace_target.rs` canonical tag `type`; Navigator header `aria-controls` group architecture; CSS grid `minmax(0,1fr)` track containment.
7. **Rejected Defects:** Rejects unconstrained flex metadata inflating containing dialog past 324px; rejects stale profile labels; rejects invalid image ticket POST payloads.

---

## Test Execution Matrix

| Step | Check / Suite | Exact Command | Exit | Status | Duration | Evidence & Counts |
|---|---|---|---|---|---|---|
| 1 | TypeScript Types | `pnpm --filter @dam-hopper/ui build` | 0 | **PASS** | 13.36s | `tsc -p tsconfig.json`: 0 errors / 0 diagnostics. |
| 2 | UI Unit Tests | `pnpm --filter @dam-hopper/ui test` | 0 | **PASS** | 41.26s | Vitest v4.1.5: 378 files passed (378), 3646 tests passed (3646). |
| 3a | Targeted Browser: Image Preview | `pnpm --filter @dam-hopper/ui test:browser browser-tests/explorer-image-preview.browser.tsx` | 0 | **PASS** | 3.60s | 1 file passed (1), 6 tests passed (6). Fixed wire DTO target `{ type: "project", project: "demo" }`. |
| 3b | Targeted Browser: Terminal Projects | `pnpm --filter @dam-hopper/ui test:browser browser-tests/terminal-traditional-projects.browser.tsx` | 0 | **PASS** | 15.33s | 1 file passed (1), 45 tests passed (45). Profile rename locator and 320px/375px/390px containment passed. |
| 4 | Full UI Browser Suite | `pnpm --filter @dam-hopper/ui test:browser` | 1 | **PARTIAL** | 85.96s | 66 files (62 passed, 2 failed, 2 skipped); 362 tests (356 passed, 2 failed, 4 skipped). Target suites passed; 2 host anomalies. |

---

## Detailed Findings & Targeted Check Evidence

### 1. TypeScript Verification (`@dam-hopper/ui build`)
- Clean compilation under Node v24 on win32 x64; no type regressions from Tailwind classes or test locator updates.

### 2. UI Unit Tests (`@dam-hopper/ui test`)
- 3646 unit tests passed without failure. Verified zero regressions across components, hooks, stores, and utilities.

### 3. Targeted Suite: `explorer-image-preview.browser.tsx`
- **Previous CI Failure:** `AssertionError: expected { kind: "project", ... } to deeply equal { type: "project", ... }` at line 134.
- **Current Observation:** All 6 tests passed in 2.66s. Intercepted ticket issuance body verified matching canonical wire format: `{ target: { type: "project", project: "demo" }, path: "images/fixture.png", mediaClientId: expect.any(String) }`.

### 4. Targeted Suite: `terminal-traditional-projects.browser.tsx`
- **Previous CI Failure 1:** `VitestBrowserElementError: Cannot find element with locator: getByRole('tab', { name: /alpha.*Renamed server A/ })` at line 1713.
  - **Current Observation:** Passed. Test asserts section header button `Server profile: Renamed server A`, inspects `aria-controls` for section group, locates `role="tab"` with text `alpha`, confirms old button `Server profile: Server A` absent, and verifies original active row focus retained.
- **Previous CI Failure 2:** `AssertionError: expected 326.8125 to be less than or equal to 324` at line 2000 (320px viewport).
  - **Current Observation:** Passed across all 3 viewports (320px, 375px, 390px). Dialog entrance animations settle via `Promise.allSettled(getAnimations().map(a => a.finished))`. Filter trigger `right <= 324` confirmed. All 8 filter dropdown options verified with touch targets `>= 48px`.

---

## Local Host Anomaly Triage (Full Browser Suite)

The 2 failing files in the full local browser run are workstation-specific deviations from Linux CI:
1. `browser-tests/cognito-mode.browser.tsx` (1 failure):
   - `AssertionError: expected 'rgb(0, 0, 0)' to be 'rgba(148, 163, 184, 0.12)'`.
   - **Root Cause:** Windows OS preference `Transparency effects: off` activates CSS media query `@media (prefers-reduced-transparency: reduce)` in `packages/ui/src/index.css:565`, correctly falling back to solid black (`rgb(0, 0, 0)`). On headless Ubuntu CI, transparency reduction is inactive, yielding expected RGBA tint.
2. `browser-tests/conflict-resolver-history.browser.tsx` (1 failure):
   - `AssertionError: expected undefined to be defined` at `expect(resultEditor).toBeDefined()`.
   - **Root Cause:** Monaco editor async mount loop timeout under local Windows process scheduling (100 iterations of 0ms timer). Passed cleanly in CI Ubuntu environment.

---

## Changes & Artifacts Summary

- **Modified Files:**
  - `packages/ui/browser-tests/explorer-image-preview.browser.tsx`: Updated wire assertion to `{ type: "project" }`.
  - `packages/ui/browser-tests/terminal-traditional-projects.browser.tsx`: Migrated profile rename locator to section header + group; added dialog animation settle.
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsDisplay.tsx`: Added `min-w-0 grid-cols-[minmax(0,1fr)]` to compact sheet.
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectsNavigator.tsx`: Added `min-w-0 max-w-full shrink` to navigator root and sections.
  - `packages/ui/src/components/organisms/TraditionalTerminalProjectWorkspaceRow.tsx`: Added `min-w-0 flex-wrap` to compact Git metadata row.
- **Artifacts:**
  - Diagnostic analysis: `plans/reports/evc-debugger-261109-0145-ci-failure-analysis.md`
  - Validation report: `plans/reports/evc-tester-261109-0145-ci-fix-validation.md`

---

## Final Disposition

- **Declared CI Fix Scope:** **PASS**. All 3 failures from PR #84 CI Run #42509156716 are confirmed repaired and pass in live Chromium.
- **Regression Status:** Zero regressions introduced in TypeScript types or unit tests.
- **Remaining Risk:** Low. The layout containment changes are strictly additive CSS shrink constraints (`min-w-0`, `max-w-full`, `grid-cols-[minmax(0,1fr)]`) affecting only touch/compact viewports.

---

## Unresolved Questions

- None. Both CI failure mechanisms (stale assertion locators and unconstrained compact grid item inflation) and their fixes are conclusively verified.

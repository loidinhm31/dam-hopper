# CI Diagnostic Report: Chromium browser regressions Failure

**Run ID**: 37232644936  
**Job ID**: 111525414751 (`Chromium browser regressions`)  
**PR**: #45 (`feat/settings-collapse-by-default`)  
**Branch**: `feat/settings-collapse-by-default`  
**Date**: 2026-10-05  

---

## 1. Executive Summary

In GitHub Actions run `37232644936` on PR #45, the job `Chromium browser regressions` failed during the step `Run all UI browser tests` (`pnpm --filter @dam-hopper/ui test:browser`).

The failure was **not** caused by settings sections collapsing by default. Rather, it was caused by a hardcoded local absolute path (`/home/loidinh/...`) in a Playwright screenshot call inside an E2E test file (`counsel-evaluations-responsive.e2e.tsx`), coupled with Vite not exposing `CI=true` to `import.meta.env` in client browser bundles, causing the CI guard `if (!import.meta.env.CI)` to evaluate to `true` on the GitHub Actions runner.

---

## 2. Failing Test(s) & Error Details

### Primary Failure
- **File**: `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx:141:6`
- **Suite**: `E2E: Counsel Evaluations Responsive Layout`
- **Test Case**: `renders Counsel Evaluations (2 descriptors) in narrow container with clean vertical stacking`
- **Error**:
  ```text
  Error: EACCES: permission denied, mkdir '/home/loidinh'
    ❯ e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx:141:6
  ```
- **Code snippet**:
  ```typescript
  139|    if (!import.meta.env.CI) {
  140|      await page.viewport(1280, 800);
  141|      await page.screenshot({
  142|        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/counsel-evaluations-responsive/screenshot.png",
  143|      });
  144|    }
  ```

### Latent Secondary Failure
- **File**: `packages/ui/browser-tests/advisor-routing.browser.tsx:155:6`
- **Suite**: `Advisor routing editor and harness model selector (Browser Mode)`
- **Test Case**: `renders routing form, switches to codex model catalog, and persists edits`
- **Code snippet**:
  ```typescript
  153|    if (!import.meta.env.CI) {
  154|      await page.viewport(1280, 800);
  155|      await page.screenshot({
  156|        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/advisor-model-dropdown-theme/screenshot.png",
  157|      });
  158|    }
  ```
- **Status**: Did not execute because `test:browser` runs `vitest run --config vitest.browser.config.ts && vitest run --config vitest.advisor-routing.browser.config.ts`. The first suite failed on `counsel-evaluations-responsive.e2e.tsx`, so the second command never ran. However, it contains the identical bug.

---

## 3. Investigation Findings & Root Cause Analysis

### Question: Did a browser test fail due to settings sections being collapsed by default?
**No.**
1. `browser-tests/settings-usage-insights.browser.tsx` mounts `SettingsUsageInsightsSection` directly without accordion containers; all 9 tests **passed**.
2. `browser-tests/idle-suspend-settings-status.browser.tsx` mounts `SettingsIdleSuspendTimingSection` directly without accordion containers; all tests **passed**.
3. `SettingsPage.test.tsx` (the unit test covering accordion collapse behavior) executed in the `JS tests - ui` job (`111525414759`) and **passed**.

### Why did the test fail in CI?
1. **Vite Client Env Masking**:
   In Vite/Vitest browser mode, test code is bundled as client-side code in Chromium. Vite only exposes environment variables prefixed with `VITE_` unless explicitly configured via `define` or `envPrefix`. Standard shell environment variables like `CI=true` are not injected into `import.meta.env`. Consequently, `import.meta.env.CI` evaluated to `undefined` in the browser bundle, causing `!import.meta.env.CI` to evaluate to `true`.

2. **Hardcoded Machine Path**:
   Lines 141–143 specified `path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/counsel-evaluations-responsive/screenshot.png"`.

3. **CI Runner Permission Failure**:
   GitHub Actions runners execute under the `runner` user account (`/home/runner/...`). When `page.screenshot` called `mkdir` to create the parent directories for `/home/loidinh`, the OS returned `EACCES: permission denied, mkdir '/home/loidinh'`.

4. **Branch Ancestry**:
   PR #45 was branched from `b3d99fef` (before PR #44 merged). In PR #44 (`refactor/frontend-test-restructure`, merged commit `c1d5a98e`):
   - `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx` was deleted and migrated to a Playwright runner spec (`counsel-evaluations-responsive.spec.ts`).
   - `packages/ui/browser-tests/advisor-routing.browser.tsx` had the hardcoded `page.screenshot` block removed.
   - `packages/ui/vitest.browser.config.ts` excluded `e2e/**` from Vitest browser discovery.

---

## 4. Recommended Solutions

### Option A: Rebase `feat/settings-collapse-by-default` on `origin/main` (Recommended)
PR #44 has already resolved this issue on `main`. Because PR #45 only modifies `SettingsPage.tsx`, `SettingsPage.test.tsx`, and `plans/`, rebasing has 0 merge conflicts.

```bash
git -C /home/loidinh/WS/worktrees/dam-hopper-settings-collapse-by-default fetch origin main
git -C /home/loidinh/WS/worktrees/dam-hopper-settings-collapse-by-default rebase origin/main
git -C /home/loidinh/WS/worktrees/dam-hopper-settings-collapse-by-default push --force-with-lease origin feat/settings-collapse-by-default
```

### Option B: Surgical In-Place Patch on Branch
If rebasing is delayed, apply the following code fixes:

#### 1. `packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx`
Remove `page` from imports and delete the screenshot block:

```diff
--- a/packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx
+++ b/packages/ui/e2e/counsel-evaluations-responsive/counsel-evaluations-responsive.e2e.tsx
@@ -5,3 +5,2 @@
 import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
-import { page } from "vitest/browser";
 import { EvaluationsView } from "@/advisor/views/EvaluationsView.js";
@@ -138,7 +137,0 @@
-    if (!import.meta.env.CI) {
-      await page.viewport(1280, 800);
-      await page.screenshot({
-        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/counsel-evaluations-responsive/screenshot.png",
-      });
-    }
   });
```

#### 2. `packages/ui/browser-tests/advisor-routing.browser.tsx`
Remove `page` from imports and delete the screenshot block:

```diff
--- a/packages/ui/browser-tests/advisor-routing.browser.tsx
+++ b/packages/ui/browser-tests/advisor-routing.browser.tsx
@@ -1,3 +1,2 @@
-import { page } from "vitest/browser";
 import { act } from "react";
@@ -152,7 +151,0 @@
-    if (!import.meta.env.CI) {
-      await page.viewport(1280, 800);
-      await page.screenshot({
-        path: "/home/loidinh/WS/dam-hopper/packages/ui/e2e/advisor-model-dropdown-theme/screenshot.png",
-      });
-    }
```

#### 3. Defense-in-depth: Expose `CI` to Browser Tests in `packages/ui/vitest.browser.config.ts`
```diff
--- a/packages/ui/vitest.browser.config.ts
+++ b/packages/ui/vitest.browser.config.ts
@@ -404,2 +404,3 @@
     ),
+    "import.meta.env.CI": JSON.stringify(Boolean(process.env.CI)),
   },
```

---

## 5. Unresolved Questions
None.

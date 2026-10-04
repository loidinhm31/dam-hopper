# Testing Architecture and Guidelines

## Overview

Dam-Hopper maintains strict quality gates across both backend and frontend layers:
- **Rust Backend:** Integration tests under `server/tests/` using real temporary filesystems and real Git repositories rather than synthetic mocks.
- **Frontend Unit / Logic Tests:** Vitest jsdom tests under `packages/ui/src/**/*.test.ts(x)` covering reducers, stores, hooks, and data providers.
- **Frontend Browser Regressions:** Vitest Browser Mode tests in Chromium under `packages/ui/browser-tests/*.browser.tsx`.
- **E2E Visual & Functional Evidence Tests:** Dedicated test-case suites under `packages/ui/e2e/<case-name>/`.

---

## E2E Evidence Standard (web-testing Skill Contract)

Following the `web-testing` release-gate standard for browser-facing changes:

### 1. Colocated Test Case Folders
Every E2E test case lives in a dedicated folder under `packages/ui/e2e/<case-name>/`:
```text
packages/ui/e2e/
├── e2e-capture-helper.ts
├── privacy-heavy-blur/
│   ├── privacy-heavy-blur.e2e.tsx
│   └── screenshot.png
├── advisor-model-dropdown-theme/
│   ├── advisor-model-dropdown-theme.e2e.tsx
│   └── screenshot.png
└── counsel-evaluations-responsive/
    ├── counsel-evaluations-responsive.e2e.tsx
    └── screenshot.png
```

### 2. Full Application Viewport Capture
- Screenshots must capture the **full application screen** (the complete viewport containing navigation headers, sidebars, active content, and dialogs/overlays).
- Element-only crops or regional snippets are forbidden as primary E2E evidence because they mask viewport clipping, layout collisions, and z-index defects.

### 3. Plans Folder Separation
- The `plans/` directory is strictly reserved for markdown implementation plans and progress reports.
- Binary screenshot assets (`.png`, `.webp`, `.jpg`) must **never** be placed inside `plans/` or `plans/reports/`. All visual evidence belongs colocated with the test case in `packages/ui/e2e/<case-name>/`.

### 4. CI Quality Gate Workload Optimization
- In CI runners (e.g. GitHub Actions where `CI=true`), optional full-screen screenshot generation is bypassed by default to minimize disk I/O, runner memory, CPU overhead, and build duration.
- All functional interactions, DOM queries, CSSOM validations (`getComputedStyle`), and assertions execute in full during CI runs.
- To force screenshot captures in CI (for visual debugging or artifact inspection), set `E2E_CAPTURE=1`.
- Locally, `shouldCaptureE2E()` enables capture by default so developers and reviewers have fresh visual verification evidence.

---

## Running Tests

```bash
# Run all UI unit tests
pnpm --filter @dam-hopper/ui test

# Run all browser regression tests
pnpm --filter @dam-hopper/ui test:browser

# Run E2E tests specifically
pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts e2e

# Run with explicit screenshot capture enabled
E2E_CAPTURE=1 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts e2e

# Run with screenshot capture disabled (CI mode simulation)
E2E_CAPTURE=0 pnpm --filter @dam-hopper/ui exec vitest run --config vitest.browser.config.ts e2e
```
